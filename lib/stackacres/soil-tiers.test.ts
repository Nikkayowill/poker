import { describe, expect, it } from "vitest";

import {
  SOIL_DEFAULT_TIER,
  SOIL_TIERS,
  SOIL_TIER_DEFS,
  isSoilTier,
  soilTierDef,
  soilTierPrice,
  toSoilTier,
} from "./soil-tiers";
import { SOIL_BAG_PRICE_GOLD } from "./soil";

describe("soil tiers", () => {
  it("defines every tier in the union, and nothing else", () => {
    expect(Object.keys(SOIL_TIER_DEFS).sort()).toEqual([...SOIL_TIERS].sort());
  });

  // Enriched Substrate and Hydro Soil were retired. If either comes back it
  // should be a deliberate change to this list, not a side effect.
  it("sells one bag: plain dirt", () => {
    expect([...SOIL_TIERS]).toEqual(["dirt"]);
  });

  it("prices the default tier at the historical flat bed price", () => {
    expect(SOIL_DEFAULT_TIER).toBe("dirt");
    expect(soilTierPrice(SOIL_DEFAULT_TIER)).toBe(SOIL_BAG_PRICE_GOLD);
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

  it("gives every tier its own label", () => {
    const labels = SOIL_TIERS.map((t) => soilTierDef(t).label);
    expect(new Set(labels).size).toBe(SOIL_TIERS.length);
  });
});
