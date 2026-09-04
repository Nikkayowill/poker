/**
 * The farmhand's walk cycle: two legs, two bones each, driven by one phase.
 *
 * THIS REPLACES A BOUNCE, AND THAT IS THE POINT. The first cut drew him as one
 * frozen generated sprite with a squash-and-stretch hop on it. A frozen pose
 * that bounces does not read as walking, it reads as a cardboard cutout being
 * jiggled -- and the bounce actively makes it worse, because it puts motion
 * everywhere EXCEPT the legs and so draws the eye straight to the thing that
 * is not moving. There is no vertical hop left here at all. The walk is sold
 * by the legs doing what legs do, which is the same lesson ./gait.ts learned
 * for the animals (it deleted a hop for a weight shift) applied to a biped.
 *
 * WHY A RIG AND NOT A SPRITE SHEET. A sheet is the usual answer and is not
 * available: the art is generated (see task-farmhand in the FLUX pipeline) and
 * schnell has no identity control between generations, so N generated frames
 * are N different men in the same clothes. What IS stable is one render, so
 * the render is cut at the crotch and kept for the upper body -- the part
 * carrying the face, the cap and the shirt, and the part that does not deform
 * in a walk -- while the legs below it are drawn by the scene from the angles
 * this module produces. The seam is invisible because the overalls are one
 * continuous denim from bib to ankle.
 *
 * Everything here is pure and unit-tested, for the reason every StackAcres
 * animation module is: vitest only reaches lib/ and app/.
 */

import type { WorldPoint } from "./world";

/* ------------------------------------------------------------------ */
/* The body, measured off the art                                      */
/* ------------------------------------------------------------------ */

/**
 * How far the hip sits above the ground, in world units, and how the leg
 * below it divides into thigh and shin.
 *
 * Measured from the render rather than chosen: `rig_farmhand.py` cuts the
 * sprite at 64% of the figure's height and reports what is left below it
 * (14.125 units). The thigh/shin split is the one number here that is a
 * judgement -- a real thigh and shin are near enough equal, and a slightly
 * long thigh puts the knee a touch low, which reads better at this size than
 * a knee bending in the middle of a ten-pixel leg.
 */
export const FARMHAND_THIGH = 7.4;
export const FARMHAND_SHIN = 4.6;
/** Ankle to sole. */
export const FARMHAND_BOOT = 2.125;

/** How far a fully straightened leg reaches below the hip. */
export const FARMHAND_LEG_REACH = FARMHAND_THIGH + FARMHAND_SHIN + FARMHAND_BOOT;

/**
 * How high the hip stands off the ground, and DELIBERATELY LESS THAN THE LEG
 * IS LONG.
 *
 * The measured cut leaves 14.125 units of leg; the hip stands at 13.6, so a
 * straight leg has half a unit of slack in it. That slack is the whole reason
 * `rise` below can exist at all: this is forward kinematics, the foot goes
 * wherever the joint angles put it, so lifting the hips on a fully extended
 * leg would lift the foot off the ground with it. Standing with a trace of
 * bend in the knee is also just what a person does.
 */
export const FARMHAND_HIP_Y = 13.6;

/** Radians of cycle per world unit walked. Distance-driven, not time-driven,
 *  for the same reason ./gait.ts is: one constant then fits any speed. At
 *  `FARMHAND_SPEED` this is a stride a little under a second, which is a
 *  walk rather than a trot. */
const CYCLE_PER_UNIT = 0.22;

/** How far the leg swings from vertical, each way. Generous: this is what the
 *  whole change exists to make visible, and a timid swing at thirteen pixels
 *  tall is the same as no swing. */
const HIP_SWING = 0.62;

/** How far the knee folds at its most bent. Never negative -- a knee that
 *  bends the other way is the single fastest way to make a walk look wrong. */
const KNEE_MAX = 0.85;

/**
 * How much the hips rise and fall over a stride, in world units.
 *
 * Small, and capped by the leg's own slack (see `FARMHAND_HIP_Y`) so a rise
 * can never lift a straight stance leg's foot off the ground. Kept at all only
 * because a body held at exactly one height while its legs scissor looks like
 * it is running on rails -- this is nothing like the hop it replaced, which
 * was ten times the size and had no legs moving underneath it.
 */
const BODY_RISE = 0.5;

/** Eases in when he sets off and out when he stops. Out is slower: settling
 *  is heavier than starting. */
const RISE_MS = 130;
const FALL_MS = 210;

/** Below this the pose is a rounding error rather than a pose. Snapping it
 *  shut means a standing farmhand has both feet flat and level, exactly. */
const SETTLED = 1e-3;

/** Matches `stepFarmhand`, `stepCritter` and `stepGait`: one enormous delta
 *  from a backgrounded tab is not a stride he actually took. */
const MAX_FRAME_MS = 250;

/**
 * The pose the legs are in right now.
 *
 * Angles are radians from straight down, positive toward the direction the
 * art faces (screen right, before the scene's mirror). Index 0 is the leg on
 * the viewer's side of the body, 1 the far one -- which is only a draw-order
 * distinction, since the two are half a cycle apart and otherwise identical.
 */
export interface WalkPose {
  /** Where in the stride he is, in radians. Advances only while walking. */
  phase: number;
  /** How much of the cycle is currently expressed, 0..1. This is what eases,
   *  never the angles -- chasing a moving target would lag it and leave him
   *  hunting across a neutral stance every time he stopped. */
  weight: number;
  hips: readonly [number, number];
  knees: readonly [number, number];
  /** How far the hips are lifted off their standing height, in world units. */
  rise: number;
}

export function spawnWalk(): WalkPose {
  return { phase: 0, weight: 0, hips: [0, 0], knees: [0, 0], rise: 0 };
}

function poseAt(phase: number, weight: number): WalkPose {
  // A settled pose is canonically neutral rather than a set of negative
  // zeros. Multiplying a negative sine by a zero weight is arithmetically
  // fine and gives `-0`, which reads as a real value in a snapshot and in a
  // debugger for no reason at all.
  if (weight === 0) return { phase, weight: 0, hips: [0, 0], knees: [0, 0], rise: 0 };
  // The two legs are half a cycle apart, which is the entire definition of a
  // walk as opposed to a hop.
  const hip = (t: number) => HIP_SWING * Math.sin(t) * weight;
  // The knee folds during the SWING phase -- while the leg is travelling from
  // behind the body to in front of it, peaking as it passes underneath. That
  // is `cos` against this `sin`, and clamping at zero is what keeps the knee
  // straight through the whole stance phase instead of hyperextending.
  const knee = (t: number) => KNEE_MAX * Math.max(0, Math.cos(t)) * weight;
  return {
    phase,
    weight,
    hips: [hip(phase), hip(phase + Math.PI)],
    knees: [knee(phase), knee(phase + Math.PI)],
    // Twice per stride, and `cos` rather than `sin` because it has to peak at
    // MID-STANCE -- the moment one leg is straight underneath him, which is
    // phase 0 and phase pi. The legs are furthest apart at +-pi/2, and that
    // is when a walking body is at its LOWEST, not its highest. Getting this
    // half a cycle out is the difference between a walk and a limp.
    rise: BODY_RISE * Math.abs(Math.cos(phase)) * weight,
  };
}

/**
 * One frame of the walk.
 *
 * The easing is on the AMPLITUDE, never on the angles, exactly as `stepGait`
 * does it: freezing the phase the instant he stops and fading the weight
 * means every joint slides one way to neutral instead of hunting across it,
 * and picks the cycle back up where it left off when he sets off again.
 */
export function stepWalk(
  pose: WalkPose,
  walking: boolean,
  speed: number,
  dtMs: number,
): WalkPose {
  const dt = Math.max(0, Math.min(dtMs, MAX_FRAME_MS)) / 1000;
  const phase = walking ? pose.phase + Math.abs(speed) * CYCLE_PER_UNIT * dt : pose.phase;

  const target = walking ? 1 : 0;
  const settle = 1 - Math.exp(-dt / ((walking ? RISE_MS : FALL_MS) / 1000));
  let weight = pose.weight + (target - pose.weight) * settle;
  if (!walking && weight < SETTLED) weight = 0;

  return poseAt(phase, weight);
}

/* ------------------------------------------------------------------ */
/* Forward kinematics                                                  */
/* ------------------------------------------------------------------ */

/** Where one leg's three joints are, in the container's own local space:
 *  x to the right, y DOWN the screen, origin at the hip. */
export interface LegJoints {
  hip: WorldPoint;
  knee: WorldPoint;
  ankle: WorldPoint;
  /** Where the toe points, for the boot. Unit vector along the shin. */
  toe: WorldPoint;
}

/**
 * The joints of one leg, so the scene draws rather than solves.
 *
 * Straight down is (0, +1) because this is screen space, so an angle `a` off
 * vertical is `(sin a, cos a)`. The shin trails the thigh by the knee angle
 * (`hip - knee`), which folds the foot BACKWARD -- the direction a knee
 * actually goes.
 */
export function legJoints(
  hipX: number,
  hipAngle: number,
  kneeAngle: number,
  thigh = FARMHAND_THIGH,
  shin = FARMHAND_SHIN,
): LegJoints {
  const hip = { x: hipX, y: 0 };
  const knee = {
    x: hip.x + thigh * Math.sin(hipAngle),
    y: hip.y + thigh * Math.cos(hipAngle),
  };
  const shinAngle = hipAngle - kneeAngle;
  const ankle = {
    x: knee.x + shin * Math.sin(shinAngle),
    y: knee.y + shin * Math.cos(shinAngle),
  };
  return { hip, knee, ankle, toe: { x: Math.sin(shinAngle), y: Math.cos(shinAngle) } };
}
