import { describe, expect, it } from "vitest";
import {
  FINGER_NAMES,
  HAND_SHAPES,
  RESTING_HAND_PITCH,
  blendHandShapes,
  curlAxis,
  curlsTowardPalm,
  maxCurl,
  palmNormal,
  shapeVariation,
  spreadSign,
  type HandShape,
} from "./hand-rig";
import { WRIST_REST_HEIGHT } from "./hand-anchors";
import { dot, len, norm, rotateAbout, vec } from "./vec3-math";

const SHAPE_NAMES = ["restFlat", "overCards", "loose"] as const;
const FINGERS_ONLY = ["index", "middle", "ring", "pinky"] as const;

/**
 * A canonical right hand in its own bone frame: fingers up +Y, knuckles
 * spread along +X, palm facing -Z (so the palm NORMAL, which points out of
 * the back of the hand, is +Z). Every axis question below is asked against
 * this rather than against a real rig, so the maths is pinned independently
 * of any one exporter's convention.
 */
const WRIST = vec(0, 0, 0);
const INDEX_BASE = vec(-0.3, 1, 0);
const PINKY_BASE = vec(0.3, 1, 0);
const MIDDLE_BASE = vec(-0.05, 1.02, 0);
const THUMB_BASE = vec(-0.35, 0.5, -0.25);

describe("hand shapes", () => {
  /**
   * THE FLUTE GUARD, and the single most important test in this file.
   *
   * The offline bake applies the same three angles to all five digits, which
   * is geometrically a grip around a tube and was reported as exactly that.
   * A uniform shape scores zero here. Nothing but a test can catch this
   * coming back — it type-checks, it lints, and it is invisible in every
   * gate the repo runs.
   */
  it("never curls every finger identically", () => {
    for (const name of SHAPE_NAMES) {
      expect(shapeVariation(HAND_SHAPES[name])).toBeGreaterThan(0.05);
    }
  });

  it("scores a uniform bake-style hand at zero variation", () => {
    const d = (deg: number) => (deg * Math.PI) / 180;
    const uniform = Object.fromEntries(
      FINGER_NAMES.map((finger) => [finger, { curl: [d(24), d(18), d(10)], spread: 0 }])
    ) as unknown as HandShape;
    expect(shapeVariation(uniform)).toBe(0);
  });

  /** Fingers curl progressively from index to pinky on a real hand. */
  it("curls each finger a little more than the one before it", () => {
    for (const name of SHAPE_NAMES) {
      const shape = HAND_SHAPES[name];
      for (let segment = 0; segment < 3; segment += 1) {
        for (let i = 1; i < FINGERS_ONLY.length; i += 1) {
          expect(shape[FINGERS_ONLY[i]].curl[segment]).toBeGreaterThan(
            shape[FINGERS_ONLY[i - 1]].curl[segment]
          );
        }
      }
    }
  });

  /** The thumb opposes the other digits; it must never join the curl. */
  it("keeps the thumb less flexed than any finger", () => {
    for (const name of SHAPE_NAMES) {
      const shape = HAND_SHAPES[name];
      for (const finger of FINGERS_ONLY) {
        expect(shape.thumb.curl[0]).toBeLessThan(shape[finger].curl[0]);
        expect(shape.thumb.curl[1]).toBeLessThan(shape[finger].curl[1]);
      }
    }
  });

  /** The middle joint is what arches a finger; the base joint closing hardest
   * is what makes a fist. */
  it("puts the most flexion at the middle joint", () => {
    for (const name of SHAPE_NAMES) {
      for (const finger of FINGERS_ONLY) {
        const curl = HAND_SHAPES[name][finger].curl;
        expect(curl[1]).toBeGreaterThan(curl[0]);
        expect(curl[1]).toBeGreaterThan(curl[2]);
      }
    }
  });

  /** These are relaxed hands, not fists. */
  it("stays well short of a closed hand", () => {
    for (const name of SHAPE_NAMES) {
      expect(maxCurl(HAND_SHAPES[name])).toBeLessThan(Math.PI / 3);
    }
  });

  it("settles further onto the cards than it rests on bare cloth", () => {
    for (const finger of FINGERS_ONLY) {
      expect(HAND_SHAPES.overCards[finger].curl[1]).toBeGreaterThan(
        HAND_SHAPES.restFlat[finger].curl[1]
      );
    }
  });

  /**
   * The pitch exists to put fingertips on the cloth from a wrist that is
   * necessarily above it, so it has to be in the neighbourhood of
   * asin(wrist height / hand length) — near zero would leave them hovering,
   * and a steep angle would drive them through the felt.
   */
  it("tips the hand down by roughly the wrist's own height over a hand length", () => {
    const handLength = 0.095 * (WRIST_REST_HEIGHT / 0.034);
    const needed = Math.asin(WRIST_REST_HEIGHT / handLength);
    expect(RESTING_HAND_PITCH).toBeGreaterThan(needed * 0.4);
    expect(RESTING_HAND_PITCH).toBeLessThan(needed * 1.2);
  });
});

describe("blendHandShapes", () => {
  it("returns the endpoints exactly", () => {
    expect(blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, 0)).toEqual(
      HAND_SHAPES.restFlat
    );
    expect(blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, 1)).toEqual(
      HAND_SHAPES.overCards
    );
  });

  it("interpolates every segment at the midpoint", () => {
    const mid = blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, 0.5);
    for (const finger of FINGER_NAMES) {
      for (let i = 0; i < 3; i += 1) {
        expect(mid[finger].curl[i]).toBeCloseTo(
          (HAND_SHAPES.restFlat[finger].curl[i] + HAND_SHAPES.overCards[finger].curl[i]) / 2,
          12
        );
      }
    }
  });

  it("clamps outside 0..1 rather than extrapolating into a broken hand", () => {
    expect(blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, -3)).toEqual(
      HAND_SHAPES.restFlat
    );
    expect(blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, 9)).toEqual(
      HAND_SHAPES.overCards
    );
  });

  it("keeps a blend as non-uniform as its endpoints", () => {
    const mid = blendHandShapes(HAND_SHAPES.restFlat, HAND_SHAPES.overCards, 0.5);
    expect(shapeVariation(mid)).toBeGreaterThan(0.05);
  });
});

describe("palmNormal", () => {
  it("points out of the back of the hand, away from the thumb", () => {
    const n = palmNormal(WRIST, INDEX_BASE, PINKY_BASE, THUMB_BASE);
    expect(len(n)).toBeCloseTo(1, 9);
    // The thumb sits on the palm side, so it must be on the negative side.
    expect(dot(THUMB_BASE, n)).toBeLessThan(0);
  });

  it("gives the same physical plane whichever way the thumb is offset", () => {
    const near = palmNormal(WRIST, INDEX_BASE, PINKY_BASE, vec(-0.35, 0.5, -0.05));
    const far = palmNormal(WRIST, INDEX_BASE, PINKY_BASE, vec(-0.35, 0.5, -0.6));
    expect(dot(near, far)).toBeCloseTo(1, 9);
  });

  /**
   * A left hand is a mirrored right hand: the knuckle order across the palm
   * reverses, and the normal must still come out on the back of the hand
   * rather than flipping into it.
   */
  it("resolves a mirrored (left) hand the same way round", () => {
    const n = palmNormal(WRIST, PINKY_BASE, INDEX_BASE, THUMB_BASE);
    expect(dot(THUMB_BASE, n)).toBeLessThan(0);
  });
});

describe("curlAxis", () => {
  const forward = vec(0, 1, 0);
  const normal = vec(0, 0, 1);

  it("is perpendicular to both the finger and the palm", () => {
    const axis = curlAxis(forward, normal);
    expect(len(axis)).toBeCloseTo(1, 9);
    expect(dot(axis, forward)).toBeCloseTo(0, 9);
    expect(dot(axis, normal)).toBeCloseTo(0, 9);
  });

  /**
   * The ordering inside `curlAxis` is its entire content — with the cross
   * product the other way round every finger on every character bends
   * backwards, which is a thing a render shows and a type checker does not.
   */
  it("makes a positive angle flex toward the palm", () => {
    const axis = curlAxis(forward, normal);
    expect(curlsTowardPalm(forward, normal, axis)).toBe(true);
    const flexed = rotateAbout(forward, axis, 0.6);
    expect(dot(flexed, normal)).toBeLessThan(0);
  });

  it("reports a reversed axis as bending the wrong way", () => {
    const axis = curlAxis(forward, normal);
    expect(curlsTowardPalm(forward, normal, { x: -axis.x, y: -axis.y, z: -axis.z })).toBe(false);
  });

  it("returns a usable axis rather than NaN for a degenerate joint", () => {
    const axis = curlAxis(forward, forward);
    expect(Number.isFinite(axis.x + axis.y + axis.z)).toBe(true);
    expect(len(axis)).toBeCloseTo(1, 9);
  });
});

describe("spreadSign", () => {
  const normal = norm(palmNormal(WRIST, INDEX_BASE, PINKY_BASE, THUMB_BASE));

  it("splays the two outer fingers to opposite sides", () => {
    const index = spreadSign(INDEX_BASE, MIDDLE_BASE, WRIST, normal);
    const pinky = spreadSign(PINKY_BASE, MIDDLE_BASE, WRIST, normal);
    expect(index).not.toBe(0);
    expect(pinky).not.toBe(0);
    expect(index).toBe(-pinky);
  });

  /** The middle finger is the reference, so it must not be given a side. */
  it("gives the middle finger no direction to splay in", () => {
    expect(spreadSign(MIDDLE_BASE, MIDDLE_BASE, WRIST, normal)).toBe(0);
  });

  /**
   * Measured rather than assumed from handedness: on a mirrored hand the
   * same finger must splay the other way, and nothing in this codebase knows
   * which of a rig's two chains is which without looking.
   */
  it("reverses on a mirrored hand", () => {
    const mirror = (v: { x: number; y: number; z: number }) => vec(-v.x, v.y, v.z);
    const mirroredNormal = norm(
      palmNormal(WRIST, mirror(INDEX_BASE), mirror(PINKY_BASE), mirror(THUMB_BASE))
    );
    const right = spreadSign(INDEX_BASE, MIDDLE_BASE, WRIST, normal);
    const left = spreadSign(mirror(INDEX_BASE), mirror(MIDDLE_BASE), WRIST, mirroredNormal);
    expect(left).toBe(-right);
  });
});
