import { describe, expect, it } from "vitest";
import { CHOP_SWEEP_MS, CHOP_SWEET_ZONE, chopMeterValue, gradeChopSwing, isChopSweetHit } from "./chop";

describe("chopMeterValue", () => {
  it("starts at 0 and climbs to 1 across the first half-sweep", () => {
    expect(chopMeterValue(0)).toBe(0);
    expect(chopMeterValue(CHOP_SWEEP_MS)).toBe(1);
  });

  it("swings back down to 0 across the second half-sweep", () => {
    expect(chopMeterValue(CHOP_SWEEP_MS * 1.5)).toBeCloseTo(0.5);
    expect(chopMeterValue(CHOP_SWEEP_MS * 2)).toBeCloseTo(0);
  });

  it("loops: a third sweep reads the same as the first", () => {
    expect(chopMeterValue(CHOP_SWEEP_MS * 2 + 100)).toBeCloseTo(chopMeterValue(100));
  });
});

describe("isChopSweetHit", () => {
  it("is true only inside the sweet zone", () => {
    expect(isChopSweetHit(CHOP_SWEET_ZONE.min)).toBe(true);
    expect(isChopSweetHit(CHOP_SWEET_ZONE.max)).toBe(true);
    expect(isChopSweetHit((CHOP_SWEET_ZONE.min + CHOP_SWEET_ZONE.max) / 2)).toBe(true);
    expect(isChopSweetHit(CHOP_SWEET_ZONE.min - 0.01)).toBe(false);
    expect(isChopSweetHit(CHOP_SWEET_ZONE.max + 0.01)).toBe(false);
  });
});

describe("gradeChopSwing", () => {
  it("grades a press against the meter's value at that instant", () => {
    const midSweep = CHOP_SWEEP_MS * ((CHOP_SWEET_ZONE.min + CHOP_SWEET_ZONE.max) / 2);
    const { value, sweet } = gradeChopSwing(midSweep);
    expect(sweet).toBe(true);
    expect(value).toBeGreaterThanOrEqual(CHOP_SWEET_ZONE.min);
    expect(value).toBeLessThanOrEqual(CHOP_SWEET_ZONE.max);
  });

  it("never sweet-grades a press right at the start of a swing", () => {
    expect(gradeChopSwing(0).sweet).toBe(false);
  });

  it("treats a negative timestamp the same as pressing immediately", () => {
    expect(gradeChopSwing(-50)).toEqual(gradeChopSwing(0));
  });
});
