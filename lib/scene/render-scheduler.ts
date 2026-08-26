/**
 * When the canvas is allowed to draw.
 *
 * A poker table is static almost all of the time. Between a player acting and
 * the next player acting there is nothing moving on the felt at all, and a
 * `requestAnimationFrame` loop that redraws a lit, shadowed 3D scene sixty
 * times a second through those gaps costs a phone its battery and its thermal
 * headroom for no frames anyone can tell apart. So the loop sleeps, and
 * anything that changes the picture has to say so.
 *
 * The whole thing is a two-field state machine kept pure and in `lib/` so it
 * can actually be tested: getting this wrong in either direction is a bug you
 * cannot see in a screenshot. Sleeping too eagerly drops the last frames of
 * an animation and chips freeze mid-air; never sleeping just quietly burns
 * the battery and looks perfect.
 */

/**
 * How long the loop keeps drawing after the last thing that moved.
 *
 * Not zero, for two independent reasons. A friction slide is asymptotic and
 * reports "arrived" a frame or two before it is visually at rest, and a
 * material fade driven by the same loop needs a frame after its last update
 * to actually present. Four hundred milliseconds is comfortably past both and
 * still short enough that an idle table is asleep before a player has
 * finished reading the last action in the feed.
 */
export const IDLE_LINGER_MS = 400;

export interface SchedulerState {
  /** True while the render loop should keep requesting frames. */
  awake: boolean;
  /**
   * When something last moved. Null while asleep, which is what makes
   * `isAwake` derivable rather than a second source of truth that could
   * disagree with `awake`.
   */
  lastMotionMs: number | null;
}

export const SLEEPING: SchedulerState = { awake: false, lastMotionMs: null };

/**
 * Mark the scene dirty.
 *
 * Called by everything that changes the picture: a chip entering flight, a
 * seat changing, the pot growing, a resize, a texture finishing loading. It's
 * cheap and idempotent, so callers never have to ask whether the loop is
 * already running before telling it something happened.
 */
export function markDirty(state: SchedulerState, nowMs: number): SchedulerState {
  if (state.awake && state.lastMotionMs === nowMs) return state;
  return { awake: true, lastMotionMs: nowMs };
}

/**
 * Advance the machine by one drawn frame.
 *
 * `motion` is whether anything actually moved *during* this frame, which is a
 * different question from whether something was dirty when it began: a frame
 * that redraws a settled table is the last frame, and answering `false` here
 * is what starts the linger running out.
 */
export function afterFrame(state: SchedulerState, nowMs: number, motion: boolean): SchedulerState {
  if (motion) return { awake: true, lastMotionMs: nowMs };
  if (!state.awake) return state;
  if (state.lastMotionMs === null) return SLEEPING;
  return nowMs - state.lastMotionMs >= IDLE_LINGER_MS ? SLEEPING : state;
}

/** Whether the loop should request another frame. */
export function isAwake(state: SchedulerState): boolean {
  return state.awake;
}

/**
 * Clamp for the frame delta handed to the physics.
 *
 * A tab that has been backgrounded, or a phone that has been locked, hands
 * back a first delta of anything up to several minutes. Passed straight into
 * a friction slide that closes a fraction of the remaining gap per elapsed
 * frame, that single delta closes *all* of it: every chip in the room
 * teleports onto its target on the frame the tab wakes up. Capping at ~4
 * reference frames means the worst a stall can do is make one frame look
 * slightly fast.
 */
export const MAX_FRAME_DELTA_MS = 64;

export function clampDelta(deltaMs: number): number {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.min(deltaMs, MAX_FRAME_DELTA_MS);
}
