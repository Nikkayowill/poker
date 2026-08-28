import "server-only";
import { createVerify } from "crypto";
import {
  ADMOB_REWARDED_AD_DAILY_LIMIT,
  ADMOB_REWARDED_AD_GOLD,
} from "@/lib/rewards/config";
import { admobVerifierKey } from "./admob-keys";
import {
  AdmobDailyLimitExceeded,
  countAdmobSsvReceipts,
  deleteAdmobSsvReceipt,
  findAdmobSsvReceiptByCustomData,
  recordAdmobSsvReceipt,
} from "./admob-ssv-store";
import { creditGoldByProfile, getProfileById } from "./profile-store";
import { startOfUtcDay } from "./rewarded-ad-service";

/**
 * Everything between "AdMob says a rewarded video finished" and the wallet.
 *
 * This is the counterpart to rewarded-ad-service.ts's own header comment,
 * for the surface where the gap it describes doesn't exist: AdMob's rewarded
 * video product ships with server-side verification (SSV), a genuine
 * server-to-server signal Google's own infrastructure signs. The player's
 * device is not the source of truth here at all -- it only gets to show the
 * ad and tell the player to wait; whether Gold moves is decided entirely by
 * whether this file can verify Google's signature.
 *
 *   1. Verify first, unconditionally. The ECDSA signature over the callback's
 *      own query string (minus signature/key_id) is checked against Google's
 *      published rotating public keys before anything else runs -- same
 *      principle app/api/stripe/webhook/route.ts states for its own raw-body
 *      verification, just a different signature scheme (no shared secret;
 *      Google's public keys are fetched, not configured).
 *   2. The amount credited is never read from the callback. reward_amount is
 *      whatever AdMob's own ad-unit console says, which is Kayo's dashboard
 *      to misconfigure or an attacker's target to spoof if it were ever
 *      trusted; ADMOB_REWARDED_AD_GOLD is the only source of truth for what
 *      one view is worth, exactly like rewarded_ad_grants.reward_gold being
 *      stored on the row rather than re-read from the constant at claim time.
 *   3. A callback pays once. recordAdmobSsvReceipt is a single insert guarded
 *      by a unique constraint on transaction_id; a redelivery (Google retries
 *      a non-2xx SSV response) finds the row already there and gets null,
 *      never a second credit. Same idempotency shape as
 *      redeemRewardedAdGrant's conditional UPDATE, just insert-once instead
 *      of flip-once because there is no earlier "issued" row to flip. The
 *      daily cap is enforced inside that same insert, not by a check this
 *      file made a moment earlier -- two callbacks racing close together
 *      would otherwise both read the count before either had written a row.
 *   4. Gold is credited only after that insert is confirmed (rule B, same
 *      ordering rewarded-ad-service.ts states); a credit that throws deletes
 *      the just-recorded receipt so Google's own redelivery can retry
 *      cleanly (rule C's analogue -- nothing was debited here either).
 */

export class AdmobSsvVerificationError extends Error {}

export type AdmobSsvOutcome =
  | { credited: true; profileId: string; awarded: number }
  | {
      credited: false;
      reason: "duplicate" | "unknown-key" | "bad-signature" | "stale" | "ineligible" | "daily-limit";
    };

// Generous on purpose: this isn't the anti-double-credit guard (transaction_id
// dedupe is), it only rejects a callback URL that's clearly being replayed
// long after the fact rather than delivered or retried in the normal window.
const MAX_CALLBACK_AGE_MS = 60 * 60 * 1000;

function verifySignature(content: string, signatureBase64Url: string, pem: string): boolean {
  const signature = Buffer.from(signatureBase64Url, "base64url");
  const verifier = createVerify("SHA256");
  verifier.update(content);
  verifier.end();
  try {
    // AdMob signs with the raw (r || s) IEEE-P1363 encoding, not ASN.1 DER.
    return verifier.verify({ key: pem, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}

/**
 * Verifies and processes one AdMob SSV callback.
 *
 * `rawQuery` must be the exact query string as received (no leading '?'),
 * unparsed and unreordered -- the signature covers the literal bytes Google
 * sent, and reserializing via URLSearchParams first is exactly the kind of
 * "helpful" transform that can silently break verification (differing
 * percent-encoding, reordered params).
 */
export async function processAdmobSsvCallback(rawQuery: string, now = new Date()): Promise<AdmobSsvOutcome> {
  const signatureMarker = "&signature=";
  const signatureIndex = rawQuery.indexOf(signatureMarker);
  if (signatureIndex === -1) {
    throw new AdmobSsvVerificationError("Missing signature.");
  }
  const content = rawQuery.slice(0, signatureIndex);

  const params = new URLSearchParams(rawQuery);
  const signature = params.get("signature");
  const keyIdRaw = params.get("key_id");
  const transactionId = params.get("transaction_id");
  const userId = params.get("user_id");
  const timestampRaw = params.get("timestamp");
  const customData = params.get("custom_data");
  if (!signature || !keyIdRaw || !transactionId || !userId || !timestampRaw) {
    throw new AdmobSsvVerificationError("Missing a required SSV field.");
  }

  const keyId = Number(keyIdRaw);
  if (!Number.isFinite(keyId)) throw new AdmobSsvVerificationError("Malformed key_id.");
  const pem = await admobVerifierKey(keyId);
  if (!pem) return { credited: false, reason: "unknown-key" };
  if (!verifySignature(content, signature, pem)) return { credited: false, reason: "bad-signature" };

  const timestampMs = Number(timestampRaw);
  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > MAX_CALLBACK_AGE_MS) {
    return { credited: false, reason: "stale" };
  }

  // user_id is whatever we passed as ssv.userId when the native client
  // launched the ad (see lib/ads/admob-native.ts): the profile's internal id,
  // never a session token -- a bearer credential has no business round-
  // tripping through a third party's URL and server logs.
  const profile = await getProfileById(userId);
  if (!profile || !profile.isRegistered || profile.unlimitedGold) {
    return { credited: false, reason: "ineligible" };
  }

  const since = startOfUtcDay(now).toISOString();
  // A cheap early exit for the common case, not the guard itself -- see the
  // header comment's rule 3 and recordAdmobSsvReceipt's own doc comment for
  // why the real gate is inside that insert, not this read.
  const claimedToday = await countAdmobSsvReceipts(profile.id, since);
  if (claimedToday >= ADMOB_REWARDED_AD_DAILY_LIMIT) {
    return { credited: false, reason: "daily-limit" };
  }

  let recorded;
  try {
    recorded = await recordAdmobSsvReceipt(
      transactionId,
      profile.id,
      ADMOB_REWARDED_AD_GOLD,
      customData,
      now.toISOString(),
      ADMOB_REWARDED_AD_DAILY_LIMIT,
      since,
    );
  } catch (error) {
    if (error instanceof AdmobDailyLimitExceeded) {
      return { credited: false, reason: "daily-limit" };
    }
    throw error;
  }
  if (!recorded) {
    // Already processed -- a Google redelivery, not a new view.
    return { credited: false, reason: "duplicate" };
  }

  try {
    const credited = await creditGoldByProfile(profile.id, ADMOB_REWARDED_AD_GOLD);
    if (!credited) {
      // The profile vanished between the two reads above and this write.
      // Free the transaction_id rather than leave a paid-looking receipt
      // with nothing behind it.
      await deleteAdmobSsvReceipt(transactionId).catch(() => {});
      return { credited: false, reason: "ineligible" };
    }
    return { credited: true, profileId: profile.id, awarded: ADMOB_REWARDED_AD_GOLD };
  } catch (error) {
    await deleteAdmobSsvReceipt(transactionId).catch(() => {});
    throw error;
  }
}

/**
 * Read-only status check for the native client's own poll (see
 * ADMOB_SSV_POLL_INTERVAL_MS): has the SSV callback for this nonce landed
 * yet? This never verifies or credits anything itself -- it only reads what
 * processAdmobSsvCallback already recorded, keyed by the nonce the client
 * generated and passed as ssv.customData before the ad ever played.
 */
export async function admobRewardStatus(
  profileId: string,
  customData: string,
  now = new Date(),
): Promise<
  | { credited: true; awarded: number; remainingToday: number }
  | { credited: false }
> {
  const since = startOfUtcDay(now).toISOString();
  const receipt = await findAdmobSsvReceiptByCustomData(profileId, customData, since);
  if (!receipt) return { credited: false };
  const claimedToday = await countAdmobSsvReceipts(profileId, since);
  return {
    credited: true,
    awarded: receipt.rewardGold,
    remainingToday: Math.max(0, ADMOB_REWARDED_AD_DAILY_LIMIT - claimedToday),
  };
}
