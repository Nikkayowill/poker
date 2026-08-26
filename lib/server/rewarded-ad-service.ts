import "server-only";
import {
  REWARDED_AD_DAILY_LIMIT,
  REWARDED_AD_DURATION_MS,
  REWARDED_AD_GOLD,
  REWARDED_AD_GRANT_TTL_MS,
} from "@/lib/rewards/config";
import type { PlayerProfile } from "@/lib/profile/types";
import { ArcadeRequestError } from "./arcade-request";
import { creditGold, ensureProfile } from "./profile-store";
import {
  PendingRewardedAdGrantExists,
  countClaimedRewardedAdGrants,
  createRewardedAdGrant,
  discardRewardedAdGrant,
  getPendingRewardedAdGrant,
  redeemRewardedAdGrant,
  releaseRewardedAdGrant,
} from "./rewarded-ad-store";

/**
 * Everything between "the player watched an ad" and the wallet.
 *
 * What this cannot do, stated first: Adsterra's publisher products are
 * banners, interstitials and popunders. None of them is a rewarded-video
 * placement, and none of them offers a server-to-server completion postback,
 * so there is no signal anywhere this server can verify to establish that an
 * ad was watched. Any code that claims otherwise is trusting `fetch` from a
 * browser the player controls.
 *
 * That is not a reason to hand the browser the wallet. It is a reason to be
 * precise about what the server does own, which is exactly three things:
 *
 *   1. When the offer was issued. startRewardedAd writes issued_at from this
 *      process's clock. The claim compares against that, so the wait is real
 *      wall-clock time no matter what the client sends; there is no
 *      client-supplied timestamp anywhere in this file.
 *   2. That a grant pays once. redeemRewardedAdGrant is a single conditional
 *      UPDATE carrying every rule in its WHERE clause. It returns null when it
 *      matches nothing, and null must never pay: that guard is what makes a
 *      double-clicked Claim, a retry and two tabs settle exactly once. Same
 *      contract as blackjack_rounds.version.
 *   3. How much can be minted at all. One pending grant per profile (a partial
 *      unique index, not a read-then-insert) plus REWARDED_AD_DAILY_LIMIT
 *      claims per UTC day. Those two together are the actual security boundary
 *      here: the very best a scripted client can do is REWARDED_AD_DAILY_LIMIT
 *      * REWARDED_AD_GOLD per day, serialised at one every
 *      REWARDED_AD_DURATION_MS. Everything else is a speed bump.
 *
 * Ordering rules, restated here rather than referenced (same reasoning
 * blackjack-service.ts gives for restating its own): breaking one is a
 * silent money bug.
 *
 *   A. The grant is created before the ad is shown. It is the clock, so a
 *      grant issued afterwards would be measuring nothing.
 *   B. Gold is credited only after the guarded redemption is confirmed. The
 *      reverse order pays for a redemption that may never persist, and there
 *      is no debit here to make the imbalance visible later.
 *   C. A credit that throws puts the grant back to pending (best effort). This
 *      is the one place this feature differs from the wager games: nothing was
 *      debited, so a failure between the two writes costs a grant rather than
 *      a stake, and the retry is free.
 */

export type RewardedAdRejection =
  | "guest"
  | "unlimited"
  | "in-progress"
  | "daily-limit"
  | "too-soon"
  | "expired"
  | "already-claimed";

export class RewardedAdError extends ArcadeRequestError<never, RewardedAdRejection> {
  readonly name = "RewardedAdError";
}

export interface RewardedAdGrantView {
  grantId: string;
  rewardGold: number;
  /** Milliseconds still to wait. The modal counts this down; the server re-checks it on claim regardless. */
  waitMs: number;
  /** Claims left today, after this one would land. */
  remainingToday: number;
}

export interface RewardedAdClaimView {
  profile: PlayerProfile;
  awarded: number;
  remainingToday: number;
}

/** Midnight UTC of the day containing `now`; the same calendar-day boundary claimDailyGold uses. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * A profile that may take this offer, or the reason it may not.
 *
 * Registered-only, matching claimDailyGold and for its documented reason: a
 * guest profile dies with its cookie, so a repeatable faucet aimed at guests
 * is a faucet aimed at whoever can clear cookies fastest. The one-off backstop
 * (claimBackstopGold) is open to guests because it is a rescue with a
 * threshold, not an income stream; this is an income stream. The modal turns
 * the 403 into the "Save progress" path the player already has.
 */
async function eligibleProfile(token: string): Promise<PlayerProfile> {
  const profile = await ensureProfile(token);
  if (!profile.isRegistered) {
    throw new RewardedAdError("Save your progress to earn Gold from ads.", 403, { reason: "guest" });
  }
  if (profile.unlimitedGold) {
    throw new RewardedAdError("You have unlimited Gold.", 409, { reason: "unlimited" });
  }
  return profile;
}

async function claimsToday(profileId: string, now: Date): Promise<number> {
  return countClaimedRewardedAdGrants(profileId, startOfUtcDay(now).toISOString());
}

/**
 * Issues the grant that a later claim is measured against.
 *
 * The daily cap is checked here as well as at claim time. Not redundant: it is
 * what stops a player from sitting through a full 30 seconds only to be told
 * at the end that there was never anything to collect.
 */
export async function startRewardedAd(token: string, now = new Date()): Promise<RewardedAdGrantView> {
  const profile = await eligibleProfile(token);

  const claimed = await claimsToday(profile.id, now);
  if (claimed >= REWARDED_AD_DAILY_LIMIT) {
    throw new RewardedAdError(
      "You've claimed every ad reward for today. Come back tomorrow.",
      429,
      { reason: "daily-limit" },
    );
  }

  try {
    const grant = await createRewardedAdGrant(profile.id, REWARDED_AD_GOLD, now.toISOString());
    return {
      grantId: grant.id,
      rewardGold: grant.rewardGold,
      waitMs: REWARDED_AD_DURATION_MS,
      remainingToday: REWARDED_AD_DAILY_LIMIT - claimed - 1,
    };
  } catch (error) {
    if (!(error instanceof PendingRewardedAdGrantExists)) throw error;
    // A player who reloaded mid-ad, or has a second tab open. Resuming the
    // grant they already hold is the only correct answer: issuing a second one
    // would let two tabs run two 30-second waits from one, and refusing
    // outright would strand them behind a grant they cannot see or cancel.
    const pending = await getPendingRewardedAdGrant(profile.id);
    if (!pending) throw error;
    const elapsed = now.getTime() - Date.parse(pending.issuedAt);
    if (elapsed > REWARDED_AD_GRANT_TTL_MS) {
      // Expired and in the way. Clear it and let the caller start cleanly.
      await discardRewardedAdGrant(pending.id, profile.id);
      return startRewardedAd(token, now);
    }
    return {
      grantId: pending.id,
      rewardGold: pending.rewardGold,
      waitMs: Math.max(0, REWARDED_AD_DURATION_MS - elapsed),
      remainingToday: REWARDED_AD_DAILY_LIMIT - claimed - 1,
    };
  }
}

/**
 * Redeems a grant and credits the Gold, in that order.
 *
 * Note what is *not* here: no check of any duration the client reports, and no
 * check that an ad element existed. Both would be theatre. The rules that
 * decide are the WHERE clause of the redemption and the cap above it.
 */
export async function claimRewardedAd(
  token: string,
  grantId: string,
  now = new Date(),
): Promise<RewardedAdClaimView> {
  const profile = await eligibleProfile(token);

  const claimed = await claimsToday(profile.id, now);
  if (claimed >= REWARDED_AD_DAILY_LIMIT) {
    throw new RewardedAdError(
      "You've claimed every ad reward for today. Come back tomorrow.",
      429,
      { reason: "daily-limit" },
    );
  }

  const grant = await redeemRewardedAdGrant(
    grantId,
    profile.id,
    {
      notBefore: new Date(now.getTime() - REWARDED_AD_GRANT_TTL_MS).toISOString(),
      notAfter: new Date(now.getTime() - REWARDED_AD_DURATION_MS).toISOString(),
    },
    now.toISOString(),
  );

  if (!grant) {
    // The redemption matched nothing, and that is already the decision. This
    // read only picks the sentence to say. It must never gate the payout, or
    // the atomic guard above would have been for nothing.
    throw await explainFailedRedemption(profile.id, grantId, now);
  }

  try {
    const credited = await creditGold(token, grant.rewardGold);
    return {
      profile: credited,
      awarded: grant.rewardGold,
      remainingToday: Math.max(0, REWARDED_AD_DAILY_LIMIT - claimed - 1),
    };
  } catch (error) {
    // Rule C. Nothing was debited, so putting the grant back costs the house
    // nothing and gives the player their retry.
    await releaseRewardedAdGrant(grant.id).catch(() => {});
    throw error;
  }
}

/** Turns a lost redemption race into the right sentence. Diagnostic only; see the call site. */
async function explainFailedRedemption(
  profileId: string,
  grantId: string,
  now: Date,
): Promise<RewardedAdError> {
  const pending = await getPendingRewardedAdGrant(profileId);
  if (pending && pending.id === grantId) {
    const age = now.getTime() - Date.parse(pending.issuedAt);
    if (age > REWARDED_AD_GRANT_TTL_MS) {
      // Still pending and past its life: it will keep failing and keep
      // blocking the next start, so clear it here rather than leaving the
      // player to discover that only startRewardedAd sweeps it.
      await discardRewardedAdGrant(pending.id, profileId).catch(() => {});
      return new RewardedAdError("That offer expired. Start a new one.", 410, { reason: "expired" });
    }
    const seconds = Math.ceil((REWARDED_AD_DURATION_MS - age) / 1000);
    return new RewardedAdError(
      `The ad isn't finished yet — ${seconds} second${seconds === 1 ? "" : "s"} to go.`,
      409,
      { reason: "too-soon" },
    );
  }
  return new RewardedAdError(
    "That reward has already been claimed.",
    409,
    { reason: "already-claimed" },
  );
}

/** Drops a grant the player walked away from, so the next offer is not blocked by it. */
export async function cancelRewardedAd(token: string, grantId: string): Promise<void> {
  const profile = await ensureProfile(token);
  await discardRewardedAdGrant(grantId, profile.id);
}
