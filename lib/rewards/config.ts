/**
 * The numbers behind "watch an ad, get Gold", in one place.
 *
 * Shared by the pure trigger logic, the server that actually credits, and the
 * modal that counts down -- so the copy on the button ("Watch a 30-second ad
 * to claim 500 Gold") cannot drift away from the amount the wallet receives or
 * the interval the server enforces. All three used to be the same literal
 * typed three times in the first cut of this feature, which is exactly how a
 * button ends up promising 500 while the route pays 250.
 *
 * In lib/ rather than beside the component for the reason lib/arcade/games.ts
 * and lib/profile/daily-gold.ts are: vitest.config.ts collects only lib/ and
 * app/, so a constant written next to the modal would be untestable.
 */

/** What one completed view is worth. */
export const REWARDED_AD_GOLD = 500;

/**
 * How long the player must wait before the grant can be claimed.
 *
 * Enforced against a timestamp the *server* wrote when it issued the grant,
 * never against anything the browser sends -- see lib/server/rewarded-ad-
 * service.ts. The countdown in the modal is presentation; this is the rule.
 */
export const REWARDED_AD_DURATION_MS = 30_000;

/**
 * A grant that is never claimed stops being claimable.
 *
 * Without this a player could open the modal, walk away, and come back with a
 * grant that satisfies the elapsed check trivially -- and, worse, could bank
 * one against a future daily reset. Ten minutes is long enough for a slow ad
 * and a distracted player, short enough that nothing is worth hoarding.
 */
export const REWARDED_AD_GRANT_TTL_MS = 10 * 60_000;

/**
 * The faucet's ceiling, per UTC day.
 *
 * The client callback that says "the ad finished" is not attestable -- see the
 * long note in lib/server/rewarded-ad-service.ts. Given that, the cap is not a
 * nicety, it is the actual bound on what a determined player can mint: at most
 * REWARDED_AD_DAILY_LIMIT * REWARDED_AD_GOLD per day, each costing them at
 * least REWARDED_AD_DURATION_MS of real time.
 */
export const REWARDED_AD_DAILY_LIMIT = 6;

/** The most Gold this faucet can produce in one UTC day, stated once so a test can pin it. */
export const REWARDED_AD_DAILY_GOLD_CEILING = REWARDED_AD_GOLD * REWARDED_AD_DAILY_LIMIT;

/** Whole seconds, for the copy: "Watch a 30-second ad…". */
export const REWARDED_AD_DURATION_SECONDS = Math.round(REWARDED_AD_DURATION_MS / 1000);

/** The offer, worded once so the modal and any future surface agree. */
export const REWARDED_AD_OFFER_LABEL =
  `Watch a ${REWARDED_AD_DURATION_SECONDS}-second ad to claim ${REWARDED_AD_GOLD.toLocaleString("en-US")} Gold`;
