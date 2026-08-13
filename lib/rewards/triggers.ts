/**
 * The shape of a rewarded-ad offer.
 *
 * Used to carry a single kind, "low-gold", plus three others
 * ("first-win"/"big-pot"/"win-streak") that an automatic in-game watcher
 * (`advanceRewardWatch`, formerly here) offered uninvited whenever a hand
 * settled -- which meant the modal could pop up mid-game and, per session
 * feedback, too often. That watcher and its hook
 * (components/rewards/use-game-achievements.ts) are gone; the modal now opens
 * only from the lobby's "Get Free Gold" row (components/poker-app.tsx), which
 * is lobby-only and gated on the same below-cheapest-buy-in check "low-gold"
 * used to describe. `kind` is kept as a field, not collapsed away, because the
 * modal still reads it for bookkeeping and a narrower type here would ripple
 * into components/rewards/rewarded-ad-modal.tsx for no benefit.
 */
export type RewardTriggerKind = "low-gold";

export interface RewardTrigger {
  kind: RewardTriggerKind;
  /** The line above the offer. Fixed strings, never interpolated prose. */
  headline: string;
  /** One sentence of why this appeared. */
  detail: string;
}
