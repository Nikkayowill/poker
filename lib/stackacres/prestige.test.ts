import { describe, expect, it } from "vitest";
import {
  STACKACRES_PRESTIGE_BASE_MULTIPLIER,
  STACKACRES_PRESTIGE_DEFAULT_STATE,
  STACKACRES_PRESTIGE_GROSS_PER_POINT,
  STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
  STACKACRES_PRESTIGE_MULTIPLIER_CAP,
  computePrestigeGain,
  prestigeGoldRemaining,
  type StackAcresPrestigeState,
} from "./prestige";

describe("computePrestigeGain", () => {
  it("refuses a profile that has earned nothing at all", () => {
    const result = computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 0);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("not_enough_lifetime_gross");
    expect(result.gainedMultiplier).toBe(0);
    expect(result.nextMultiplier).toBe(STACKACRES_PRESTIGE_BASE_MULTIPLIER);
  });

  it("refuses just below the minimum threshold", () => {
    const result = computePrestigeGain(
      STACKACRES_PRESTIGE_DEFAULT_STATE,
      STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS - 1,
    );
    expect(result.eligible).toBe(false);
    expect(result.eligibleGross).toBe(STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS - 1);
  });

  it("accepts exactly at the minimum threshold and grants a positive, sub-1x gain", () => {
    const result = computePrestigeGain(
      STACKACRES_PRESTIGE_DEFAULT_STATE,
      STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
    );
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("reset");
    expect(result.gainedMultiplier).toBeGreaterThan(0);
    expect(result.gainedMultiplier).toBeLessThan(1);
    expect(result.nextMultiplier).toBeCloseTo(
      STACKACRES_PRESTIGE_BASE_MULTIPLIER + result.gainedMultiplier,
      4,
    );
  });

  it("pins the documented arithmetic table exactly", () => {
    expect(computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 150_000).gainedMultiplier).toBeCloseTo(
      0.4472,
      4,
    );
    expect(computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 750_000).gainedMultiplier).toBeCloseTo(
      1.0,
      4,
    );
    expect(
      computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 3_000_000).gainedMultiplier,
    ).toBeCloseTo(2.0, 4);
    expect(
      computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 6_750_000).gainedMultiplier,
    ).toBeCloseTo(3.0, 4);
  });

  it("doubling the eligible gross never doubles the gain (diminishing returns)", () => {
    const small = computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, STACKACRES_PRESTIGE_GROSS_PER_POINT);
    const doubled = computePrestigeGain(
      STACKACRES_PRESTIGE_DEFAULT_STATE,
      STACKACRES_PRESTIGE_GROSS_PER_POINT * 2,
    );
    expect(doubled.gainedMultiplier).toBeGreaterThan(small.gainedMultiplier);
    expect(doubled.gainedMultiplier).toBeLessThan(small.gainedMultiplier * 2);
  });

  it("only counts gross earned since the last reset, never re-spending what a prior reset already counted", () => {
    const alreadyReset: StackAcresPrestigeState = {
      prestigeCount: 1,
      multiplier: 1.4472,
      lifetimeGrossAtReset: 150_000,
    };
    // Same total lifetime gross as the reset that already happened -- nothing NEW has been earned.
    const result = computePrestigeGain(alreadyReset, 150_000);
    expect(result.eligible).toBe(false);
    expect(result.eligibleGross).toBe(0);
  });

  it("never lets the multiplier exceed the hard cap, no matter how much gross is behind it", () => {
    const result = computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 1_000_000_000);
    expect(result.nextMultiplier).toBe(STACKACRES_PRESTIGE_MULTIPLIER_CAP);
  });

  it("never returns a multiplier below the base, even from a state that somehow started under it", () => {
    const result = computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 0);
    expect(result.nextMultiplier).toBeGreaterThanOrEqual(STACKACRES_PRESTIGE_BASE_MULTIPLIER);
  });

  it("treats a fractional or negative total lifetime gross safely", () => {
    expect(() => computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, -5)).not.toThrow();
    expect(computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, -5).eligibleGross).toBe(0);
    expect(computePrestigeGain(STACKACRES_PRESTIGE_DEFAULT_STATE, 150_000.9).eligibleGross).toBe(150_000);
  });
});

describe("prestigeGoldRemaining", () => {
  it("reports the full threshold for a fresh profile", () => {
    expect(prestigeGoldRemaining(STACKACRES_PRESTIGE_DEFAULT_STATE, 0)).toBe(
      STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS,
    );
  });

  it("counts down as gross accumulates", () => {
    expect(prestigeGoldRemaining(STACKACRES_PRESTIGE_DEFAULT_STATE, 100_000)).toBe(
      STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS - 100_000,
    );
  });

  it("floors at zero once eligible, never goes negative", () => {
    expect(prestigeGoldRemaining(STACKACRES_PRESTIGE_DEFAULT_STATE, STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS)).toBe(0);
    expect(
      prestigeGoldRemaining(STACKACRES_PRESTIGE_DEFAULT_STATE, STACKACRES_PRESTIGE_MIN_ELIGIBLE_GROSS + 500_000),
    ).toBe(0);
  });
});
