/**
 * The small vector helpers the pure 3D modules share.
 *
 * Extracted when the second consumer arrived, not the first: `arm-ik.ts`
 * carried a private copy of sub/add/scale/dot/len/norm, and `hand-anchors.ts`
 * plus `hand-rig.ts` need the same six plus `cross`. Three copies of
 * `normalize` is how two of them end up disagreeing about what a zero-length
 * vector returns — which is not a hypothetical here, since a degenerate
 * cross product is exactly what a straight finger's bind pose produces.
 *
 * No three.js import, so `npm test` reaches every module downstream of this
 * one. `THREE.Vector3` is deliberately not used even as a type: the callers
 * that DO run inside three (glb-avatar.tsx) read bone world positions into
 * plain objects at the boundary, which is what keeps the maths testable.
 */

import type { Vec3 } from "./seat-layout";

export type { Vec3 };

/** Below this a vector is treated as having no direction at all. */
export const VEC_EPS = 1e-6;

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

/**
 * Unit vector, with an explicit fallback rather than a NaN. Every caller
 * here is normalizing something that is *usually* well-formed and
 * occasionally degenerate (a cross product of two parallel bind-pose axes),
 * and silently propagating NaN into a bone quaternion removes the whole
 * character from the frame — a much worse failure than a wrong-but-finite
 * axis, which reads as one oddly-posed finger.
 */
export function norm(a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 {
  const l = len(a);
  return l > VEC_EPS ? scale(a, 1 / l) : fallback;
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Rotate `v` about the unit vector `axis` by `angle` radians (Rodrigues).
 *
 * Used to answer a question the finger rig cannot answer from names alone:
 * "does rotating this bone by +θ about the axis I derived actually curl the
 * finger toward the palm, or away from it?" Asking geometrically is what
 * lets the rig work on a roster whose exporters disagree about bone axes.
 */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(
    add(scale(v, c), scale(cross(axis, v), s)),
    scale(axis, dot(axis, v) * (1 - c))
  );
}
