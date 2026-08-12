/**
 * Closed-form two-bone IK (shoulder -> elbow -> wrist), for holding a
 * seated avatar's hand at or above the felt plane without clipping through
 * it.
 *
 * WHY CLOSED FORM, NOT A PHYSICS ENGINE. The obstacle here is a single flat
 * plane at a compile-time-known height (FELT_TOP_Y) — not arbitrary or
 * moving geometry. A rigid-body world + iterative IK solver is the right
 * tool when contact is against something unknown at authoring time (a
 * ragdoll on uneven terrain, a hand on a variable-height prop); against a
 * known plane, "how far did the wrist sink below Y" is a comparison, and
 * "where should the arm bend to stop there" has an exact two-bone solution
 * via the law of cosines — the same answer an iterative CCDIK solver would
 * converge toward for a 2-joint chain, computed once instead of approached.
 *
 * Pure math, no three.js import, so `npm test` reaches it — same
 * convention as camera-framing.ts and every other module in this
 * directory. The caller (components/game3d/avatars/glb-avatar.tsx) does
 * the three.js-specific work of reading bone world positions and applying
 * the solved joint positions back as bone rotations.
 */

import { add, clamp, dot, len, norm as normalize, scale, sub, type Vec3 } from "./vec3-math";

const EPS = 1e-4;

/** Shared with vec3-math, but with this module's own zero-length fallback:
 * a degenerate bone direction here means "leave the chain pointing where it
 * already was", for which +Z is as good an answer as any and NaN is not. */
const norm = (a: Vec3): Vec3 => normalize(a, { x: 0, y: 0, z: 1 });

export interface TwoBoneSolution {
  elbow: Vec3;
  wrist: Vec3;
  /** True if the target was farther than the fully-extended chain could reach. */
  overreached: boolean;
}

/**
 * Solve shoulder -> elbow -> wrist for a new wrist target, preserving both
 * bone lengths exactly (measured off the CURRENT elbow/wrist, so it works
 * for any character's proportions without a separate rig-length table) and
 * bending in the SAME plane the current, animation-driven elbow already
 * defines. That last part is what keeps a correction on top of a baked
 * clip reading as "the same reach, stopped early" instead of a different
 * pose: the bend plane comes from the clip, only the reach distance and
 * final joint angle change.
 *
 * `currentElbow` supplies the bend direction only — it does not need to be
 * reachable from `shoulder` at the new target's distance.
 */
export function solveTwoBoneIk(
  shoulder: Vec3,
  currentElbow: Vec3,
  currentWrist: Vec3,
  target: Vec3
): TwoBoneSolution {
  const upperLen = len(sub(currentElbow, shoulder));
  const foreLen = len(sub(currentWrist, currentElbow));

  // Degenerate rig (zero-length bone) — nothing to solve.
  if (upperLen < EPS || foreLen < EPS) {
    return { elbow: currentElbow, wrist: currentWrist, overreached: false };
  }

  const maxReach = upperLen + foreLen - EPS;
  const minReach = Math.abs(upperLen - foreLen) + EPS;

  const toTarget = sub(target, shoulder);
  const rawDist = len(toTarget);
  const dist = clamp(rawDist, minReach, maxReach);
  const dir = norm(toTarget);

  // Bend-plane direction: the old pole (shoulder -> elbow), with the
  // component along the new target direction removed, so the elbow keeps
  // bending the way the clip already posed it. Falls back to world-up if
  // the target lines up exactly with the old bone axis.
  const pole = sub(currentElbow, shoulder);
  let bend = sub(pole, scale(dir, dot(pole, dir)));
  if (len(bend) < EPS) {
    const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
    bend = sub(worldUp, scale(dir, dot(worldUp, dir)));
  }
  bend = norm(bend);

  // Law of cosines: angle at the shoulder between the upper-arm bone and
  // the shoulder->target axis.
  const cosShoulder = clamp(
    (upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist),
    -1,
    1
  );
  const shoulderAngle = Math.acos(cosShoulder);

  const elbow = add(
    shoulder,
    add(
      scale(dir, upperLen * Math.cos(shoulderAngle)),
      scale(bend, upperLen * Math.sin(shoulderAngle))
    )
  );
  const wrist = add(shoulder, scale(dir, dist));

  return { elbow, wrist, overreached: rawDist > maxReach };
}

/**
 * How far above the felt a wrist is allowed to rest — a hair of clearance
 * so the hand reads as touching the cloth rather than hovering over it.
 * Small on purpose: this is the same role HIP_SIT_RISE plays for the hip
 * bone in glb-avatar.tsx (a cushion compresses; felt does not, but a
 * fingertip's own thickness needs a few millimetres regardless).
 */
export const WRIST_CLEARANCE = 0.015;

/**
 * The only "collision detection" a known flat plane needs: a Y comparison,
 * not a raycast. Returns null when the wrist is already clear — the caller
 * should skip the IK solve entirely on that (the common) frame, which is
 * what keeps this near-zero-cost against six seated characters at once.
 */
export function clampWristToFelt(wrist: Vec3, feltTopY: number): Vec3 | null {
  const floor = feltTopY + WRIST_CLEARANCE;
  if (wrist.y >= floor) return null;
  return { x: wrist.x, y: floor, z: wrist.z };
}

/**
 * Exponential-decay lerp factor for a given frame delta — frame-rate
 * independent, unlike a fixed `quaternion.slerp(target, 0.1)` (which
 * converges twice as fast at 120fps as at 60fps). `rate` is roughly "how
 * many effective corrections per second"; see IK_DAMPING below for the
 * value this module uses.
 */
export function dampingFactor(rate: number, deltaSeconds: number): number {
  return 1 - Math.exp(-rate * deltaSeconds);
}

/**
 * Damp a point toward a moving target, frame-rate independently.
 *
 * SMOOTH THE TARGET, NOT THE APPLICATION — and this is a correction, not a
 * preference. The first version of the caller slerped each bone a
 * `dampingFactor` fraction of the way toward its solved rotation every
 * frame. That is the right shape for a value that persists between frames
 * and the wrong one here, because the animation mixer rewrites every bone's
 * local rotation from the clip at the start of each frame: the correction
 * therefore restarted from zero every time and the pose settled at the
 * damping fraction of what was asked for — about a quarter of it at 60fps,
 * forever, with no frame in which the arm was ever actually corrected.
 * Hands that never quite arrive anywhere was a visible symptom of it.
 *
 * Keeping the smoothing on the TARGET fixes that: the target moves gently,
 * the solve is applied at full strength, and the arm genuinely reaches it.
 */
export function dampPointToward(
  current: Vec3,
  target: Vec3,
  rate: number,
  deltaSeconds: number
): Vec3 {
  const k = dampingFactor(rate, deltaSeconds);
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
    z: current.z + (target.z - current.z) * k,
  };
}

/**
 * How fast a wrist correction blends in, in effective corrections/second.
 * Chosen so the arm visibly settles rather than snaps (a hard `overreached`
 * case — e.g. the seat-layout numbers changing again upstream — would
 * otherwise pop the whole forearm to its new position in one frame), while
 * still resolving well inside a single idle-clip cross-fade
 * (CLIP_FADE_S in avatar-state.ts, 0.35s) so it never reads as lagging
 * behind the pose that triggered it.
 */
export const IK_DAMPING = 18;
