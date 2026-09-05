/**
 * How an animal is HELD while ./world.ts's `stepCritter` slides it across the
 * ground. Position is that module's job and stays there; this one owns the
 * single pose value the scene reads every frame.
 *
 * The animals used to walk by hopping: a `Math.abs(Math.sin(...))` lifted the
 * sprite a pixel or two off its own shadow on every stride, which on a 2:1
 * isometric tile does not read as a step, it reads as a bounce. There is no
 * vertical offset here at all any more. The sprite stays planted on the grass
 * and the walk is sold by a weight shift instead: a slow roll left and right
 * about the animal's feet, the way a four-legged animal actually moves its
 * mass from one diagonal pair to the other.
 *
 * Three degrees is the whole range, and it is meant to be almost subliminal
 * -- at the zoom the farm is usually played at a cow is about forty pixels
 * tall, so three degrees is under two pixels of lean at the shoulder. Any
 * more and it stops looking like weight and starts looking like a boat.
 *
 * Lives in lib/ rather than beside the scene for the usual reason: vitest
 * only reaches lib/ and app/, and this is the part of the animation that is
 * arithmetic rather than Phaser.
 */

import { clampFrameMs } from "./world";

/** The pose one animal is currently in. Carried by the scene between frames
 *  and by a unit node across a rebuild, so an animal never snaps back to
 *  level because its picture was redrawn under it. */
export interface Gait {
  /** Where in the sway cycle this animal is, in radians. Advances only while
   *  it is actually walking. */
  phase: number;
  /** How much of the sway is currently expressed, 0..1. This is what eases,
   *  not the angle -- see `stepGait`. */
  weight: number;
  /** The sprite's roll, in radians. Positive is Phaser's own sense
   *  (clockwise on screen). This is the only value the scene needs. */
  roll: number;
}

/** The furthest an animal ever leans, either way. */
export const GAIT_MAX_ROLL_DEGREES = 3;
export const GAIT_MAX_ROLL = (GAIT_MAX_ROLL_DEGREES * Math.PI) / 180;

/**
 * Radians of sway per world unit walked. Tying the cycle to DISTANCE rather
 * than to time is what makes one constant fit every animal: a hen at 14
 * units/s takes about two sways a second and a cow at 7 takes one, which is
 * roughly the difference between the two in life, and neither number appears
 * in this file.
 */
const SWAY_PER_UNIT = 0.9;

/** How quickly the sway fades in when an animal sets off, and back out when
 *  it stops. Out is the slower of the two: settling is a heavier movement
 *  than starting, and a quick reset to level is exactly the snap this whole
 *  module exists to avoid. */
const RISE_MS = 170;
const FALL_MS = 260;

/** Below this the lean is under a thousandth of a degree, which is not a
 *  pose, it is a rounding error. Snapping it shut means a standing animal
 *  holds a rotation of exactly zero rather than an ever-smaller one forever. */
const SETTLED = 1e-3;

/** A fresh gait, level and still. `phase` is the caller's own per-animal
 *  offset, so a pen of hens does not sway in lockstep. */
export function spawnGait(phase: number): Gait {
  return { phase, weight: 0, roll: 0 };
}

/**
 * One frame of the walk.
 *
 * The easing is on the AMPLITUDE, not on the angle. Chasing a moving sine
 * target would lag it -- the animal would lean the wrong way for a moment
 * every time it changed direction, and stopping mid-stride would leave it
 * hunting back and forth across level. Freezing the phase the instant it
 * stops and fading the amplitude instead means the roll only ever slides one
 * way from wherever it was to zero, and picks the cycle back up where it left
 * off when the animal sets off again.
 */
export function stepGait(gait: Gait, walking: boolean, speed: number, dtMs: number): Gait {
  // Matching `stepCritter`'s own cap -- see world.ts's `clampFrameMs`.
  const dt = clampFrameMs(dtMs) / 1000;
  const phase = walking ? gait.phase + Math.abs(speed) * SWAY_PER_UNIT * dt : gait.phase;

  const target = walking ? 1 : 0;
  // Exponential approach rather than a linear ramp, so the ease has no corner
  // at either end and no dependence on the frame rate.
  const settle = 1 - Math.exp(-dt / ((walking ? RISE_MS : FALL_MS) / 1000));
  let weight = gait.weight + (target - gait.weight) * settle;
  if (!walking && weight < SETTLED) weight = 0;

  return { phase, weight, roll: Math.sin(phase) * GAIT_MAX_ROLL * weight };
}
