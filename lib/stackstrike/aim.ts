/**
 * Lift-off aim. A thumb does not leave the glass cleanly: in the last few
 * frames before it lifts it slides and rolls, so the point where the touch ends
 * is not where the player was aiming. The gun keeps a short history of where it
 * pointed and, when the thumb lifts, fires from a moment before the lift.
 */

export interface AimSample {
  /** Milliseconds, on any clock that only moves forward. */
  at: number;
  angle: number;
  /** How far the thumb was from the pad's centre, as a share of its radius. */
  reach: number;
}

/** Aim from this long before the thumb left the glass. */
export const LIFT_LOOKBACK_MS = 90;
/** Samples older than this are dropped. */
const KEEP_MS = 400;
/** A release with the thumb back inside this share of the pad radius is a cancel, not a shot. */
export const CANCEL_REACH = 0.2;

/**
 * Samples are taken when the thumb moves, so a thumb held still leaves one old sample
 * that stands for "still here". The newest sample at or before the window's start is
 * kept for that reason; only what is older than it goes.
 */
export function recordAim(history: AimSample[], sample: AimSample): void {
  history.push(sample);
  while (history.length > 1 && history[1].at <= sample.at - KEEP_MS) history.shift();
}

/** The aim from `lookbackMs` before `now`, or the oldest one kept if the touch is younger than that. */
export function aimBeforeLift(history: AimSample[], now: number, lookbackMs: number = LIFT_LOOKBACK_MS): AimSample | null {
  if (history.length === 0) return null;
  const cutoff = now - lookbackMs;
  let pick = history[0];
  for (const sample of history) {
    if (sample.at <= cutoff) pick = sample;
    else break;
  }
  return pick;
}

/** Where the thumb actually was when it left, before any lookback. */
export interface AimEnd {
  angle: number;
  reach: number;
}

/**
 * A move bigger than this between the lookback sample and the lift is a sweep
 * the player meant, not the thumb rolling off, so the lift's own aim is used.
 */
export const SWEEP_RAD = 0.6;

function turn(from: number, to: number): number {
  const wrapped = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Math.abs(wrapped);
}

/**
 * What letting go of a dragged thumb does: one shot along the latched aim, or nothing if
 * the thumb had been sitting in the middle. A thumb that swept a long way in the last
 * moments is aiming there, so the lift's own angle wins.
 */
export function releaseShot(history: AimSample[], now: number, end: AimEnd): { angle: number } | null {
  const sample = aimBeforeLift(history, now);
  if (!sample) return end.reach > CANCEL_REACH ? { angle: end.angle } : null;
  if (end.reach > CANCEL_REACH && turn(sample.angle, end.angle) > SWEEP_RAD) return { angle: end.angle };
  if (sample.reach <= CANCEL_REACH) return null;
  return { angle: sample.angle };
}
