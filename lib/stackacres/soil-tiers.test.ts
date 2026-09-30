import { describe, expect, it } from "vitest";

import {
  SOIL_DEFAULT_TIER,
  SOIL_TIERS,
  isSoilTier,
  toSoilTier,
} from "./soil-tiers";

describe("soil tiers", () => {
  // Enriched Substrate and Hydro Soil were retired. If either comes back it
  // should be a deliberate change to this list, not a side effect.
  it("has one tier: plain dirt", () => {
    expect([...SOIL_TIERS]).toEqual(["dirt"]);
  });

  it("defaults to dirt", () => {
    expect(SOIL_DEFAULT_TIER).toBe("dirt");
  });

  // Degrades, never throws: an unknown tier is still a bed with crops on it.
  it("reads an unknown stored tier as the default rather than throwing", () => {
    expect(toSoilTier("enriched")).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier("hydro")).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier("gold-plated")).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier(null)).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier(undefined)).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier(7)).toBe(SOIL_DEFAULT_TIER);
    expect(isSoilTier("dirt")).toBe(true);
    expect(isSoilTier("mud")).toBe(false);
  });
});
