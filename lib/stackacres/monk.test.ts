import { describe, expect, it } from "vitest";

import {
  MONK_BOW_MS,
  MONK_HOUSE_FOOTPRINT,
  MONK_POST,
  monkHitAt,
  spawnMonk,
  startMonkBow,
  stepMonk,
} from "./monk";
import { FARMHAND_WORK_MS } from "./farmhand";
import { nearPath } from "./paths";
import { inPondZone } from "./water";
import { BARN_FOOTPRINT, FARM_ZONE, barnHitAt, growAreaAt, inFarmZone } from "./world";

/** The footprint's four corners -- what every geometry check below sweeps,
 *  the same way farmhand.test.ts proves a single point. */
function corners(): Array<{ x: number; y: number }> {
  const { x, y, width, height } = MONK_HOUSE_FOOTPRINT;
  return [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ];
}

describe("MONK_POST", () => {
  // The same six constraints farmhand.test.ts holds FARMHAND_BASE to --
  // this is that exact point, reused (see monk.ts's doc comment).
  it("stands on the farm, clear of everything already there", () => {
    const { x, y } = MONK_POST;
    expect(inFarmZone(x, y)).toBe(true);
    expect(barnHitAt(x, y)).toBe(false);
    expect(nearPath(x, y)).toBe(false);
    expect(inPondZone(x, y)).toBe(false);
    expect(growAreaAt(x, y)).toBeNull();
  });

  it("is inside the camera's own world bounds", () => {
    expect(MONK_POST.x).toBeGreaterThan(FARM_ZONE.x);
    expect(MONK_POST.x).toBeLessThan(FARM_ZONE.x + FARM_ZONE.width);
    expect(MONK_POST.y).toBeGreaterThan(FARM_ZONE.y);
    expect(MONK_POST.y).toBeLessThan(FARM_ZONE.y + FARM_ZONE.height);
  });

  it("does not stand on top of Grandfather Ray's own post", () => {
    // Ray is a static prop at (175, 20) and is 20 units wide.
    expect(Math.hypot(MONK_POST.x - 175, MONK_POST.y - 20)).toBeGreaterThan(20);
    expect(MONK_POST.y).toBeGreaterThan(BARN_FOOTPRINT.y + BARN_FOOTPRINT.height);
  });
});

describe("MONK_HOUSE_FOOTPRINT", () => {
  it("clears the barn, every path, the pond and the Farmstead fence at every corner", () => {
    for (const { x, y } of corners()) {
      expect(barnHitAt(x, y)).toBe(false);
      expect(nearPath(x, y)).toBe(false);
      expect(inPondZone(x, y)).toBe(false);
      expect(growAreaAt(x, y)).toBeNull();
    }
  });

  it("sits inside the camera's own world bounds", () => {
    for (const { x, y } of corners()) {
      expect(x).toBeGreaterThan(FARM_ZONE.x);
      expect(x).toBeLessThan(FARM_ZONE.x + FARM_ZONE.width);
      expect(y).toBeGreaterThan(FARM_ZONE.y);
      expect(y).toBeLessThan(FARM_ZONE.y + FARM_ZONE.height);
    }
  });

  it("does not swallow Grandfather Ray's own post", () => {
    for (const { x, y } of corners()) {
      expect(Math.hypot(x - 175, y - 20)).toBeGreaterThan(20);
    }
  });

  it("sits north of MONK_POST -- he stands in front of his own door", () => {
    expect(MONK_HOUSE_FOOTPRINT.y + MONK_HOUSE_FOOTPRINT.height).toBeLessThanOrEqual(MONK_POST.y);
  });
});

describe("monkHitAt", () => {
  it("is true inside the footprint, false just outside it", () => {
    const { x, y, width, height } = MONK_HOUSE_FOOTPRINT;
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
