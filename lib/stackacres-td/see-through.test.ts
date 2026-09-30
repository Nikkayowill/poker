import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BODY_POINTS,
  FADE_MS,
  SEE_THROUGH_ALPHA,
  TAP_FOOT,
  canHide,
  fadeStep,
  hidesFarmer,
  nearBody,
  tapPassesThrough,
} from "./see-through";

// A tree whose crown is a solid disc of radius 20 centred 30px above its base, on a 48 x 60 box.
const TREE_BASE = { x: 100, y: 200 };
const TREE_BOX = { x: 76, y: 140, width: 48, height: 60 };
const crown = (x: number, y: number) => Math.hypot(x - TREE_BASE.x, y - (TREE_BASE.y - 30)) <= 20;

describe("hidesFarmer", () => {
  it("fades a tree when he stands behind its crown", () => {
    expect(hidesFarmer(TREE_BASE.y, TREE_BOX, { x: 100, y: 185 }, crown)).toBe(true);
  });

  it("leaves it alone when he stands in front of it", () => {
    // His feet are south of the tree's base, so he is drawn over it.
    expect(hidesFarmer(TREE_BASE.y, TREE_BOX, { x: 100, y: 205 }, crown)).toBe(false);
  });

  it("judges the picture's pixels, not its box", () => {
    // Inside the box, north of the base, but only the empty corner beside the crown covers him.
    expect(hidesFarmer(TREE_BASE.y, TREE_BOX, { x: 78, y: 160 }, crown)).toBe(false);
  });

  it("ignores something off to one side", () => {
    expect(hidesFarmer(TREE_BASE.y, TREE_BOX, { x: 180, y: 185 }, () => true)).toBe(false);
  });
});

describe("nearBody", () => {
  it("finds a box his body reaches into", () => {
    expect(nearBody(TREE_BOX, { x: 100, y: 185 })).toBe(true);
  });

  it("skips one he is nowhere near", () => {
    expect(nearBody(TREE_BOX, { x: 300, y: 185 })).toBe(false);
    expect(nearBody(TREE_BOX, { x: 100, y: 300 })).toBe(false);
  });
});

describe("the body points", () => {
  it("stay inside the farmer's drawn frames", () => {
    // The standing frames cover x 15..33 and y 14..46 of a 48px frame whose feet are at row 44.
    const sheet = JSON.parse(readFileSync(join(process.cwd(), "public/stackacres-td/characters/farmer.json"), "utf8")) as {
      frames: Record<string, { frame: { w: number; h: number } }>;
    };
    expect(sheet.frames["1"].frame).toMatchObject({ w: 48, h: 48 });
    for (const point of BODY_POINTS) {
      expect(24 + point.x).toBeGreaterThanOrEqual(15);
      expect(24 + point.x).toBeLessThan(33);
      expect(44 + point.y).toBeGreaterThanOrEqual(14);
      expect(44 + point.y).toBeLessThan(46);
    }
  });
});

describe("canHide", () => {
  it("counts trees and buildings, not rocks and bushes", () => {
    expect(canHide(60)).toBe(true);
    expect(canHide(14)).toBe(false);
  });
});

describe("fadeStep", () => {
  it("fades all the way in FADE_MS and stops there", () => {
    let alpha = 1;
    for (let t = 0; t < FADE_MS; t += 10) alpha = fadeStep(alpha, SEE_THROUGH_ALPHA, 10);
    expect(alpha).toBeCloseTo(SEE_THROUGH_ALPHA);
    expect(fadeStep(alpha, SEE_THROUGH_ALPHA, 1000)).toBe(SEE_THROUGH_ALPHA);
  });

  it("comes back to solid without overshooting", () => {
    expect(fadeStep(0.9, 1, 1000)).toBe(1);
  });
});

describe("tapPassesThrough", () => {
  it("lets a tap through a faded crown to the bed behind it", () => {
    expect(tapPassesThrough(true, 200, 170)).toBe(true);
  });

  it("still catches a tap on the foot it stands on", () => {
    expect(tapPassesThrough(true, 200, 200 - TAP_FOOT + 2)).toBe(false);
  });

  it("catches every tap while it is solid", () => {
    expect(tapPassesThrough(false, 200, 170)).toBe(false);
  });
});
