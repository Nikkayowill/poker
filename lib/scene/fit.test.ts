import { describe, expect, it } from "vitest";
import {
  MAX_ROOM_LIFT,
  MAX_ROOM_SCALE,
  MIN_ROOM_LIFT,
  MIN_ROOM_SCALE,
  rendererSize,
  solveRoomLift,
  solveRoomScale,
} from "./fit";
import { MAX_PIXEL_RATIO } from "./scene-config";

/**
 * A stand-in for the real projection: strictly increasing in scale, which is
 * the only property bisection relies on. Using an analytic projector rather
 * than a camera keeps this test free of `three` -- and of a WebGL context,
 * which does not exist under Vitest.
 */
const projector = (pixelsPerUnit: number) => (scale: number) => scale * pixelsPerUnit;

describe("room scale solve", () => {
  it("finds the scale whose felt fills the DOM table's box", () => {
    const scale = solveRoomScale(projector(400), 600);
    expect(scale).toBeCloseTo(1.5, 2);
  });

  it("lands within a pixel of the target across the range of real tables", () => {
    // The measured widths a .poker-table-wrap actually takes, from a portrait
    // phone plate to a desktop one.
    for (const targetPx of [320, 376, 620, 850, 1082, 1440]) {
      const project = projector(700);
      const scale = solveRoomScale(project, targetPx);
      expect(Math.abs(project(scale) - targetPx)).toBeLessThanOrEqual(0.5);
    }
  });

  it("clamps rather than running away on an unreachable target", () => {
    // A zero-width box during layout, or a detached canvas -- a broken
    // measurement, not a table. A scale of 40 would put the felt through the
    // camera; a clamp is a better failure.
    expect(solveRoomScale(projector(700), 1)).toBe(MIN_ROOM_SCALE);
    expect(solveRoomScale(projector(700), 100_000)).toBe(MAX_ROOM_SCALE);
  });

  it("returns a neutral scale on a nonsense target rather than NaN", () => {
    expect(solveRoomScale(projector(700), 0)).toBe(1);
    expect(solveRoomScale(projector(700), -400)).toBe(1);
    expect(solveRoomScale(projector(700), Number.NaN)).toBe(1);
  });

  it("terminates on a projector that is not monotonic", () => {
    // Would mean the camera is inside the table. It must not spin.
    const scale = solveRoomScale(() => 500, 600);
    expect(Number.isFinite(scale)).toBe(true);
  });
});

/**
 * The second half of the fit. Scaling matches how *wide* the projected seat
 * ring is; only the lift decides where it sits in frame, and getting it wrong
 * is what put the 3D near seat 118px below the DOM avatar sitting in that
 * same chair -- the exact defect that would make Layer C unusable.
 */
describe("room lift solve", () => {
  /**
   * Screen Y grows downward while world Y grows up, so a projected centre is
   * monotonically *decreasing* in lift. That inverted direction is the thing
   * most likely to be got wrong, so it is what the stand-in models.
   */
  const projector = (pxPerUnit: number, atZero: number) => (lift: number) => atZero - lift * pxPerUnit;

  it("finds the lift that puts the ring where the DOM drew it", () => {
    const lift = solveRoomLift(projector(40, 758), 640);
    expect(lift).toBeCloseTo(2.95, 1);
  });

  it("solves a decreasing function without needing to be told it decreases", () => {
    for (const target of [400, 512, 640, 700, 820]) {
      const project = projector(55, 700);
      const lift = solveRoomLift(project, target);
      expect(Math.abs(project(lift) - target)).toBeLessThanOrEqual(0.5);
    }
  });

  it("still solves an increasing function, in case the axis is ever flipped", () => {
    const project = (lift: number) => 300 + lift * 30;
    const lift = solveRoomLift(project, 450);
    expect(Math.abs(project(lift) - 450)).toBeLessThanOrEqual(0.5);
  });

  it("clamps rather than running away on an unreachable target", () => {
    expect(solveRoomLift(projector(40, 758), -10_000)).toBe(MAX_ROOM_LIFT);
    expect(solveRoomLift(projector(40, 758), 10_000)).toBe(MIN_ROOM_LIFT);
  });

  it("leaves the room where it is on a nonsense measurement", () => {
    expect(solveRoomLift(projector(40, 758), Number.NaN)).toBe(0);
    expect(solveRoomLift(() => Number.NaN, 640)).toBe(0);
  });

  it("needs no lift when the two rings already agree", () => {
    expect(solveRoomLift(projector(40, 640), 640)).toBeCloseTo(0, 6);
  });
});

describe("renderer sizing", () => {
  it("caps the pixel ratio, because this scene is mostly soft gradients", () => {
    const size = rendererSize({ width: 390, height: 300 }, 4, MAX_PIXEL_RATIO);
    expect(size.pixelRatio).toBe(MAX_PIXEL_RATIO);
  });

  it("keeps a low-DPR display at its own ratio", () => {
    expect(rendererSize({ width: 800, height: 400 }, 1, MAX_PIXEL_RATIO).pixelRatio).toBe(1);
  });

  it("returns whole pixels so the aspect matches what the camera was given", () => {
    const size = rendererSize({ width: 390.62, height: 247.31 }, 3, MAX_PIXEL_RATIO);
    expect(size.width).toBe(390);
    expect(size.height).toBe(247);
    expect(size.aspect).toBeCloseTo(390 / 247, 12);
  });

  it("never hands the renderer a zero dimension", () => {
    const size = rendererSize({ width: 0, height: 0 }, 2, MAX_PIXEL_RATIO);
    expect(size.width).toBe(1);
    expect(size.height).toBe(1);
    expect(Number.isFinite(size.aspect)).toBe(true);
  });

  it("survives a missing devicePixelRatio", () => {
    expect(rendererSize({ width: 100, height: 100 }, Number.NaN, MAX_PIXEL_RATIO).pixelRatio).toBe(1);
    expect(rendererSize({ width: 100, height: 100 }, 0, MAX_PIXEL_RATIO).pixelRatio).toBe(1);
  });
});
