/**
 * The swing: the skill half of a graded, one-tap strike -- shared by felling
 * a tree (./wood.ts) and mining a boulder (./stone-nodes.ts).
 *
 * Pure and renderer-free, same split ./fishing-gauge.ts and
 * ./hunt-proximity.ts keep against their own scenes -- every number a frame
 * needs comes out of this file.
 *
 * SHAPE, BORROWED FROM ./fishing-gauge.ts. A single marker sweeps back and
 * forth across a track on its own; the player has one press per swing, timed
 * against the sweep, not a hold-and-track fight across several seconds. A
 * fish fight or a stalk is the right shape for something the player watches
 * for a while; a chop or a mine swing is a farm chore that should read as "a
 * couple of quick, satisfying whacks", so this reuses the sweep-and-press
 * IDEA (a moving target, a timing window, immediate feedback) without the
 * fight's own duration or drain -- one swing is one press, full stop.
 *
 * WHAT THIS DOES NOT DECIDE. Whether a swing lands at all -- whether the
 * tree is choppable, or the boulder mineable, right now -- is
 * ./wood.ts's `isWoodNodeChoppable` / ./stone-nodes.ts's `isNodeMineable`,
 * checked (and re-checked under the row's version) on the server. This
 * module only grades the TIMING of a swing that the server has already
 * agreed to accept, the same "client picks a quality flag, server owns the
 * real state" shape `catch-fish`'s `bait` boolean already takes.
 *
 * ONE KIND, ONE TRACK. Chopping and mining share the exact same
 * sweep-and-grade mechanic and the same UI (components/arcade/stackacres/
 * stackacres-chop-popup.tsx) -- only the sweep speed and the sweet zone's
 * width/position differ, tuned separately below so the two materials never
 * feel like they play identically.
 */

export type SwingKind = "chop" | "mine";

export interface SwingProfile {
  /** How long one one-way sweep of the marker takes, in ms. */
  readonly sweepMs: number;
  /** The sweet zone a press must land in for a `sweet` swing, as a 0..1 span
   *  of the sweep. */
  readonly sweetZone: { readonly min: number; readonly max: number };
}

/**
 * One profile per kind. Chopping is the original, tuned-by-feel shape:
 * quick, and a sweet zone wide enough that the audience this game is built
 * for (see feedback_stackacres_young_audience_legibility) can actually hit
 * it on purpose once they've watched one sweep go by. Mining sweeps a touch
 * faster and grades on a narrower zone -- Stone is meant to reward precision
 * a little more than Wood does, the same "tougher than wood" posture
 * ./stone-nodes.ts's `HITS_TO_BREAK` and slower `REGROW_MS` already take.
 */
export const SWING_PROFILES: Readonly<Record<SwingKind, SwingProfile>> = {
  chop: { sweepMs: 850, sweetZone: { min: 0.62, max: 0.88 } },
  mine: { sweepMs: 690, sweetZone: { min: 0.42, max: 0.58 } },
};

/** Marker position, 0..1, at `elapsedMs` into a swing -- a triangle wave
 *  (out and back), not a sine, so the marker's speed is constant and a
 *  "just watch it and press at the same spot" strategy actually works. */
export function swingMeterValue(kind: SwingKind, elapsedMs: number): number {
  const { sweepMs } = SWING_PROFILES[kind];
  const cycle = (elapsedMs % (sweepMs * 2)) / sweepMs;
  return cycle <= 1 ? cycle : 2 - cycle;
}

/** Whether a press landing on `value` (0..1, from `swingMeterValue`) counts
 *  as a sweet hit. */
export function isSwingSweetHit(kind: SwingKind, value: number): boolean {
  const { sweetZone } = SWING_PROFILES[kind];
  return value >= sweetZone.min && value <= sweetZone.max;
}

/** One swing, graded from when it started to when the player pressed.
 *  `pressedAtMs` is elapsed ms since the swing began, from the same clock
 *  the scene/popup is already animating the marker with. */
export function gradeSwing(kind: SwingKind, pressedAtMs: number): { value: number; sweet: boolean } {
  const value = swingMeterValue(kind, Math.max(0, pressedAtMs));
  return { value, sweet: isSwingSweetHit(kind, value) };
}
