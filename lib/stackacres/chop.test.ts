import { describe, expect, it } from "vitest";
import { SWING_PROFILES, gradeSwing, isSwingSweetHit, swingMeterValue } from "./chop";

describe.each(["chop", "mine"] as const)("swingMeterValue (%s)", (kind) => {
  const { sweepMs } = SWING_PROFILES[kind];

  it("starts at 0 and climbs to 1 across the first half-sweep", () => {
    expect(swingMeterValue(kind, 0)).toBe(0);
    expect(swingMeterValue(kind, sweepMs)).toBe(1);
  });

  it("swings back down to 0 across the second half-sweep", () => {
    expect(swingMeterValue(kind, sweepMs * 1.5)).toBeCloseTo(0.5);
    expect(swingMeterValue(kind, sweepMs * 2)).toBeCloseTo(0);
  });

  it("loops: a third sweep reads the same as the first", () => {
    expect(swingMeterValue(kind, sweepMs * 2 + 100)).toBeCloseTo(swingMeterValue(kind, 100));
  });
});

describe.each(["chop", "mine"] as const)("isSwingSweetHit (%s)", (kind) => {
  const { sweetZone } = SWING_PROFILES[kind];

  it("is true only inside the sweet zone", () => {
    expect(isSwingSweetHit(kind, sweetZone.min)).toBe(true);
    expect(isSwingSweetHit(kind, sweetZone.max)).toBe(true);
    expect(isSwingSweetHit(kind, (sweetZone.min + sweetZone.max) / 2)).toBe(true);
    expect(isSwingSweetHit(kind, sweetZone.min - 0.01)).toBe(false);
    expect(isSwingSweetHit(kind, sweetZone.max + 0.01)).toBe(false);
  });
});

describe.each(["chop", "mine"] as const)("gradeSwing (%s)", (kind) => {
  const { sweepMs, sweetZone } = SWING_PROFILES[kind];

  it("grades a press against the meter's value at that instant", () => {
    const midSweep = sweepMs * ((sweetZone.min + sweetZone.max) / 2);
    const { value, sweet } = gradeSwing(kind, midSweep);
    expect(sweet).toBe(true);
    expect(value).toBeGreaterThanOrEqual(sweetZone.min);
    expect(value).toBeLessThanOrEqual(sweetZone.max);
  });

  it("never sweet-grades a press right at the start of a swing", () => {
    expect(gradeSwing(kind, 0).sweet).toBe(false);
  });

  it("treats a negative timestamp the same as pressing immediately", () => {
    expect(gradeSwing(kind, -50)).toEqual(gradeSwing(kind, 0));
  });
});

describe("SWING_PROFILES", () => {
  it("tunes mining a little tighter than chopping, on purpose", () => {
    const chop = SWING_PROFILES.chop;
    const mine = SWING_PROFILES.mine;
    const chopWidth = chop.sweetZone.max - chop.sweetZone.min;
    const mineWidth = mine.sweetZone.max - mine.sweetZone.min;
    expect(mineWidth).toBeLessThan(chopWidth);
  });
});
