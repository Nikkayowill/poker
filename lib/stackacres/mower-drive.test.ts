import { describe, expect, it } from "vitest";
import {
  MOWER_SPEED,
  clampToMeadow,
  mowerFacing,
  mowerStripe,
  stepMowerToward,
} from "./mower-drive";
import { CROP_FIELD } from "./yard";

const ORIGIN = { x: 0, y: 0 };

describe("stepMowerToward", () => {
  it("moves exactly one frame's worth along the line to the target", () => {
    const next = stepMowerToward(ORIGIN, { x: 1_000, y: 0 }, 0.5);
    expect(next.x).toBeCloseTo(MOWER_SPEED * 0.5, 6);
    expect(next.y).toBe(0);
  });

  it("lands on the target instead of overshooting it", () => {
    expect(stepMowerToward(ORIGIN, { x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4 });
  });

  it("stays put with no time or a negative one", () => {
    expect(stepMowerToward(ORIGIN, { x: 50, y: 50 }, 0)).toEqual(ORIGIN);
    expect(stepMowerToward(ORIGIN, { x: 50, y: 50 }, -1)).toEqual(ORIGIN);
  });
});

describe("clampToMeadow", () => {
  it("keeps a point inside the Crop Fields as it is", () => {
    const inside = { x: CROP_FIELD.x + CROP_FIELD.width / 2, y: CROP_FIELD.y + CROP_FIELD.height / 2 };
    expect(clampToMeadow(inside)).toEqual(inside);
  });

  it("pulls a point from anywhere back inside the Crop Fields", () => {
    for (const far of [{ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }, { x: -1e6, y: 1e6 }]) {
      const p = clampToMeadow(far);
      expect(p.x).toBeGreaterThan(CROP_FIELD.x);
      expect(p.x).toBeLessThan(CROP_FIELD.x + CROP_FIELD.width);
      expect(p.y).toBeGreaterThan(CROP_FIELD.y);
      expect(p.y).toBeLessThan(CROP_FIELD.y + CROP_FIELD.height);
    }
  });
});

describe("mowerStripe", () => {
  it("gives opposite stripes to opposite passes, so back-and-forth rows alternate", () => {
    // Screen right is world +x/-y, screen down is world +x/+y.
    const right = mowerStripe(ORIGIN, { x: 10, y: -10 });
    const left = mowerStripe(ORIGIN, { x: -10, y: 10 });
    const down = mowerStripe(ORIGIN, { x: 10, y: 10 });
    const up = mowerStripe(ORIGIN, { x: -10, y: -10 });
    expect(right).not.toBeNull();
    expect(left).toBe(right === 0 ? 1 : 0);
    expect(up).toBe(down === 0 ? 1 : 0);
  });

  it("has no stripe for a pass that did not move", () => {
    expect(mowerStripe(ORIGIN, ORIGIN)).toBeNull();
  });
});

describe("mowerFacing", () => {
  it("faces the way it is going across the screen", () => {
    expect(mowerFacing(ORIGIN, { x: 10, y: -10 }, -1)).toBe(1);
    expect(mowerFacing(ORIGIN, { x: -10, y: 10 }, 1)).toBe(-1);
  });

  it("keeps its facing on a move straight up or down the screen", () => {
    expect(mowerFacing(ORIGIN, { x: 10, y: 10 }, -1)).toBe(-1);
    expect(mowerFacing(ORIGIN, { x: 10, y: 10 }, 1)).toBe(1);
  });
});
