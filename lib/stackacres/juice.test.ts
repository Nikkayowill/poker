import { describe, expect, it } from "vitest";
import { STACKACRES_STOCK, type StackAcresStock } from "./catalogue";
import { STACKACRES_YIELDS } from "./items";
import {
  CRIT_SHAKE_DURATION_MS,
  STACKACRES_JUICE_STYLES,
  barnAbsorbAlpha,
  barnAbsorbDepth,
  barnAbsorbScale,
  barnArcControlPoint,
  critFlashLabel,
  critShakeIntensity,
  harvestPopAngleRange,
  juiceItemFor,
  juiceStyleFor,
  quadraticBezierPoint,
} from "./juice";

describe("STACKACRES_JUICE_STYLES", () => {
  it("styles every real stock, and nothing else", () => {
    for (const stock of STACKACRES_STOCK) {
      expect(STACKACRES_JUICE_STYLES[stock], stock).toBeDefined();
    }
    expect(Object.keys(STACKACRES_JUICE_STYLES).sort()).toEqual([...STACKACRES_STOCK].sort());
  });

  it("keeps every style's ranges sane", () => {
    for (const stock of STACKACRES_STOCK) {
      const style = STACKACRES_JUICE_STYLES[stock];
      expect(style.shardCount, stock).toBeGreaterThan(0);
      expect(style.shardRadius, stock).toBeGreaterThan(0);
      expect(style.gravity, stock).toBeGreaterThan(0);
      expect(style.speed.max, stock).toBeGreaterThanOrEqual(style.speed.min);
      expect(style.lifeMs.max, stock).toBeGreaterThanOrEqual(style.lifeMs.min);
    }
  });

  it("juiceStyleFor is the same table lookup", () => {
    for (const stock of STACKACRES_STOCK) {
      expect(juiceStyleFor(stock)).toBe(STACKACRES_JUICE_STYLES[stock]);
    }
  });
});

describe("juiceItemFor", () => {
  it("matches ./items.ts's own yield table, never a second guess", () => {
    for (const stock of STACKACRES_STOCK) {
      expect(juiceItemFor(stock)).toBe(STACKACRES_YIELDS[stock].item);
    }
  });
});

describe("harvestPopAngleRange", () => {
  it("is centred on straight up (270 degrees, Phaser's own convention)", () => {
    const range = harvestPopAngleRange();
    expect((range.min + range.max) / 2).toBe(270);
  });

  it("is a 100 degree cone, never sideways or downward", () => {
    const range = harvestPopAngleRange();
    expect(range.max - range.min).toBe(100);
    // Straight up is 270; sideways is 180/360, downward is 90. A 100-degree
    // cone centred on 270 must stay clear of both.
    expect(range.min).toBeGreaterThan(180);
    expect(range.max).toBeLessThan(360);
  });
});

describe("critFlashLabel", () => {
  it.each([
    [2, "CRIT! x2"],
    [1.75, "CRIT! x1.75"],
    [1.5, "CRIT! x1.5"],
    [1, "CRIT! x1"],
  ])("formats %s as %s", (multiplier, expected) => {
    expect(critFlashLabel(multiplier)).toBe(expected);
  });

  it("falls back to x1 for a nonsense multiplier rather than printing garbage", () => {
    expect(critFlashLabel(0)).toBe("CRIT! x1");
    expect(critFlashLabel(-3)).toBe("CRIT! x1");
    expect(critFlashLabel(Number.NaN)).toBe("CRIT! x1");
  });
});

describe("critShakeIntensity", () => {
  it("is at its base with no bonus (a x1 multiplier)", () => {
    expect(critShakeIntensity(1)).toBeCloseTo(0.0012, 6);
  });

  it("grows with the multiplier", () => {
    expect(critShakeIntensity(1.75)).toBeGreaterThan(critShakeIntensity(1.5));
    expect(critShakeIntensity(2)).toBeGreaterThan(critShakeIntensity(1.75));
  });

  it("never exceeds the Golden Spade's own cap even for a hypothetically richer crit", () => {
    const atCap = critShakeIntensity(2); // Golden Spade: critBonus 1 -> multiplier 2
    expect(critShakeIntensity(5)).toBeCloseTo(atCap, 9);
  });

  it("stays MICRO -- well under Phaser's own commonly-cited noticeable shake", () => {
    expect(critShakeIntensity(2)).toBeLessThan(0.01);
  });

  it("has a fixed, short duration", () => {
    expect(CRIT_SHAKE_DURATION_MS).toBeLessThanOrEqual(150);
  });
});

describe("quadraticBezierPoint", () => {
  it("starts at p0 and ends at p2", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 50, y: -80 };
    const p2 = { x: 100, y: 20 };
    expect(quadraticBezierPoint(p0, p1, p2, 0)).toEqual(p0);
    expect(quadraticBezierPoint(p0, p1, p2, 1)).toEqual(p2);
  });

  it("is pulled toward the control point at the midpoint", () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: -100 };
    const p2 = { x: 200, y: 0 };
    const mid = quadraticBezierPoint(p0, p1, p2, 0.5);
    // Straight-line midpoint would be (100, 0); the curve bows toward p1.
    expect(mid.y).toBeLessThan(0);
  });
});

describe("barnArcControlPoint", () => {
  it("sits above the flight's own midpoint, centred horizontally", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 40 };
    const control = barnArcControlPoint(start, end);
    expect(control.x).toBeCloseTo(50, 6);
    expect(control.y).toBeLessThan(20); // above the straight-line midpoint's y
  });

  it("floors the lift for a short hop right next to the barn", () => {
    const control = barnArcControlPoint({ x: 0, y: 0 }, { x: 2, y: 1 });
    expect(control.y).toBeLessThanOrEqual(-23);
  });

  it("arcs higher for a longer flight", () => {
    const shortLift = barnArcControlPoint({ x: 0, y: 0 }, { x: 40, y: 0 }).y;
    const longLift = barnArcControlPoint({ x: 0, y: 0 }, { x: 400, y: 0 }).y;
    expect(Math.abs(longLift)).toBeGreaterThan(Math.abs(shortLift));
  });
});

describe("barnAbsorbScale / barnAbsorbAlpha", () => {
  it("stay full-size and opaque until the fade window", () => {
    expect(barnAbsorbScale(0)).toBe(1);
    expect(barnAbsorbScale(0.5)).toBe(1);
    expect(barnAbsorbScale(0.75)).toBe(1);
    expect(barnAbsorbAlpha(0.5)).toBe(1);
  });

  it("shrink and fade to nothing by the end of the flight", () => {
    expect(barnAbsorbScale(1)).toBeCloseTo(0.4, 6);
    expect(barnAbsorbAlpha(1)).toBeCloseTo(0, 6);
  });

  it("is monotonic across the fade window", () => {
    expect(barnAbsorbScale(0.8)).toBeGreaterThan(barnAbsorbScale(0.9));
    expect(barnAbsorbAlpha(0.8)).toBeGreaterThan(barnAbsorbAlpha(0.9));
  });
});

describe("barnAbsorbDepth", () => {
  it("lerps linearly between the two ends", () => {
    expect(barnAbsorbDepth(100, 300, 0)).toBe(100);
    expect(barnAbsorbDepth(100, 300, 1)).toBe(300);
    expect(barnAbsorbDepth(100, 300, 0.5)).toBe(200);
  });
});

describe("every stock is reachable by name", () => {
  it("STACKACRES_STOCK and StackAcresStock stay in sync with the juice table", () => {
    const stocks: readonly StackAcresStock[] = STACKACRES_STOCK;
    expect(stocks.every((s) => s in STACKACRES_JUICE_STYLES)).toBe(true);
  });
});
