import { describe, expect, it } from "vitest";

import {
  blendTints,
  bedIsWet,
  ENRICHED_SOIL_TINT,
  NO_TINT,
  soilTint,
  WET_SOIL_TINT,
} from "./soil-moisture";

describe("soil moisture", () => {
  it("a thirsty crop, a withered one and a bare bed all read dry", () => {
    expect(bedIsWet(null)).toBe(false);
    expect(bedIsWet({ state: "dry" })).toBe(false);
    expect(bedIsWet({ state: "mucked" })).toBe(false);
  });

  it("a growing crop, a ripe one and livestock read wet", () => {
    expect(bedIsWet({ state: "working" })).toBe(true);
    expect(bedIsWet({ state: "ready" })).toBe(true);
    expect(bedIsWet({ state: "hungry" })).toBe(true);
  });

  it("blending against no tint leaves the other one exactly", () => {
    expect(blendTints(NO_TINT, WET_SOIL_TINT)).toBe(WET_SOIL_TINT);
    expect(blendTints(ENRICHED_SOIL_TINT, NO_TINT)).toBe(ENRICHED_SOIL_TINT);
    expect(blendTints(NO_TINT, NO_TINT)).toBe(NO_TINT);
  });

  it("blending darkens every channel and stays inside one colour", () => {
    const blended = blendTints(ENRICHED_SOIL_TINT, WET_SOIL_TINT);
    expect(blended).toBeGreaterThanOrEqual(0);
    expect(blended).toBeLessThanOrEqual(0xffffff);
    for (const shift of [16, 8, 0]) {
      const channel = (blended >> shift) & 0xff;
      expect(channel).toBeLessThan((ENRICHED_SOIL_TINT >> shift) & 0xff);
    }
  });

  it("dry ground is drawn as painted, wet ground darker", () => {
    expect(soilTint({ enriched: false, wet: false })).toBe(NO_TINT);
    expect(soilTint({ enriched: false, wet: true })).toBe(WET_SOIL_TINT);
    expect(soilTint({ enriched: true, wet: false })).toBe(ENRICHED_SOIL_TINT);
  });

  it("a watered bean bed keeps its green and still darkens", () => {
    const wetEnriched = soilTint({ enriched: true, wet: true });
    expect(wetEnriched).not.toBe(ENRICHED_SOIL_TINT);
    expect(wetEnriched).toBe(blendTints(ENRICHED_SOIL_TINT, WET_SOIL_TINT));
    // Still the greener of the two wet looks: enrichment survives the soak.
    const green = (value: number) => ((value >> 8) & 0xff) - (value & 0xff);
    expect(green(wetEnriched)).toBeGreaterThan(green(WET_SOIL_TINT));
  });
});
