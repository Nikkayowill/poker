import { describe, expect, it } from "vitest";
import {
  INDOOR_DAY,
  INDOOR_NIGHT,
  NIGHT_FLOOR,
  brightness,
  daylightAt,
  hourOf,
  indoorDaylightAt,
  tintColor,
} from "./daylight";

describe("indoorDaylightAt", () => {
  it("is plain and bright by day, lamps barely on", () => {
    expect(indoorDaylightAt(12)).toEqual(INDOOR_DAY);
    expect(brightness(indoorDaylightAt(12))).toBeGreaterThan(0.95);
    expect(indoorDaylightAt(12).lamps).toBeLessThan(0.2);
  });

  it("is lamplit and dim at night, but still readable", () => {
    expect(indoorDaylightAt(0)).toEqual(INDOOR_NIGHT);
    expect(indoorDaylightAt(0).b).toBeGreaterThan(indoorDaylightAt(0).r);
    expect(indoorDaylightAt(0).lamps).toBe(1);
    expect(brightness(indoorDaylightAt(0))).toBeGreaterThan(NIGHT_FLOOR);
  });

  it("eases through dusk: dimmer and more lamplit as the evening goes on", () => {
    const dusk = [18, 19, 19.5, 20, 21].map(indoorDaylightAt);
    for (let i = 1; i < dusk.length; i++) {
      expect(brightness(dusk[i])).toBeLessThanOrEqual(brightness(dusk[i - 1]));
      expect(dusk[i].lamps).toBeGreaterThanOrEqual(dusk[i - 1].lamps);
    }
  });

  it("changes gradually and never drops under the readability floor", () => {
    for (let minute = 0; minute < 24 * 60; minute++) {
      const a = indoorDaylightAt(minute / 60);
      const b = indoorDaylightAt((minute + 1) / 60);
      expect(brightness(a)).toBeGreaterThanOrEqual(NIGHT_FLOOR);
      expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeLessThan(0.02);
      expect(Math.abs(a.lamps - b.lamps)).toBeLessThan(0.02);
    }
  });
});

describe("daylightAt", () => {
  it("leaves midday untouched, with the lamps out", () => {
    expect(daylightAt(12)).toEqual({ r: 1, g: 1, b: 1, lamps: 0 });
  });

  it("turns midnight blue and lights the lamps", () => {
    const night = daylightAt(0);
    expect(night.b).toBeGreaterThan(night.r);
    expect(night.lamps).toBe(1);
  });

  it("warms golden hour: less blue than green, less green than red", () => {
    const evening = daylightAt(18);
    expect(evening.r).toBeGreaterThan(evening.g);
    expect(evening.g).toBeGreaterThan(evening.b);
  });

  it("never gets darker than the readability floor", () => {
    for (let minute = 0; minute < 24 * 60; minute++) {
      expect(brightness(daylightAt(minute / 60))).toBeGreaterThanOrEqual(NIGHT_FLOOR);
    }
  });

  it("changes gradually: no minute jumps more than a sliver", () => {
    for (let minute = 0; minute < 24 * 60; minute++) {
      const a = daylightAt(minute / 60);
      const b = daylightAt((minute + 1) / 60);
      expect(Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)).toBeLessThan(0.02);
      expect(Math.abs(a.lamps - b.lamps)).toBeLessThan(0.02);
    }
  });

  it("wraps around midnight", () => {
    expect(daylightAt(24)).toEqual(daylightAt(0));
    expect(daylightAt(-1)).toEqual(daylightAt(23));
  });
});

describe("hourOf and tintColor", () => {
  it("reads a local clock as a fractional hour", () => {
    expect(hourOf(new Date(2026, 8, 16, 18, 30, 0))).toBe(18.5);
  });

  it("packs a tint as 0xRRGGBB", () => {
    expect(tintColor({ r: 1, g: 0.5, b: 0, lamps: 0 })).toBe(0xff8000);
  });
});
