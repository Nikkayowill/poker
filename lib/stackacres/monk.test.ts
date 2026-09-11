import { describe, expect, it } from "vitest";

import {
  MONK_BOW_MS,
  MONK_POST,
  MONK_TAP_ZONE,
  monkHitAt,
  spawnMonk,
  startMonkBow,
  stepMonk,
} from "./monk";
import { FARMHAND_WORK_MS } from "./farmhand";
import { nearPath } from "./paths";
import { DOCK, LILY_PADS, REEDS, RIPPLE_SPOTS, inPond, inPondZone } from "./water";
import { barnHitAt, growAreaAt } from "./world";
import { worldBoundsRect } from "./bounds";

/** The box's four corners -- what every geometry check below sweeps, the
 *  same way farmhand.test.ts proves a single point. */
function corners(): Array<{ x: number; y: number }> {
  const { x, y, width, height } = MONK_TAP_ZONE;
  return [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ];
}

/** The pond's own fixed decor, all in one list so a "how far is the nearest
 *  piece" check does not have to name each one. */
function pondDecor(): Array<{ x: number; y: number }> {
  return [...REEDS, ...LILY_PADS, ...RIPPLE_SPOTS, DOCK];
}

describe("MONK_POST", () => {
  it("stands clear of the barn, every path and any worked ground", () => {
    const { x, y } = MONK_POST;
    expect(barnHitAt(x, y)).toBe(false);
    expect(nearPath(x, y)).toBe(false);
    expect(growAreaAt(x, y)).toBeNull();
  });

  it("is near the water -- inside the pond's own clearing, not standing in it", () => {
    expect(inPondZone(MONK_POST.x, MONK_POST.y)).toBe(true);
    expect(inPond(MONK_POST.x, MONK_POST.y)).toBe(false);
  });

  it("is inside the camera's own world bounds", () => {
    const bounds = worldBoundsRect();
    expect(MONK_POST.x).toBeGreaterThan(bounds.x);
    expect(MONK_POST.x).toBeLessThan(bounds.x + bounds.width);
    expect(MONK_POST.y).toBeGreaterThan(bounds.y);
    expect(MONK_POST.y).toBeLessThan(bounds.y + bounds.height);
  });

  it("stands well clear of the pond's own fixed decor", () => {
    for (const spot of pondDecor()) {
      expect(Math.hypot(MONK_POST.x - spot.x, MONK_POST.y - spot.y)).toBeGreaterThan(40);
    }
  });
});

describe("MONK_TAP_ZONE", () => {
  it("clears the barn, every path and any worked ground at every corner", () => {
    for (const { x, y } of corners()) {
      expect(barnHitAt(x, y)).toBe(false);
      expect(nearPath(x, y)).toBe(false);
      expect(growAreaAt(x, y)).toBeNull();
    }
  });

  it("never dips into the water itself, even at its own north edge", () => {
    for (const { x, y } of corners()) {
      expect(inPond(x, y)).toBe(false);
    }
  });

  it("sits entirely inside the pond's own clearing, so wild scenery never grows over him", () => {
    // Load-bearing, not decoration: `blocked()` (./world.ts) refuses wild
    // growth wherever `inPondZone` is true, and a placement that left even
    // one corner outside it once grew a wall of procedurally-planted pine
    // right in front of him -- see MONK_POST's own header.
    for (const { x, y } of corners()) {
      expect(inPondZone(x, y)).toBe(true);
    }
  });

  it("sits inside the camera's own world bounds", () => {
    const bounds = worldBoundsRect();
    for (const { x, y } of corners()) {
      expect(x).toBeGreaterThan(bounds.x);
      expect(x).toBeLessThan(bounds.x + bounds.width);
      expect(y).toBeGreaterThan(bounds.y);
      expect(y).toBeLessThan(bounds.y + bounds.height);
    }
  });

  it("is anchored with its feet at MONK_POST", () => {
    expect(MONK_TAP_ZONE.x + MONK_TAP_ZONE.width / 2).toBe(MONK_POST.x);
    expect(MONK_TAP_ZONE.y + MONK_TAP_ZONE.height).toBe(MONK_POST.y);
  });
});

describe("monkHitAt", () => {
  it("is true inside the tap zone, false just outside it", () => {
    const { x, y, width, height } = MONK_TAP_ZONE;
    expect(monkHitAt(x + width / 2, y + height / 2)).toBe(true);
    expect(monkHitAt(x - 1, y)).toBe(false);
    expect(monkHitAt(x, y - 1)).toBe(false);
    expect(monkHitAt(x + width + 1, y + height)).toBe(false);
  });
});

describe("MONK_BOW_MS", () => {
  it("reuses the farmhand's own work timer -- the frame he holds is the same one", () => {
    expect(MONK_BOW_MS).toBe(FARMHAND_WORK_MS);
  });
});

describe("stepMonk", () => {
  it("starts standing", () => {
    const pose = spawnMonk();
    expect(pose.bowMs).toBe(0);
    const { frame } = stepMonk(pose, 16);
    expect(frame.crouched).toBe(false);
    expect(frame.bobLift).toBe(0);
  });

  it("crouches for the whole hold once a bow starts, and rises exactly at the end", () => {
    let pose = startMonkBow();
    expect(pose.bowMs).toBe(MONK_BOW_MS);

    let sawCrouch = false;
    for (let elapsed = 0; elapsed < MONK_BOW_MS; elapsed += 16) {
      const step = stepMonk(pose, 16);
      pose = step.pose;
      if (step.frame.crouched) sawCrouch = true;
    }
    expect(sawCrouch).toBe(true);
    expect(pose.bowMs).toBe(0);
    expect(stepMonk(pose, 16).frame.crouched).toBe(false);
  });

  it("bobs up from zero, peaks mid-bow, and settles back to zero", () => {
    let pose = startMonkBow();
    const lifts: number[] = [];
    for (let elapsed = 0; elapsed < MONK_BOW_MS; elapsed += 16) {
      const step = stepMonk(pose, 16);
      pose = step.pose;
      lifts.push(step.frame.bobLift);
    }
    expect(lifts[0]).toBeGreaterThan(0);
    expect(Math.max(...lifts)).toBeGreaterThan(lifts[0]);
    expect(lifts[lifts.length - 1]).toBeCloseTo(0, 1);
  });

  it("clamps a huge delta (a backgrounded tab) to one bow's own length, never negative", () => {
    const pose = startMonkBow();
    const step = stepMonk(pose, MONK_BOW_MS * 50);
    expect(step.pose.bowMs).toBe(0);
    expect(step.frame.crouched).toBe(false);
  });

  it("ignores a non-positive delta", () => {
    const pose = startMonkBow();
    const step = stepMonk(pose, 0);
    expect(step.pose.bowMs).toBe(MONK_BOW_MS);
    const step2 = stepMonk(pose, -16);
    expect(step2.pose.bowMs).toBe(MONK_BOW_MS);
  });

  it("startMonkBow always starts a fresh, full bow", () => {
    expect(startMonkBow()).toEqual({ bowMs: MONK_BOW_MS });
  });
});
