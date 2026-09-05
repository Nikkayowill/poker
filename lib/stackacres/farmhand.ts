/**
 * The farmhand: the one person on this map who moves because the player did
 * something, rather than because he felt like it.
 *
 * He is PRESENTATION, not authority. The tap that sends him has already gone
 * to the server by the time he takes a step (see `onWorldUnitTap` in
 * stackacres-farm.tsx), and nothing he does can send, delay or cancel a
 * request. That is deliberate and it is the property to defend: gating a
 * write on a walk animation would mean a closed tab loses the action, and a
 * trip across a district is seconds of waiting bolted onto a loop that was
 * made instant on purpose. He answers the tap; he does not carry it.
 *
 * Three consequences of that, all of them simplifications:
 *   * he never needs to know what a unit costs, yields or affords;
 *   * a task he cannot finish is a task he can simply drop; and
 *   * the queue below can be small and forgetful, because losing an entry
 *     loses an animation and never a harvest.
 *
 * He works the FARMSTEAD only. The four districts sit hundreds of units
 * apart (`GROW_AREA` in ./world.ts), so a walk out to Ox Fields or the
 * Wallow is a minute of watching a man cross a field. Tasks in another
 * district are simply not queued; the scene checks `stockZone` before it
 * offers him one.
 *
 * Lives in lib/ rather than beside the scene for the usual reason: vitest
 * only reaches lib/ and app/, and this is the part that is arithmetic rather
 * than Phaser. Its neighbours are ./gait.ts (how an animal is held while it
 * walks) and `stepCritter` in ./world.ts (how an animal wanders); this is
 * the third member of that family and follows both of their conventions --
 * pure, returning a new state object, clamping its own frame internally.
 */

import {
  FARMHAND_SPEED,
  advanceTowards,
  frameSeconds,
  type Walker,
} from "./farmhand-path";
import type { WorldPoint } from "./world";

/** Re-exported because this was its home before ./farmhand-path.ts existed
 *  and both the scene and farmhand.test.ts import it from here. */
export { FARMHAND_SPEED };

/**
 * Where he stands when there is nothing to do: the yard between the barn and
 * the hen ground, a few steps off the lane.
 *
 * Hand-placed, and the constraints are worth stating because they are what a
 * future move has to keep: clear of `BARN_FOOTPRINT` and of Ray's own post at
 * (175, 20), off every polyline in ./paths.ts, outside `POND_ZONE`, outside
 * the Farmstead's own grow area (standing inside the fence would put him in
 * amongst the hens and make him a tap target competing with them), and inside
 * `FARM_ZONE` so the camera's home shot actually contains him.
 * farmhand.test.ts holds all six.
 */
export const FARMHAND_BASE: WorldPoint = { x: 156, y: 168 };

/** How long he spends bent over the job before heading home. Long enough to
 *  read as work at a glance, short enough that a second tap is not queued
 *  behind a wait. */
export const FARMHAND_WORK_MS = 1_100;

/**
 * Where he stands to work on something, relative to the thing itself.
 *
 * BESIDE IT, NOT IN FRONT OF IT, and that is the whole content of these two
 * numbers. The first cut put him a few units toward the camera, which sorts
 * correctly and looks completely wrong: he is forty units tall and a hen is
 * about ten, so standing in front of one hides it entirely and the collect
 * animation plays over what looks like bare straw. Only a screenshot showed
 * it.
 *
 * The offset is authored in SCREEN terms and converted once here, because
 * "beside" is a screen word and world x alone is a diagonal. A pure +x step
 * projects to (+13, +6.5): thirteen units to the right, six and a half down.
 * Right of the animal clears its picture, and the half-step toward the camera
 * that comes free with it sorts him in front of the fence he is leaning over.
 */
export const FARMHAND_STANDOFF = 13;

/** Where he stands to work on something at `at`. */
export function farmhandStandoff(at: WorldPoint): WorldPoint {
  return { x: at.x + FARMHAND_STANDOFF, y: at.y };
}

/**
 * The four states, and the only four.
 *
 * `idle` is standing at `FARMHAND_BASE`. `travelling` is on the way to a
 * unit. `working` is the action timer playing at the unit's feet.
 * `returning` is the walk home, and it is interruptible: a task arriving
 * mid-walk turns him around rather than making him finish the trip first.
 */
export type FarmhandPhase = "idle" | "travelling" | "working" | "returning";

/** One job: a unit to walk to. The point is the unit's CURRENT ground spot,
 *  not a snapshot -- a hen keeps wandering while he crosses the yard, so the
 *  caller re-reads it every frame and `stepFarmhand` re-aims at it. */
export interface FarmhandTask {
  unitId: string;
  x: number;
  y: number;
}

export interface Farmhand extends Walker {
  phase: FarmhandPhase;
  /** Where he is heading. Equal to his own position while idle. */
  targetX: number;
  targetY: number;
  /** Milliseconds left of the action he is playing. Zero outside `working`. */
  workMs: number;
  /** The unit he has claimed, null while idle or walking home. */
  unitId: string | null;
}

export interface FarmhandStep {
  hand: Farmhand;
  /** True on the one frame he took `next` on. The caller pops its queue. */
  claimed: boolean;
  /** True on the one frame he finished a job and turned for home. */
  finished: boolean;
}

export function spawnFarmhand(): Farmhand {
  return {
    x: FARMHAND_BASE.x,
    y: FARMHAND_BASE.y,
    phase: "idle",
    targetX: FARMHAND_BASE.x,
    targetY: FARMHAND_BASE.y,
    workMs: 0,
    unitId: null,
    // Facing down the picture, toward the camera and toward the hen ground,
    // which is where he is looking when the player arrives at the farm.
    facing: 1,
    towards: 1,
    travelled: 0,
  };
}

/** Whether he is putting one foot in front of the other right now. What the
 *  hop and the scene's own mirror both key off. */
export function farmhandWalking(hand: Farmhand): boolean {
  return hand.phase === "travelling" || hand.phase === "returning";
}

/** One frame of walking toward the current target, in the shared walk of
 *  ./farmhand-path.ts -- `targetX`/`targetY` are this file's own way of
 *  carrying a destination, so they are unpacked into a point here rather
 *  than pushed down into a primitive the automation does not share. */
function advance(hand: Farmhand, dt: number, speed: number): { hand: Farmhand; arrived: boolean } {
  const step = advanceTowards(hand, { x: hand.targetX, y: hand.targetY }, dt, speed);
  return { hand: step.walker, arrived: step.arrived };
}

function headHome(hand: Farmhand): Farmhand {
  return {
    ...hand,
    phase: "returning",
    targetX: FARMHAND_BASE.x,
    targetY: FARMHAND_BASE.y,
    workMs: 0,
    unitId: null,
  };
}

/**
 * One tick of the farmhand's day.
 *
 * `next` is the job the caller wants him on: the task he has already claimed
 * (with its coordinates re-read this frame, since the unit may have wandered)
 * while `hand.unitId` is set, or the head of the queue while it is not. Null
 * means there is nothing to do -- or, while he is on his way somewhere, that
 * the unit he was walking to has gone, which aborts the trip rather than
 * marching him to a spot where nothing is standing any more.
 *
 * `speedMultiplier` defaults to 1 -- every existing call site is unaffected.
 * It is the Synergy Tree's `automated_logistics` perk
 * (`StackAcresView.synergy.farmhandSpeedMultiplier`), applied to
 * `FARMHAND_SPEED` here rather than baked into the constant itself, since
 * the constant is also this file's public name for "how fast he walks" and
 * changing its meaning per-caller would be surprising to anything else that
 * reads it.
 */
export function stepFarmhand(
  hand: Farmhand,
  next: FarmhandTask | null,
  dtMs: number,
  speedMultiplier = 1,
): FarmhandStep {
  const dt = frameSeconds(dtMs);
  const speed = FARMHAND_SPEED * speedMultiplier;

  // Free to take work: standing at base, or on the way back to it. Claiming
  // mid-walk-home is the interesting one -- he turns around where he stands
  // rather than finishing a trip nobody is waiting on.
  if ((hand.phase === "idle" || hand.phase === "returning") && next) {
    const claimed: Farmhand = {
      ...hand,
      phase: "travelling",
      unitId: next.unitId,
      targetX: next.x,
      targetY: next.y,
    };
    // Move on the same frame he is given the job, so a task arriving on a
    // frame with a long delta does not silently lose it.
    return { hand: advance(claimed, dt, speed).hand, claimed: true, finished: false };
  }

  if (hand.phase === "travelling") {
    // The unit he was walking to is gone: collected by a second tap, cleared,
    // or refetched away. Nothing to play an animation at any more.
    if (!next || next.unitId !== hand.unitId) {
      return { hand: headHome(hand), claimed: false, finished: false };
    }
    // Re-aim every frame: livestock keeps wandering while he crosses the yard.
    const chasing: Farmhand = { ...hand, targetX: next.x, targetY: next.y };
    const moved = advance(chasing, dt, speed);
    if (!moved.arrived) return { hand: moved.hand, claimed: false, finished: false };
    return {
      hand: { ...moved.hand, phase: "working", workMs: FARMHAND_WORK_MS },
      claimed: false,
      finished: false,
    };
  }

  if (hand.phase === "working") {
    const workMs = hand.workMs - dt * 1000;
    // Deliberately NOT aborted when `next` goes null. He is already standing
    // over it, and cutting the animation short the instant the server answers
    // would mean the job is only ever seen being finished on a slow
    // connection.
    if (workMs > 0) return { hand: { ...hand, workMs }, claimed: false, finished: false };
    return { hand: headHome(hand), claimed: false, finished: true };
  }

  if (hand.phase === "returning") {
    const moved = advance(hand, dt, speed);
    if (!moved.arrived) return { hand: moved.hand, claimed: false, finished: false };
    return { hand: { ...moved.hand, phase: "idle" }, claimed: false, finished: false };
  }

  return { hand, claimed: false, finished: false };
}

/* ------------------------------------------------------------------ */
/* The task queue                                                      */
/* ------------------------------------------------------------------ */

/**
 * How many jobs he will hold.
 *
 * Small on purpose. A player mashing across a row of ready hens can outrun
 * him by an order of magnitude, and a queue that accepted all of it would
 * have him plodding through a backlog of animations for actions that
 * finished a minute ago. Four is about as far behind the player as he can be
 * and still look like he is helping.
 */
export const FARMHAND_QUEUE_MAX = 4;

/**
 * Add a job, or don't.
 *
 * Returns the SAME array when nothing changed, so the caller can skip its own
 * work on the common case (a second tap on the unit he is already walking to,
 * which is what a mashed ready hen produces). Refuses rather than evicts when
 * full: dropping the oldest would mean the tap he is currently walking to
 * could be forgotten out from under him.
 */
export function enqueueFarmhandTask(
  queue: readonly FarmhandTask[],
  task: FarmhandTask,
): readonly FarmhandTask[] {
  if (queue.some((queued) => queued.unitId === task.unitId)) return queue;
  if (queue.length >= FARMHAND_QUEUE_MAX) return queue;
  return [...queue, task];
}

/** Drop every job whose unit is no longer standing there. Returns the same
 *  array when nothing was dropped, for the same reason `enqueue` does. */
export function pruneFarmhandTasks(
  queue: readonly FarmhandTask[],
  alive: (unitId: string) => boolean,
): readonly FarmhandTask[] {
  const kept = queue.filter((task) => alive(task.unitId));
  return kept.length === queue.length ? queue : kept;
}
