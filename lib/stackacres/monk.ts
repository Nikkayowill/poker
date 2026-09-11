/**
 * The Pixel Pilgrim: StackAcres' first interactable character.
 *
 * He does not walk anywhere and he answers to nobody's queue -- he is posted
 * at his own spot, tucked by the pond rather than the barnyard, and the only
 * thing that ever moves is his bow. A tap on him is not itself a prayer:
 * stackacres-farm.tsx opens a dialogue first (his own lines, then "will you
 * pray with me?"), and only a "yes" there calls startMonkBow and sends the
 * server's `pray` action -- see lib/stackacres/devotion.ts for what that
 * earns. Declining costs nothing and asks nothing; there is no penalty for
 * walking away.
 *
 * He has no shrine any more. The "Houses Pack 3" cottage that used to stand
 * behind him (`paintMonkHouse` in stackacres-scene.ts, `monkHouse` in
 * stackacres-sprites.ts) is gone -- Kayo's call, once the barn's own art
 * refresh made a second borrowed house next to it read as clutter -- and he
 * was moved out to the pond's own south-west bank rather than re-planted
 * where the barnyard's shrine used to stand. `MONK_POST` is now his own tap
 * target directly (`MONK_TAP_ZONE`, a standing-character box, not a
 * building's footprint); see monk.test.ts.
 *
 * His animation is not new art -- Kayo pointed at the exact frame to reuse:
 * the farmhand's own crouch/"work" pose (RANGER_FRAME.work in
 * stackacres-scene.ts, the same one held for a hen or a cow), because it
 * already reads as a bow. MONK_BOW_MS is FARMHAND_WORK_MS unchanged, for the
 * same reason.
 *
 * Pure and Phaser-free, same posture as ./farmhand.ts and ./gait.ts: no
 * Date.now(), no Math.random(), no Image -- delta and randomness (none
 * needed here) are always parameters, so vitest can drive it directly.
 */

import { FARMHAND_WORK_MS } from "./farmhand";
import type { WorldPoint, WorldRect } from "./world";
// A strict leaf (./yard.ts imports nothing), so this is a plain value import
// with no cycle to work around. Carries the Farmstead yard's offset: the
// literals below are the numbers the yard was originally laid out with, and
// every doc comment here that names one is still true.
import { yardPoint } from "./yard";

/**
 * Where he stands and bows: the pond's own south-west bank, on the sand past
 * the waterline rather than in the barnyard. (-106, 184) sits south-west of
 * the pond's centre (./water.ts's `POND`, local (-44, 120)) -- clear of the
 * dock, the lily pads, the reeds and the ripple spots (25+ units from the
 * nearest of any, monk.test.ts holds the whole `MONK_TAP_ZONE` box to it,
 * not just this point) and clear of `nearPath`.
 *
 * NOT required to clear `inPondZone` -- the opposite, in fact: standing near
 * the water is the point now, not a violation of it, so the whole
 * `MONK_TAP_ZONE` box is deliberately INSIDE `inPondZone`. That is load-
 * bearing, not decoration: `chunkScenery` (./world.ts) refuses to grow wild
 * trees and bushes anywhere `blocked()` is true, and `blocked()` treats
 * `inPondZone` as one of its own reasons to refuse -- the same clearance a
 * grown tree gets near the water. The first placement (south of the pond,
 * clear of the water but also clear of `inPondZone`) sat in ordinary
 * unblocked ground instead, and a screenshot caught it standing behind a
 * wall of procedurally-planted pine. He still has to clear the water
 * itself -- the box's own north edge (40 units back from his feet, the same
 * "extends back into the screen" convention `BARN_FOOTPRINT`/
 * `MIDNIGHT_MERCHANT_FOOTPRINT` anchor a standing figure's box with) never
 * dips below `inPond`'s own waterline, at any corner.
 */
export const MONK_POST: WorldPoint = yardPoint(-106, 184);

/**
 * His own tap target: a standing-character box anchored above his feet, the
 * same shape `MIDNIGHT_MERCHANT_FOOTPRINT` (./world.ts) uses for a figure
 * with no building of his own -- 26 wide (a person, not a house) by 40 tall
 * (extending back from `MONK_POST` the same "feet at the box's own south
 * edge" convention every standing figure here anchors with). Replaces the
 * old `MONK_HOUSE_FOOTPRINT`, which was sized for the shrine that used to
 * stand behind him; now that there is no building, the box is sized to him
 * alone.
 */
export const MONK_TAP_ZONE: WorldRect = {
  x: MONK_POST.x - 13,
  y: MONK_POST.y - 40,
  width: 26,
  height: 40,
};

/** Whether a tapped ground point lands on the Pixel Pilgrim -- his own tap
 *  target, same shape as `barnHitAt` in ./world.ts. Checked independent of
 *  whether his sprite ever baked, so praying still works if the sheet fails
 *  to load (see stackacres-scene.ts's `spawnMonkNode`). */
export function monkHitAt(x: number, y: number): boolean {
  return (
    x >= MONK_TAP_ZONE.x &&
    x <= MONK_TAP_ZONE.x + MONK_TAP_ZONE.width &&
    y >= MONK_TAP_ZONE.y &&
    y <= MONK_TAP_ZONE.y + MONK_TAP_ZONE.height
  );
}

/** How long one bow holds the crouch pose before he rises -- the farmhand's
 *  own work timer, unchanged (see the module doc comment for why). */
export const MONK_BOW_MS = FARMHAND_WORK_MS;

/** His whole state: how much of the current bow is left. Zero is standing. */
export interface MonkPose {
  bowMs: number;
}

/** Standing, at rest. */
export function spawnMonk(): MonkPose {
  return { bowMs: 0 };
}

/** Starts (or restarts) one bow -- called the instant the player answers
 *  "yes" to his dialogue, optimistically, before the server has answered.
 *  Takes no state in: a bow always starts full, whether or not one was
 *  already in progress. */
export function startMonkBow(): MonkPose {
  return { bowMs: MONK_BOW_MS };
}

/** One frame's render instruction: which pose to draw, and how far to lift
 *  the sprite this frame (a screen-space offset in pixels, applied to y only
 *  -- never depth, so the bow never changes his draw order). */
export interface MonkFrame {
  crouched: boolean;
  bobLift: number;
}

/** How high the bow lifts him at its peak, in screen pixels. Small: this is
 *  a nod, not a jump. */
const BOB_AMP = 3;

/** The render instruction for a given pose, with no time step involved --
 *  shared by `stepMonk`'s early-outs and its normal path so both agree on
 *  what a given `bowMs` looks like. */
function frameFor(pose: MonkPose): MonkFrame {
  if (pose.bowMs <= 0) return { crouched: false, bobLift: 0 };
  // 0 at the start of the bow, peak at its middle, 0 again as he rises --
  // a single half sine over the hold, driven by how much of it is left.
  const progress = 1 - pose.bowMs / MONK_BOW_MS;
  return { crouched: true, bobLift: Math.sin(progress * Math.PI) * BOB_AMP };
}

/**
 * Steps one frame of the bow. `delta` is milliseconds and, like every other
 * per-frame stepper in this package (farmhand-path.ts's `frameSeconds`,
 * world.ts's `clampFrameMs`), is clamped against a backgrounded-tab spike so
 * one huge frame can only ever finish the current bow, never wrap past it;
 * a non-positive delta is a no-op that returns the same pose unchanged.
 */
export function stepMonk(pose: MonkPose, delta: number): { pose: MonkPose; frame: MonkFrame } {
  if (pose.bowMs <= 0 || !(delta > 0)) return { pose, frame: frameFor(pose) };
  const bowMs = Math.max(0, pose.bowMs - Math.min(delta, MONK_BOW_MS));
  const next = { bowMs };
  return { pose: next, frame: frameFor(next) };
}
