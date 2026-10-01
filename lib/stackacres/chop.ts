/**
 * The chop swing: the skill half of felling a tree (./wood.ts).
 *
 * Pure and renderer-free, same split ./fishing-gauge.ts and
 * ./hunt-proximity.ts keep against their own scenes -- every number a frame
 * needs comes out of this file.
 *
 * SHAPE, BORROWED FROM ./fishing-gauge.ts. A single marker sweeps back and
 * forth across a track on its own; the player has one press per swing, timed
 * against the sweep, not a hold-and-track fight across several seconds. A
 * fish fight or a stalk is the right shape for something the player watches
 * for a while; felling a tree is a farm chore that should read as "a couple
 * of quick, satisfying whacks", so this reuses the sweep-and-press IDEA
 * (a moving target, a timing window, immediate feedback) without the fight's
 * own duration or drain -- one swing is one press, full stop.
 *
 * WHAT THIS DOES NOT DECIDE. Whether a swing lands at all -- whether the
 * tree is even choppable right now -- is ./wood.ts's `isWoodNodeChoppable`,
 * checked (and re-checked under the row's version) on the server. This
 * module only grades the TIMING of a swing that the server has already
 * agreed to accept, the same "client picks a quality flag, server owns the
 * real state" shape `catch-fish`'s `bait` boolean already takes.
 */

/** How long one full sweep of the marker takes, in ms -- deliberately quick:
 *  this is a farm game, not a chore simulator, so a swing is over in under a
 *  second whether or not the player is even watching closely. */
export const CHOP_SWEEP_MS = 850;

/** The sweet zone a press must land in for a `sweet` swing, as a 0..1 span
 *  of the sweep. Centred so a player who presses "about halfway" already
 *  lands respectably often, and widened past a hair-trigger window so the
 *  audience this game is built for (see feedback_stackacres_young_audience_
 *  legibility) can actually hit it on purpose once they've watched one
 *  sweep go by. */
export const CHOP_SWEET_ZONE = { min: 0.62, max: 0.88 } as const;

/** Marker position, 0..1, at `elapsedMs` into a swing -- a triangle wave
 *  (out and back), not a sine, so the marker's speed is constant and a
 *  "just watch it and press at the same spot" strategy actually works.
 */
export function chopMeterValue(elapsedMs: number): number {
  const cycle = (elapsedMs % (CHOP_SWEEP_MS * 2)) / CHOP_SWEEP_MS;
  return cycle <= 1 ? cycle : 2 - cycle;
}

/** Whether a press landing on `value` (0..1, from `chopMeterValue`) counts
 *  as a sweet hit. */
export function isChopSweetHit(value: number): boolean {
  return value >= CHOP_SWEET_ZONE.min && value <= CHOP_SWEET_ZONE.max;
}

/** One swing, graded from when it started to when the player pressed.
 *  `pressedAtMs` is elapsed ms since the swing began, from the same clock
 *  the scene is already animating the marker with. */
export function gradeChopSwing(pressedAtMs: number): { value: number; sweet: boolean } {
  const value = chopMeterValue(Math.max(0, pressedAtMs));
  return { value, sweet: isChopSweetHit(value) };
}
