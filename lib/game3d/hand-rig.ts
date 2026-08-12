/**
 * THE SHAPE OF A HAND — the half of the "lifeless arms" complaint that is
 * not about where the arm goes.
 *
 * The reported symptom was that the roster looked like it was "holding a
 * flute", and that is an exact description of what the offline bake
 * produces. `scripts/build-poker-character-animations.py` finishes every
 * character with one loop:
 *
 *     for finger in ("Index", "Middle", "Ring", "Pinky", "Thumb"):
 *         for segment, curl in zip((1, 2, 3), _FINGER_CURL):
 *             rotate_local(... (curl, 0, 0))
 *
 * — the same three angles (24, 18, 10 degrees) about the same axis on all
 * five digits, thumb included. Five identical cylinders of the same
 * curvature at the same phase is, geometrically, a grip around a tube. Real
 * fingers do none of that: they curl progressively from index to pinky, they
 * splay apart, and the thumb opposes the others rather than joining them.
 *
 * WHY THIS IS RUNTIME AND NOT A REBAKE. Both, eventually — but the clips
 * key all 40 finger bones, so anything applied here has to be absolute
 * (bind pose composed with a chosen angle) rather than a delta on top of
 * whatever the clip set, or the bake's uniform curl is still underneath it.
 * Once poses are absolute, they can also *change* — a hand resting on cloth
 * and a hand settling onto its own cards are different shapes, and a baked
 * clip cannot be two shapes.
 *
 * AXES ARE DERIVED, NEVER NAMED. The one thing that cannot be assumed about
 * an arbitrary rig is which local axis a joint bends around: the bake gets
 * to say "local X" because it runs inside Blender's bone space, and this
 * does not, because glTF nodes carry the exporter's convention instead. So
 * the curl axis for every bone is computed from that bone's own bind-pose
 * geometry — the direction to its child, and the palm's normal — which is
 * the same discipline `_facing_sign` uses in the bake for the same reason.
 *
 * Pure vector maths, no three.js, so `npm test` reaches it.
 */

import { clamp, cross, dot, lerp, norm, rotateAbout, sub, type Vec3 } from "./vec3-math";

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

export const FINGER_NAMES: readonly FingerName[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky",
] as const;

/** The three articulated segments of a digit, base to tip. */
export type FingerCurl = readonly [number, number, number];

export interface FingerPose {
  /** Flexion at each segment, in radians, positive = toward the palm. */
  curl: FingerCurl;
  /**
   * Splay away from the middle finger, in radians, about the palm normal.
   * Always non-negative and always means "away from middle" — the direction
   * that is on a given rig is measured, see `spreadSign`.
   */
  spread: number;
}

export type HandShape = Readonly<Record<FingerName, FingerPose>>;

export type HandShapeName = "restFlat" | "overCards" | "loose";

const d = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * A hand lying on cloth.
 *
 * THESE ANGLES ARE MEASURED FROM THE BIND POSE, NOT FROM A STRAIGHT FINGER,
 * and the first cut of this file got that wrong in a way worth recording.
 * They were written as the small residual bend a relaxed hand has — 7 to 13
 * degrees — on the assumption that a hand pressed on a table is nearly flat.
 * But the pose these compose onto is Mixamo's T-pose, whose fingers are
 * already straight AND already splayed, so a near-zero curl reproduces the
 * T-pose almost exactly: rendered, six characters had rigid spread claws on
 * the cloth, which is a different wrong hand from the flute, not a fixed one.
 * The bake's own 24/18/10 was in the right RANGE and wrong in its uniformity.
 *
 * So: bake-scale flexion, distributed. Most of it at the middle joint, which
 * is what arches a finger instead of closing it; a steady progression from
 * index to pinky; and the thumb far less flexed than any of them, because it
 * opposes the others rather than joining them.
 *
 * `spread` is small for the same measured reason — the bind pose supplies
 * most of the natural splay already, and adding a full hand's worth on top
 * is what produced the claw.
 */
const REST_FLAT: HandShape = {
  thumb: { curl: [d(11), d(8), d(4)], spread: d(9) },
  index: { curl: [d(13), d(19), d(11)], spread: d(2) },
  middle: { curl: [d(15), d(22), d(12)], spread: 0 },
  ring: { curl: [d(17), d(25), d(14)], spread: d(2) },
  pinky: { curl: [d(20), d(30), d(16)], spread: d(4) },
};

/**
 * A hand settled over its own cards — fingertips down on the backs, the way
 * a player covers a live hand. More flexion at the middle joint than the
 * base, which is what makes the fingers arch onto the card rather than
 * close into a fist.
 */
const OVER_CARDS: HandShape = {
  thumb: { curl: [d(17), d(13), d(7)], spread: d(6) },
  index: { curl: [d(20), d(30), d(16)], spread: d(1) },
  middle: { curl: [d(22), d(33), d(18)], spread: 0 },
  ring: { curl: [d(25), d(37), d(20)], spread: d(1) },
  pinky: { curl: [d(29), d(43), d(23)], spread: d(3) },
};

/**
 * A hand doing nothing in particular, off the table. Still not uniform:
 * this is what the bake was reaching for and missed, and it is the shape a
 * gesture blends back toward rather than a resting pose in its own right.
 */
const LOOSE: HandShape = {
  thumb: { curl: [d(14), d(10), d(6)], spread: d(10) },
  index: { curl: [d(18), d(26), d(15)], spread: d(2) },
  middle: { curl: [d(20), d(29), d(16)], spread: 0 },
  ring: { curl: [d(23), d(33), d(18)], spread: d(2) },
  pinky: { curl: [d(26), d(38), d(20)], spread: d(5) },
};

/**
 * How far below horizontal a resting hand's fingers point.
 *
 * Geometry, not taste: the wrist joint sits WRIST_REST_HEIGHT (34 mm) above
 * the cloth because that is how thick a wrist is, and a hand aimed level
 * from there leaves every fingertip floating that same 34 mm — which is
 * exactly the hovering the first render showed. Roughly asin(34 / a hand's
 * 95 mm), less the part the curl above already accounts for.
 */
export const RESTING_HAND_PITCH = (13 * Math.PI) / 180;

export const HAND_SHAPES: Readonly<Record<HandShapeName, HandShape>> = {
  restFlat: REST_FLAT,
  overCards: OVER_CARDS,
  loose: LOOSE,
};

/** Linear blend between two hand shapes, segment by segment. */
export function blendHandShapes(a: HandShape, b: HandShape, t: number): HandShape {
  const k = clamp(t, 0, 1);
  const out = {} as Record<FingerName, FingerPose>;
  for (const finger of FINGER_NAMES) {
    const from = a[finger];
    const to = b[finger];
    out[finger] = {
      curl: [
        lerp(from.curl[0], to.curl[0], k),
        lerp(from.curl[1], to.curl[1], k),
        lerp(from.curl[2], to.curl[2], k),
      ],
      spread: lerp(from.spread, to.spread, k),
    };
  }
  return out;
}

/**
 * The palm's outward normal, from three points on the hand in one common
 * space (whichever space the caller measured them in — the maths is the
 * same, and the caller wants the answer back in that space).
 *
 * Taken from the knuckle line crossed with the finger direction rather than
 * from any single bone's axis, because the knuckles are the one feature of a
 * hand that is genuinely planar. `wrist` is the hand bone's own origin,
 * `indexBase` and `pinkyBase` the two outer knuckles.
 *
 * The returned normal is signed to point AWAY from the palm — out of the
 * back of the hand — which is the convention every other function here
 * assumes. There is no way to establish that from three points alone (the
 * knuckle plane is symmetric), so it is resolved by the thumb: the thumb
 * sits on the palm side of that plane on a real hand, on both hands.
 */
export function palmNormal(
  wrist: Vec3,
  indexBase: Vec3,
  pinkyBase: Vec3,
  thumbBase: Vec3
): Vec3 {
  const acrossKnuckles = sub(pinkyBase, indexBase);
  const alongFingers = sub(indexBase, wrist);
  const n = norm(cross(acrossKnuckles, alongFingers), { x: 0, y: 1, z: 0 });
  // Flip so the thumb ends up on the negative (palm) side.
  return dot(sub(thumbBase, wrist), n) > 0 ? { x: -n.x, y: -n.y, z: -n.z } : n;
}

/**
 * The axis a bone flexes about, given the direction to its own child and the
 * palm normal, both in that bone's local space.
 *
 * `palmNormal x forward` and not the other way round, and the order is the
 * whole content of this function: under Rodrigues, a small positive rotation
 * about an axis moves a vector along `axis x vector`, so this ordering is
 * the one where a positive angle curls the fingertip toward the palm.
 * `curlsTowardPalm` below is the executable statement of that.
 */
export function curlAxis(forward: Vec3, normal: Vec3): Vec3 {
  return norm(cross(normal, forward), { x: 1, y: 0, z: 0 });
}

/** Does a positive rotation about `axis` actually flex toward the palm? */
export function curlsTowardPalm(forward: Vec3, normal: Vec3, axis: Vec3): boolean {
  const rotated = rotateAbout(norm(forward), norm(axis), 0.1);
  return dot(rotated, norm(normal)) < dot(norm(forward), norm(normal));
}

/**
 * Which way, about the palm normal, this finger splays AWAY from the middle
 * finger — measured from where the two actually sit rather than assumed from
 * handedness. `+1` or `-1`, and `0` for a finger sitting on the middle
 * finger's own line (the middle finger itself), which correctly disables its
 * spread rather than picking an arbitrary side.
 *
 * All three points must be in one common space; only their relative
 * positions matter.
 */
export function spreadSign(
  fingerBase: Vec3,
  middleBase: Vec3,
  wrist: Vec3,
  normal: Vec3
): number {
  const offset = sub(fingerBase, middleBase);
  const alongFingers = norm(sub(middleBase, wrist));
  const sideways = cross(norm(normal), alongFingers);
  const projection = dot(offset, sideways);
  if (Math.abs(projection) < 1e-5) return 0;
  return projection > 0 ? 1 : -1;
}

/**
 * The largest flexion any digit in a shape asks for. Exists for the test
 * that pins these poses as HANDS rather than fists: past about 60 degrees at
 * a single joint a relaxed hand has stopped being relaxed, and this file's
 * whole purpose is defeated by quietly drifting there.
 */
export function maxCurl(shape: HandShape): number {
  let worst = 0;
  for (const finger of FINGER_NAMES) {
    for (const angle of shape[finger].curl) worst = Math.max(worst, angle);
  }
  return worst;
}

/**
 * How uniform a shape is — the spread between the most and least flexed
 * digit at the same segment, summed over the three segments.
 *
 * This is the "flute" metric, and it is a test rather than a comment
 * precisely because the bake's version scored zero on it and nothing caught
 * that until somebody looked at a render. Fingers are excluding the thumb,
 * which is structurally different and would flatter the number.
 */
export function shapeVariation(shape: HandShape): number {
  let total = 0;
  for (let segment = 0; segment < 3; segment += 1) {
    const values = (["index", "middle", "ring", "pinky"] as const).map(
      (finger) => shape[finger].curl[segment]
    );
    total += Math.max(...values) - Math.min(...values);
  }
  return total;
}
