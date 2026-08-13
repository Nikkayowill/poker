/**
 * A BOUND ON HOW FAR ONE FRAME IS ALLOWED TO MOVE THE SCENE CLOCK — the fix
 * for the stutter/snap the room shows after any main-thread stall (a
 * backgrounded tab regaining focus, a GC pause, a shader compiling).
 *
 * R3F reads `THREE.Clock.getDelta()` once per frame and hands that one value
 * to every `useFrame` subscriber, including drei's `useAnimations`, which
 * drives every seated avatar's mixer with it (`mixer.update(delta)`). Nothing
 * upstream clamps that value: after a stall, the next `delta` can be seconds
 * wide, and the mixer jumps every skeleton forward by that whole span in one
 * step — a hitch followed by a visible pose snap rather than a resume.
 *
 * The same value also feeds `avatar-playback.ts`'s gesture deadlines, which
 * are deliberately denominated in `state.clock.elapsedTime` rather than wall
 * time (see that file's header) — so an unclamped stall can also make the
 * gesture watchdog fire the instant the stall ends, skipping the crossfade
 * window and producing a hard cut. `GESTURE_WATCHDOG_SLACK_S` is 0 there on
 * purpose, reasoned as "no jitter between two readings of one clock" — this
 * module is what makes that reasoning true rather than adding slack that
 * would only postpone the recovery.
 *
 * Pure — the three.js `Clock` object itself is mutated by the glue in
 * `components/game3d/scene/clock-delta-guard.tsx`; this is just the
 * arithmetic, so `npm test` reaches it the same way it reaches `arm-ik.ts`.
 */

export interface ClampedDelta {
  /** The delta to hand to the mixer/pose pass this frame, never exceeding `maxDeltaS`. */
  delta: number;
  /**
   * How much to subtract back off `clock.elapsedTime` after the real
   * `getDelta()` call already added the raw (unclamped) diff to it — zero
   * when the raw delta was within bounds. Keeping `elapsedTime` from jumping
   * too is what stops a stall from also fast-forwarding a gesture past its
   * own deadline.
   */
  elapsedCorrection: number;
}

/**
 * Clamp one frame's raw delta to `maxDeltaS`, reporting the excess so the
 * caller can correct `clock.elapsedTime` by the same amount.
 *
 * A non-finite or negative raw delta (a clock that hasn't started, or has
 * been reset) passes through as 0 rather than propagating NaN into the
 * mixer.
 */
export function clampDelta(rawDeltaS: number, maxDeltaS: number): ClampedDelta {
  if (!Number.isFinite(rawDeltaS) || rawDeltaS <= 0) {
    return { delta: 0, elapsedCorrection: 0 };
  }
  if (rawDeltaS <= maxDeltaS) {
    return { delta: rawDeltaS, elapsedCorrection: 0 };
  }
  return { delta: maxDeltaS, elapsedCorrection: rawDeltaS - maxDeltaS };
}

/**
 * The bound itself: generous enough that ordinary frame-rate variance (a
 * dropped frame or two at 60fps, a slow device running at 30) never visibly
 * slows the mixer down, tight enough that a multi-second stall cannot produce
 * a multi-second jump. 1/20s — one frame at a rough-but-real 20fps floor.
 */
export const MAX_FRAME_DELTA_S = 1 / 20;
