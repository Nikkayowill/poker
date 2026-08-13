/**
 * WHERE A SEATED PLAYER'S HEAD SHOULD BE AIMED — wiring up
 * `avatar-state.ts`'s existing (tested, never-called) `clampHeadYaw`/
 * `clampHeadPitch` so heads are not a permanent thousand-yard stare.
 *
 * Returns a WORLD POINT rather than a raw yaw/pitch, the same convention
 * `hand-anchors.ts`'s `aim` field uses. The three.js side
 * (`components/game3d/avatars/arm-rig.ts`) aims the head bone at this point
 * with the same axis-agnostic `aimChildAt` swing every arm/finger joint
 * already uses, rather than composing a yaw/pitch Euler locally — which
 * would need to assume the head bone's own local axis convention, exactly
 * the assumption this codebase's other rigs deliberately avoid (see
 * `arm-rig.ts`'s header: "axes are derived, never named").
 *
 * The clamp is stated relative to the SEAT's own forward frame
 * (`seatFrame`, same frame every hand anchor uses), not the head's current
 * orientation — a gesture mid-play must not widen how far the head is
 * allowed to turn from facing the table.
 *
 * Pure vector maths, no three.js, so `npm test` reaches it — same
 * convention as `arm-ik.ts` and `hand-anchors.ts`.
 */

import { clampHeadPitch, clampHeadYaw } from "./avatar-state";
import { add, dot, len, norm, scale, sub, vec, type Vec3 } from "./vec3-math";

/** How strongly the idle wander perturbs an otherwise-locked gaze, in radians. */
const IDLE_YAW_AMPLITUDE_RAD = (4 * Math.PI) / 180;
const IDLE_PITCH_AMPLITUDE_RAD = (2 * Math.PI) / 180;

/**
 * A small deterministic wander so a held gaze doesn't lock perfectly still —
 * same two-incommensurate-frequency convention as `hand-anchors.ts`'s
 * `idleDrift`, phased by seat so the pattern never visibly loops or
 * synchronises across the table.
 */
function idleGazeWander(slot: number, timeS: number): { yaw: number; pitch: number } {
  const phase = slot * 2.3;
  return {
    yaw: IDLE_YAW_AMPLITUDE_RAD * Math.sin(timeS * 0.19 + phase),
    pitch: IDLE_PITCH_AMPLITUDE_RAD * Math.sin(timeS * 0.27 + phase * 1.7),
  };
}

/**
 * The world point a seat's head should aim toward this frame.
 *
 * `head` is the head bone's current world position; `target` is what the
 * player is (mostly) looking at — the pot, or their own cards at their own
 * turn, the caller's choice; `forward`/`right` are the seat's own frame
 * (`seatFrame`). The returned point sits one world unit from `head` along
 * the resolved gaze direction — its distance from `head` is arbitrary,
 * since the caller (`aimChildAt`) only reads the direction from a pivot to
 * this point, never its magnitude.
 */
export function headGazeTarget(
  head: Vec3,
  target: Vec3,
  forward: Vec3,
  right: Vec3,
  slot: number,
  timeS: number
): Vec3 {
  const toTarget = sub(target, head);
  const horizontal = vec(toTarget.x, 0, toTarget.z);
  const horizontalLen = len(horizontal);

  const rawYaw =
    horizontalLen > 1e-6
      ? Math.atan2(dot(norm(horizontal), right), dot(norm(horizontal), forward))
      : 0;
  const rawPitch = Math.atan2(toTarget.y, Math.max(horizontalLen, 1e-6));

  const wander = idleGazeWander(slot, timeS);
  const yaw = clampHeadYaw(rawYaw + wander.yaw);
  const pitch = clampHeadPitch(rawPitch + wander.pitch);

  // Rebuild a unit gaze direction from the clamped yaw/pitch: rotate
  // `forward` toward `right` by yaw (about world up), then tilt the result
  // toward `up` by pitch.
  const up = vec(0, 1, 0);
  const yawed = add(scale(forward, Math.cos(yaw)), scale(right, Math.sin(yaw)));
  const gaze = add(scale(yawed, Math.cos(pitch)), scale(up, Math.sin(pitch)));
  return add(head, norm(gaze, forward));
}
