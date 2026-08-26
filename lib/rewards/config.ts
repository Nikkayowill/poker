import { CHEAPEST_TIER, TIER_CONFIG } from "@/lib/game/tiers";

/**
 * The numbers behind "watch an ad, get Gold", in one place.
 *
 * Shared by the pure trigger logic, the server that actually credits, and the
 * modal that counts down, so the copy on the button ("Watch a 30-second ad
 * to claim 500 Gold") can't drift away from the amount the wallet receives or
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
 * never against anything the browser sends (see lib/server/rewarded-ad-
 * service.ts). The countdown in the modal is presentation; this is the rule.
 *
 * 30 seconds, not longer: the unit behind this (lib/ads/adsterra.ts) is a
 * single 300x250 banner impression, loaded once per grant and never
 * refreshed (see components/ads/adsterra-slot.tsx, whose srcDoc only
 * rebuilds if adKey/scriptSrc/width/height change, none of which the
 * countdown touches). Adsterra pays banner units per impression, not per
 * second on screen, so a longer wait doesn't earn more; it only makes
 * nobody finish it. A five-minute wait was tried briefly and reverted.
 */
export const REWARDED_AD_DURATION_MS = 30_000;

/**
 * A grant that is never claimed stops being claimable.
 *
 * Without this a player could open the modal, walk away, and come back with a
 * grant that satisfies the elapsed check trivially, and, worse, could bank
 * one against a future daily reset. Ten minutes leaves a full
 * REWARDED_AD_DURATION_MS wait plus a real margin to notice the "Claim"
 * button afterward, short enough that nothing is worth hoarding.
 */
export const REWARDED_AD_GRANT_TTL_MS = 10 * 60_000;

/**
 * The faucet's ceiling, per UTC day.
 *
 * The client callback that says "the ad finished" isn't attestable (see the
 * long note in lib/server/rewarded-ad-service.ts). Given that, the cap isn't
 * a nicety, it's the actual bound on what a determined player can mint: at
 * most REWARDED_AD_DAILY_LIMIT * REWARDED_AD_GOLD per day, each costing them
 * at least REWARDED_AD_DURATION_MS of real time.
 */
export const REWARDED_AD_DAILY_LIMIT = 6;

/** Whole seconds, for a countdown readout. */
export const REWARDED_AD_DURATION_SECONDS = Math.round(REWARDED_AD_DURATION_MS / 1000);

/**
 * "5-minute" or "45-second", whichever reads naturally, derived rather than
 * typed so a future change to the duration can't leave the copy saying
 * "300-second ad" again.
 */
export const REWARDED_AD_DURATION_LABEL =
  REWARDED_AD_DURATION_SECONDS >= 60 && REWARDED_AD_DURATION_SECONDS % 60 === 0
    ? `${REWARDED_AD_DURATION_SECONDS / 60}-minute`
    : `${REWARDED_AD_DURATION_SECONDS}-second`;

/** The offer, worded once so the modal and any future surface agree. */
export const REWARDED_AD_OFFER_LABEL =
  `Watch a ${REWARDED_AD_DURATION_LABEL} ad to claim ${REWARDED_AD_GOLD.toLocaleString("en-US")} Gold`;

/**
 * The balance under which the lobby's "Get Free Gold" row appears:
 * TIER_CONFIG[CHEAPEST_TIER].minBuyIn, a player who can't sit at the
 * cheapest table. Named here, off the tier ladder rather than a bare 1,000,
 * so the row and the copy it shows can never disagree about what "eligible"
 * means.
 */
export const REWARDED_AD_ELIGIBLE_BELOW = TIER_CONFIG[CHEAPEST_TIER].minBuyIn;
