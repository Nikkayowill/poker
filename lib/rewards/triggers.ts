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
 * used to describe.
 *
 * `kind` is set by that one call site and read by nothing -- neither
 * `rewarded-ad-modal.tsx` nor anywhere else. It stays as a field rather than
 * being deleted because `components/poker-app.tsx`'s `FREE_GOLD_TRIGGER`
 * constructs it as a typed object literal; narrowing this type would need
 * that call site edited in the same pass, not left dangling.
 */
export interface RewardTrigger {
  kind: "low-gold";
  /** The line above the offer. Fixed strings, never interpolated prose. */
  headline: string;
  /** One sentence of why this appeared. */
  detail: string;
}
