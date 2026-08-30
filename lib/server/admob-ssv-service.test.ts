import { createSign, generateKeyPairSync } from "crypto";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMOB_REWARDED_AD_DAILY_LIMIT, ADMOB_REWARDED_AD_GOLD } from "@/lib/rewards/config";
import { ensureProfile, linkProfileToUser } from "./profile-store";
import { __resetAdmobSsvReceiptsForTest } from "./admob-ssv-store";

/**
 * The AdMob SSV path, against the memory branch, same posture
 * rewarded-ad-service.test.ts states for its own suite.
 *
 * lib/server/admob-keys.ts is mocked to a real, in-process EC key pair
 * rather than Google's actual endpoint: the whole point of these tests is to
 * exercise the verify-then-credit logic, not to make a network call to
 * gstatic.com on every `npm test`. The signing here uses the exact scheme
 * AdMob documents (ECDSA/SHA-256, IEEE-P1363 r||s, base64url) so a genuine
 * callback and a test-forged one are indistinguishable to the code under
 * test.
 */

const TEST_KEY_ID = 42;
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

vi.mock("./admob-keys", () => ({
  admobVerifierKey: vi.fn(async (keyId: number) => (keyId === TEST_KEY_ID ? publicKeyPem : null)),
}));

// Imported after the mock so the module under test picks it up.
const { processAdmobSsvCallback, admobRewardStatus } = await import("./admob-ssv-service");

function sign(content: string): string {
  const signer = createSign("SHA256");
  signer.update(content);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return signature.toString("base64url");
}

interface CallbackFields {
  userId: string;
  transactionId?: string;
  customData?: string;
  timestampMs?: number;
  keyId?: number;
  rewardAmount?: number;
}

/** Builds a genuinely-signed callback query string, exactly as Google's own SSV would. */
function buildCallback(fields: CallbackFields): string {
  const params = new URLSearchParams({
    ad_network: "5450213213286189855",
    ad_unit: "ca-app-pub-test/1234567890",
    reward_amount: String(fields.rewardAmount ?? ADMOB_REWARDED_AD_GOLD),
    reward_item: "coins",
    timestamp: String(fields.timestampMs ?? Date.now()),
    transaction_id: fields.transactionId ?? randomUUID(),
    user_id: fields.userId,
    ...(fields.customData ? { custom_data: fields.customData } : {}),
  });
  const content = params.toString();
  const signature = sign(content);
  const keyId = fields.keyId ?? TEST_KEY_ID;
  return `${content}&signature=${signature}&key_id=${keyId}`;
}

async function registeredProfileId(): Promise<string> {
  const sessionToken = randomUUID();
  const profile = await ensureProfile(sessionToken);
  await linkProfileToUser(sessionToken, `user-${sessionToken}`);
  return profile.id;
}

beforeEach(() => {
  __resetAdmobSsvReceiptsForTest();
});

describe("processAdmobSsvCallback", () => {
  it("credits exactly the configured reward for a genuinely signed callback", async () => {
    const profileId = await registeredProfileId();
    const before = await import("./profile-store").then((m) => m.getProfileById(profileId));

    const outcome = await processAdmobSsvCallback(buildCallback({ userId: profileId }));

    expect(outcome).toMatchObject({ credited: true, profileId, awarded: ADMOB_REWARDED_AD_GOLD });
    const after = await import("./profile-store").then((m) => m.getProfileById(profileId));
    expect(after!.goldBalance).toBe(before!.goldBalance + ADMOB_REWARDED_AD_GOLD);
  });

  it("never credits the reward_amount the callback itself claims", async () => {
    // A misconfigured or spoofed ad-unit console value must not be trusted --
    // ADMOB_REWARDED_AD_GOLD is the only source of truth.
    const profileId = await registeredProfileId();
    const before = await import("./profile-store").then((m) => m.getProfileById(profileId));

    await processAdmobSsvCallback(buildCallback({ userId: profileId, rewardAmount: 999_999 }));

    const after = await import("./profile-store").then((m) => m.getProfileById(profileId));
    expect(after!.goldBalance).toBe(before!.goldBalance + ADMOB_REWARDED_AD_GOLD);
  });

  it("rejects a tampered query string outright", async () => {
    const profileId = await registeredProfileId();
    const callback = buildCallback({ userId: profileId });
    // Bump reward_amount after signing, exactly what an attacker replaying a
    // captured callback with a richer payload would try.
    const tampered = callback.replace(`reward_amount=${ADMOB_REWARDED_AD_GOLD}`, "reward_amount=999999");

    await expect(processAdmobSsvCallback(tampered)).resolves.toMatchObject({
      credited: false,
      reason: "bad-signature",
    });
  });

  it("pays once for a redelivered transaction_id", async () => {
    const profileId = await registeredProfileId();
    const before = await import("./profile-store").then((m) => m.getProfileById(profileId));
    const callback = buildCallback({ userId: profileId });

    await processAdmobSsvCallback(callback);
    const redelivery = await processAdmobSsvCallback(callback);

    expect(redelivery).toMatchObject({ credited: false, reason: "duplicate" });
    const after = await import("./profile-store").then((m) => m.getProfileById(profileId));
    expect(after!.goldBalance).toBe(before!.goldBalance + ADMOB_REWARDED_AD_GOLD);
  });

  it("refuses a callback signed for an unpublished key id", async () => {
    const profileId = await registeredProfileId();
    const outcome = await processAdmobSsvCallback(buildCallback({ userId: profileId, keyId: 999 }));
    expect(outcome).toMatchObject({ credited: false, reason: "unknown-key" });
  });

  it("refuses an unknown user_id rather than crediting nobody's neighbor", async () => {
    const outcome = await processAdmobSsvCallback(buildCallback({ userId: randomUUID() }));
    expect(outcome).toMatchObject({ credited: false, reason: "ineligible" });
  });

  it("refuses a genuinely signed callback for a different ad unit once one is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMOB_REWARDED_AD_UNIT_ID", "ca-app-pub-real/live-unit");
    try {
      const profileId = await registeredProfileId();
      const outcome = await processAdmobSsvCallback(buildCallback({ userId: profileId }));
      expect(outcome).toMatchObject({ credited: false, reason: "wrong-ad-unit" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never double-credits a redelivery after an ambiguous credit failure", async () => {
    // If the credit RPC throws after actually committing (a dropped response,
    // not a real failure), the receipt must not be freed for retry -- see
    // admob-ssv-service.ts's header comment, rule 4.
    const profileId = await registeredProfileId();
    const profileStore = await import("./profile-store");
    const creditSpy = vi.spyOn(profileStore, "creditGoldByProfile").mockRejectedValueOnce(new Error("dropped"));
    const callback = buildCallback({ userId: profileId });

    await expect(processAdmobSsvCallback(callback)).rejects.toThrow("dropped");
    const redelivery = await processAdmobSsvCallback(callback);

    expect(redelivery).toMatchObject({ credited: false, reason: "duplicate" });
    creditSpy.mockRestore();
  });

  it("enforces the daily cap as a real bound", async () => {
    const profileId = await registeredProfileId();
    const before = await import("./profile-store").then((m) => m.getProfileById(profileId));

    for (let attempt = 0; attempt < ADMOB_REWARDED_AD_DAILY_LIMIT + 3; attempt += 1) {
      await processAdmobSsvCallback(buildCallback({ userId: profileId }));
    }

    const after = await import("./profile-store").then((m) => m.getProfileById(profileId));
    expect(after!.goldBalance).toBe(before!.goldBalance + ADMOB_REWARDED_AD_GOLD * ADMOB_REWARDED_AD_DAILY_LIMIT);
  });

  it("holds the daily cap even when every callback for the day arrives at once", async () => {
    // The sequential version above can't catch a check-then-insert race --
    // each call fully awaits before the next starts. This fires every
    // callback concurrently, the exact shape two SSV redeliveries landing
    // close together would take, and is what actually exercises
    // recordAdmobSsvReceipt's own atomicity rather than the service's
    // early-exit read.
    const profileId = await registeredProfileId();
    const before = await import("./profile-store").then((m) => m.getProfileById(profileId));

    const attempts = ADMOB_REWARDED_AD_DAILY_LIMIT + 5;
    await Promise.all(
      Array.from({ length: attempts }, () => processAdmobSsvCallback(buildCallback({ userId: profileId }))),
    );

    const after = await import("./profile-store").then((m) => m.getProfileById(profileId));
    expect(after!.goldBalance).toBe(before!.goldBalance + ADMOB_REWARDED_AD_GOLD * ADMOB_REWARDED_AD_DAILY_LIMIT);
  });
});

describe("admobRewardStatus", () => {
  it("lets the client discover its own callback once it lands", async () => {
    const profileId = await registeredProfileId();
    const nonce = randomUUID();

    expect(await admobRewardStatus(profileId, nonce)).toMatchObject({ credited: false });

    await processAdmobSsvCallback(buildCallback({ userId: profileId, customData: nonce }));

    expect(await admobRewardStatus(profileId, nonce)).toMatchObject({
      credited: true,
      awarded: ADMOB_REWARDED_AD_GOLD,
    });
  });
});
