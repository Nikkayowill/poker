/**
 * The Pixel Pilgrim: StackAcres' first interactable character.
 *
 * He does not walk anywhere and he answers to nobody's queue -- he is posted
 * at his own shrine, tucked in the Farmstead's own far corner rather than
 * the barnyard, and the only thing that ever moves is his bow. A tap on him
 * is not itself a prayer: stackacres-farm.tsx opens a dialogue first (his
 * own lines, then "will you pray with me?"), and only a "yes" there calls
 * startMonkBow and sends the server's `pray` action -- see
 * lib/stackacres/devotion.ts for what that earns. Declining costs nothing
 * and asks nothing; there is no penalty for walking away.
 *
 * His shrine is real art now, one of five houses from a supplied "Houses
 * Pack 3" asset set (see stackacres-sprites.ts's `monkHouse`), not the
 * hand-drawn Graphics volume the first pass shipped with -- see
 * `paintMonkHouse` in stackacres-scene.ts. His post used to be the
 * farmhand's own former `FARMHAND_BASE`, right beside the barn; Kayo moved
 * him out to the Farmstead's own perimeter once the shrine had real art, on
 * the reasoning that a visitor "not from this world" standing shoulder to
 * shoulder with the well and the hay bales undercut the whole point.
 * `MONK_POST`/`MONK_HOUSE_FOOTPRINT` carry the same six-constraint proof
 * `FARMHAND_BASE` did (clear of the barn, every path, the pond, and the
 * Farmstead's fence, inside the camera's world bounds) -- see monk.test.ts.
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

/**
 * Where he stands and bows -- the open ground between the barn and the Hen
 * Coop, well clear of the barnyard clutter, the road, and the pen fence
 * itself. The first cut of this post (74..140, 300..346) put him only ~30
 * units off the Hen Coop's own west edge (170..360), close enough that the
 * shrine visibly leaned on the pen fence in-game -- Kayo caught it from a
 * screenshot after the PR had already landed. None of the existing
 * constraints below actually guarded against that: they clear the barn, the
 * paths, the pond and Ray's own post, but nothing here ever measured
 * distance to the Hen Coop block itself (`./world.ts`'s
 * `GROW_AREA.farmstead`, x 170..330, y 200..360), so a placement that leaned
 * on the pen passed every existing check. This post sits ~74 units north of
 * the pen's own top edge instead -- also clear of the generated `henCoop`
 * path spur (`./paths.ts`'s `FARMSTEAD_PATH_NODES`, a straight connector
 * from the road down to (280, 180)), which the old spot never had to share
 * space with either. Still inside `FARM_ZONE` and still `farmstead`'s own
 * territory (`zoneAt` returns null here, same as `FARMHAND_BASE` used to).
 */
export const MONK_POST: WorldPoint = { x: 170, y: 140 };

/**
 * The shrine's footprint, in the same feet-anchored ground-rect convention
 * `BARN_FOOTPRINT`/`GROW_AREA` use (x/y is the top-left corner in world
 * units). Sits just north of `MONK_POST` -- he stands in front of his own
 * door -- small enough to clear the barn, the lane/road/spur paths, the
 * pond, the Farmstead fence and (see `MONK_POST`'s own comment) the Hen
 * Coop's pen itself at every corner; monk.test.ts holds all of it the same
 * way farmhand.test.ts holds `FARMHAND_BASE`. Its north edge moved 80 -> 88
 * when the road became two and a half tiles wide (./roads.ts): the road's
 * body reaches y 78 now and its scenery clearance y 84.
 */
export const MONK_HOUSE_FOOTPRINT: WorldRect = { x: 140, y: 88, width: 66, height: 46 };

/** Whether a tapped ground point lands on the shrine -- the Pixel Pilgrim's
 *  own tap target, same shape as `barnHitAt` in ./world.ts. Checked against
 *  the footprint independent of whether his sprite ever baked, so praying
 *  still works if the sheet fails to load (see stackacres-scene.ts's
 *  `spawnMonkNode`). */
export function monkHitAt(x: number, y: number): boolean {
  return (
    x >= MONK_HOUSE_FOOTPRINT.x &&
    x <= MONK_HOUSE_FOOTPRINT.x + MONK_HOUSE_FOOTPRINT.width &&
    y >= MONK_HOUSE_FOOTPRINT.y &&
    y <= MONK_HOUSE_FOOTPRINT.y + MONK_HOUSE_FOOTPRINT.height
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
