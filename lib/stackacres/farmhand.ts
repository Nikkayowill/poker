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

import type { WorldPoint } from "./world";

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

/**
 * World units a second. Faster than every animal here (a hen is 14, a cow 7)
 * because he is running an errand rather than grazing, and because the walk
 * is the part of this the player is waiting through.
 */
export const FARMHAND_SPEED = 20;

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

/** Arrival dead-band, in world units. Straight from `stepCritter`: a target
 *  reached within a stride is SNAPPED to rather than eased toward, which is
 *  what stops a walk ending in a permanent sub-pixel shuffle. */
const ARRIVE_WITHIN = 0.75;

/** The longest frame this will integrate, matching `stepCritter` and
 *  `stepGait`. A phone returning from a background tab hands the scene one
 *  enormous delta, and he did not walk for that whole time either. */
const MAX_FRAME_MS = 250;

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

export interface Farmhand {
  x: number;
  y: number;
  phase: FarmhandPhase;
  /** Where he is heading. Equal to his own position while idle. */
  targetX: number;
  targetY: number;
  /** Milliseconds left of the action he is playing. Zero outside `working`. */
  workMs: number;
  /** The unit he has claimed, null while idle or walking home. */
  unitId: string | null;
  /**
   * Which way along the SCREEN's x axis he is heading: 1 right, -1 left.
   * Screen rather than world for the same reason `Critter.facing` is -- the
   * iso projection puts screen x at (world x - world y), so a step due +y
   * reads as leftward however its world x looks.
   */
  facing: 1 | -1;
  /**
   * The other half of the four isometric diagonals: 1 walking TOWARD the
   * camera (down the picture, growing x + y), -1 walking away from it.
   *
   * Two signs, four combinations, and they are exactly the four diagonals a
   * 2:1 tile has: (+1, +1) is SE, (-1, +1) SW, (+1, -1) NE, (-1, -1) NW. A
   * mirror can only ever express `facing`, which is why this needs a second
   * piece of art rather than a second flip -- see the `farmhand` and
   * `farmhandBack` painters in art-props.ts.
   */
  towards: 1 | -1;
  /** World units walked, ever. Drives the hop cycle in ./farmhand-hop.ts,
   *  which is tied to DISTANCE rather than time for the same reason the
   *  animals' sway is. */
  travelled: number;
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

/**
 * Which way a step reads on screen. A step that is equal parts +x and +y runs
 * straight up or down the picture and is not a turn either way, so a tie
 * keeps the sign he already had rather than flipping him to some default
 * every time a target happens to land on the diagonal. Same rule, and same
 * reason, as `headingTo` in ./world.ts.
 */
function heading(along: number, current: 1 | -1): 1 | -1 {
  if (along === 0) return current;
  return along > 0 ? 1 : -1;
}

/** Both facing signs for a step, in one place so `travelling` and
 *  `returning` can never drift apart on it. */
function aim(hand: Farmhand, dx: number, dy: number): Pick<Farmhand, "facing" | "towards"> {
  return { facing: heading(dx - dy, hand.facing), towards: heading(dx + dy, hand.towards) };
}

/** One frame of walking toward the current target. Returns the moved hand
 *  and whether it arrived. */
function advance(hand: Farmhand, dt: number): { hand: Farmhand; arrived: boolean } {
  const dx = hand.targetX - hand.x;
  const dy = hand.targetY - hand.y;
  const distance = Math.hypot(dx, dy);
  const stride = FARMHAND_SPEED * dt;
  const facing = aim(hand, dx, dy);

  if (distance <= Math.max(stride, ARRIVE_WITHIN)) {
    return {
      hand: {
        ...hand,
        ...facing,
        x: hand.targetX,
        y: hand.targetY,
        travelled: hand.travelled + distance,
      },
      arrived: true,
    };
  }
  return {
    hand: {
      ...hand,
      ...facing,
      x: hand.x + (dx / distance) * stride,
      y: hand.y + (dy / distance) * stride,
      travelled: hand.travelled + stride,
    },
    arrived: false,
  };
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
 */
export function stepFarmhand(
  hand: Farmhand,
  next: FarmhandTask | null,
  dtMs: number,
): FarmhandStep {
  const dt = Math.max(0, Math.min(dtMs, MAX_FRAME_MS)) / 1000;

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
    return { hand: advance(claimed, dt).hand, claimed: true, finished: false };
  }

  if (hand.phase === "travelling") {
    // The unit he was walking to is gone: collected by a second tap, cleared,
    // or refetched away. Nothing to play an animation at any more.
    if (!next || next.unitId !== hand.unitId) {
      return { hand: headHome(hand), claimed: false, finished: false };
    }
    // Re-aim every frame: livestock keeps wandering while he crosses the yard.
    const chasing: Farmhand = { ...hand, targetX: next.x, targetY: next.y };
    const moved = advance(chasing, dt);
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
    const moved = advance(hand, dt);
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
