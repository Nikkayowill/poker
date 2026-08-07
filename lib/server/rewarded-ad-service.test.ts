import { beforeEach, describe, expect, it } from "vitest";
import {
  REWARDED_AD_DAILY_LIMIT,
  REWARDED_AD_DURATION_MS,
  REWARDED_AD_GOLD,
  REWARDED_AD_GRANT_TTL_MS,
} from "@/lib/rewards/config";
import { randomUUID } from "crypto";
import { ensureProfile, linkProfileToUser } from "./profile-store";
import {
  RewardedAdError,
  cancelRewardedAd,
  claimRewardedAd,
  startRewardedAd,
  startOfUtcDay,
} from "./rewarded-ad-service";
import { __resetRewardedAdGrantsForTest } from "./rewarded-ad-store";

/**
 * The money path, against the memory branch -- which is what `npm test` and a
 * no-env dev server both run on, so it has to enforce exactly what the table's
 * constraints do.
 *
 * These tests deliberately do NOT stack a clock seam into the route or add a
 * "skip the wait" flag, for the reason the Blackjack service tests give for
 * not stacking a deck: a seam that shortens the wait is precisely the seam an
 * attacker wants. The wait is exercised by passing an explicit `now` to the
 * service functions, which is an argument the HTTP layer never supplies -- the
 * routes call these with no `now` at all.
 */

let token = "";

/**
 * A registered profile, since the offer is registered-only.
 *
 * A fresh random token per call rather than a shared fixture reset, matching
 * profile-store.test.ts: the memory store is process-global and keyed by token,
 * so uniqueness is the isolation.
 */
async function registeredProfile(): Promise<string> {
  const sessionToken = randomUUID();
  await ensureProfile(sessionToken);
  await linkProfileToUser(sessionToken, `user-${sessionToken}`);
  return sessionToken;
}

/** A time far enough past `from` that a grant issued then is claimable. */
function afterTheWait(from: Date): Date {
  return new Date(from.getTime() + REWARDED_AD_DURATION_MS + 1000);
}

beforeEach(async () => {
  __resetRewardedAdGrantsForTest();
  token = await registeredProfile();
});

describe("startRewardedAd", () => {
  it("issues a grant with the full wait ahead of it", async () => {
    const grant = await startRewardedAd(token);
    expect(grant.rewardGold).toBe(REWARDED_AD_GOLD);
    expect(grant.waitMs).toBe(REWARDED_AD_DURATION_MS);
    expect(grant.remainingToday).toBe(REWARDED_AD_DAILY_LIMIT - 1);
  });

  it("resumes the grant already in flight rather than issuing a second", async () => {
    // A reload mid-ad, or a second tab. Two grants would mean two rewards for
    // one wait, which is the single most valuable thing to get wrong here.
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const first = await startRewardedAd(token, issuedAt);
    const second = await startRewardedAd(token, new Date(issuedAt.getTime() + 10_000));

    expect(second.grantId).toBe(first.grantId);
    expect(second.waitMs).toBe(REWARDED_AD_DURATION_MS - 10_000);
  });

  it("sweeps a grant that has outlived its TTL and issues a fresh one", async () => {
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const stale = await startRewardedAd(token, issuedAt);
    const later = new Date(issuedAt.getTime() + REWARDED_AD_GRANT_TTL_MS + 1000);

    const fresh = await startRewardedAd(token, later);
    expect(fresh.grantId).not.toBe(stale.grantId);
    expect(fresh.waitMs).toBe(REWARDED_AD_DURATION_MS);
  });

  it("refuses a guest", async () => {
    const guest = randomUUID();
    await ensureProfile(guest);
    await expect(startRewardedAd(guest)).rejects.toMatchObject({
      name: "RewardedAdError",
      status: 403,
      reason: "guest",
    });
  });
});

describe("claimRewardedAd", () => {
  it("credits exactly the reward, once the wait has actually elapsed", async () => {
    const before = await ensureProfile(token);
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const grant = await startRewardedAd(token, issuedAt);

    const result = await claimRewardedAd(token, grant.grantId, afterTheWait(issuedAt));

    expect(result.awarded).toBe(REWARDED_AD_GOLD);
    expect(result.profile.goldBalance).toBe(before.goldBalance + REWARDED_AD_GOLD);
  });

  it("refuses before the wait has elapsed, and says how long is left", async () => {
    const before = await ensureProfile(token);
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const grant = await startRewardedAd(token, issuedAt);

    // Client-side countdowns are editable; this is the check that is not.
    await expect(
      claimRewardedAd(token, grant.grantId, new Date(issuedAt.getTime() + 5_000)),
    ).rejects.toMatchObject({ status: 409, reason: "too-soon" });

    const after = await ensureProfile(token);
    expect(after.goldBalance).toBe(before.goldBalance);
  });

  it("pays once for a grant claimed twice", async () => {
    // A double-clicked Claim, a retry, or two tabs. The guarded UPDATE is what
    // makes this exact rather than approximately once.
    const before = await ensureProfile(token);
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const grant = await startRewardedAd(token, issuedAt);
    const now = afterTheWait(issuedAt);

    await claimRewardedAd(token, grant.grantId, now);
    await expect(claimRewardedAd(token, grant.grantId, now)).rejects.toMatchObject({
      status: 409,
      reason: "already-claimed",
    });

    const after = await ensureProfile(token);
    expect(after.goldBalance).toBe(before.goldBalance + REWARDED_AD_GOLD);
  });

  it("pays once when the same grant is claimed concurrently", async () => {
    const before = await ensureProfile(token);
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const grant = await startRewardedAd(token, issuedAt);
    const now = afterTheWait(issuedAt);

    const settled = await Promise.allSettled([
      claimRewardedAd(token, grant.grantId, now),
      claimRewardedAd(token, grant.grantId, now),
      claimRewardedAd(token, grant.grantId, now),
    ]);

    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await ensureProfile(token);
    expect(after.goldBalance).toBe(before.goldBalance + REWARDED_AD_GOLD);
  });

  it("refuses a grant belonging to somebody else", async () => {
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const grant = await startRewardedAd(token, issuedAt);
    const stranger = await registeredProfile();

    await expect(
      claimRewardedAd(stranger, grant.grantId, afterTheWait(issuedAt)),
    ).rejects.toBeInstanceOf(RewardedAdError);

    // And the real owner can still claim it -- the refusal must not consume it.
    await expect(claimRewardedAd(token, grant.grantId, afterTheWait(issuedAt))).resolves.toMatchObject({
      awarded: REWARDED_AD_GOLD,
    });
  });

  it("refuses a grant left open past its TTL", async () => {
    const issuedAt = new Date("2026-08-06T12:00:00.000Z");
    const grant = await startRewardedAd(token, issuedAt);
    const tooLate = new Date(issuedAt.getTime() + REWARDED_AD_GRANT_TTL_MS + 1000);

    await expect(claimRewardedAd(token, grant.grantId, tooLate)).rejects.toMatchObject({
      status: 410,
      reason: "expired",
    });
  });

  describe("the daily cap", () => {
    it("is the real bound on the faucet", async () => {
      // The one number that matters if the client callback is spoofed wholesale:
      // no sequence of requests can mint more than this in a UTC day.
      const before = await ensureProfile(token);
      let now = new Date("2026-08-06T00:00:00.000Z");

      for (let attempt = 0; attempt < REWARDED_AD_DAILY_LIMIT + 4; attempt += 1) {
        try {
          const grant = await startRewardedAd(token, now);
          now = afterTheWait(now);
          await claimRewardedAd(token, grant.grantId, now);
        } catch {
          // Past the cap both calls refuse; the balance assertion below is the
          // check that matters, not which of the two threw.
        }
        now = new Date(now.getTime() + 1000);
      }

      const after = await ensureProfile(token);
      expect(after.goldBalance).toBe(before.goldBalance + REWARDED_AD_GOLD * REWARDED_AD_DAILY_LIMIT);
    });

    it("resets on the UTC day boundary, not on a rolling 24 hours", async () => {
      const before = await ensureProfile(token);
      let now = new Date("2026-08-06T22:00:00.000Z");
      for (let attempt = 0; attempt < REWARDED_AD_DAILY_LIMIT; attempt += 1) {
        const grant = await startRewardedAd(token, now);
        now = afterTheWait(now);
        await claimRewardedAd(token, grant.grantId, now);
        now = new Date(now.getTime() + 1000);
      }
      await expect(startRewardedAd(token, now)).rejects.toMatchObject({ reason: "daily-limit" });

      // Two hours later is a new calendar day, and the allowance is back.
      const tomorrow = new Date("2026-08-07T00:30:00.000Z");
      const grant = await startRewardedAd(token, tomorrow);
      await claimRewardedAd(token, grant.grantId, afterTheWait(tomorrow));

      const after = await ensureProfile(token);
      expect(after.goldBalance).toBe(before.goldBalance + REWARDED_AD_GOLD * (REWARDED_AD_DAILY_LIMIT + 1));
    });

    it("does not spend a slot on a grant that was never claimed", async () => {
      // Starting and abandoning an ad costs the house nothing, so it must not
      // cost the player an allowance.
      const issuedAt = new Date("2026-08-06T12:00:00.000Z");
      const abandoned = await startRewardedAd(token, issuedAt);
      await cancelRewardedAd(token, abandoned.grantId);

      const grant = await startRewardedAd(token, issuedAt);
      expect(grant.remainingToday).toBe(REWARDED_AD_DAILY_LIMIT - 1);
    });
  });
});

describe("startOfUtcDay", () => {
  it("uses the same calendar-day boundary the daily Gold claim does", () => {
    expect(startOfUtcDay(new Date("2026-08-06T23:59:59.999Z")).toISOString())
      .toBe("2026-08-06T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-08-07T00:00:00.000Z")).toISOString())
      .toBe("2026-08-07T00:00:00.000Z");
  });
});
