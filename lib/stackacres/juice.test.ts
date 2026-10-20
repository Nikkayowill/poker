import { describe, expect, it } from "vitest";
import {
  CRIT_SHAKE_DURATION_MS,
  GOLD_TICKER_DURATION_MS,
  goldTickerValue,
  critFlashLabel,
  critShakeIntensity,
} from "./juice";

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

describe("goldTickerValue", () => {
  it("starts at nothing and lands exactly on the payout", () => {
    expect(goldTickerValue(4200, 0)).toBe(0);
    expect(goldTickerValue(4200, 1)).toBe(4200);
    // Past the end is still the payout, never one short of it -- this figure
    // sits next to a balance the player can go and check.
    expect(goldTickerValue(4200, 1.5)).toBe(4200);
  });

  it("counts up, never down", () => {
    let previous = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const shown = goldTickerValue(9999, t);
      expect(shown).toBeGreaterThanOrEqual(previous);
      previous = shown;
    }
  });

  it("front-loads the count so the last digits settle", () => {
    // Ease-out: half the time has already shown well over half the figure.
    expect(goldTickerValue(1000, 0.5)).toBeGreaterThan(800);
  });

  it("shows whole Gold only", () => {
    for (const t of [0.13, 0.37, 0.5, 0.81]) {
      expect(Number.isInteger(goldTickerValue(1337, t))).toBe(true);
    }
  });

  it("has nothing to count for a payout of nothing", () => {
    expect(goldTickerValue(0, 0.5)).toBe(0);
    expect(goldTickerValue(-10, 0.5)).toBe(0);
    expect(goldTickerValue(Number.NaN, 0.5)).toBe(0);
  });

  it("is long enough to read as a count rather than a change", () => {
    expect(GOLD_TICKER_DURATION_MS).toBeGreaterThanOrEqual(600);
  });
});
