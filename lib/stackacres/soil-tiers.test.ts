import { describe, expect, it } from "vitest";

import {
  SOIL_DEFAULT_TIER,
  SOIL_TIERS,
  SOIL_TIER_DEFS,
  isSoilTier,
  soilGrowthMultiplier,
  soilSelfHydrates,
  soilTierDef,
  soilTierPrice,
  toSoilTier,
} from "./soil-tiers";
import { SOIL_TILE_PRICE_GOLD } from "./soil";

describe("soil tiers", () => {
  it("defines every tier in the union, and nothing else", () => {
    expect(Object.keys(SOIL_TIER_DEFS).sort()).toEqual([...SOIL_TIERS].sort());
  });

  // The bound the doc comment states. A multiplier above 1 would sell a
  // player a SLOWER bed, and a zero would make a crop ready in the tick it
  // was sown -- `growthStage` divides by the span, so that reads as NaN.
  it("keeps every growth multiplier in (0, 1]", () => {
    for (const tier of SOIL_TIERS) {
      const m = soilGrowthMultiplier(tier);
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  // The cheapest bed must stay exactly what a bed already cost, or tiering
  // the shop silently reprices the one every existing player knows.
  it("prices the default tier at the historical flat bed price", () => {
    expect(SOIL_DEFAULT_TIER).toBe("dirt");
    expect(soilTierPrice(SOIL_DEFAULT_TIER)).toBe(SOIL_TILE_PRICE_GOLD);
    expect(soilGrowthMultiplier(SOIL_DEFAULT_TIER)).toBe(1);
    expect(soilSelfHydrates(SOIL_DEFAULT_TIER)).toBe(false);
  });

  // A tier that costs more must actually do more, or the ladder is a trap.
  it("never charges more for a strictly worse bed", () => {
    for (const tier of SOIL_TIERS) {
      if (tier === SOIL_DEFAULT_TIER) continue;
      const def = soilTierDef(tier);
      const better =
        def.growthMultiplier < soilGrowthMultiplier(SOIL_DEFAULT_TIER) || def.selfHydrating;
      expect(better).toBe(true);
      expect(def.price).toBeGreaterThan(soilTierPrice(SOIL_DEFAULT_TIER));
    }
  });

  // Degrades, never throws: an unknown tier is still a bed with crops on it.
  it("reads an unknown stored tier as the default rather than throwing", () => {
    expect(toSoilTier("enriched")).toBe("enriched");
    expect(toSoilTier("gold-plated")).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier(null)).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier(undefined)).toBe(SOIL_DEFAULT_TIER);
    expect(toSoilTier(7)).toBe(SOIL_DEFAULT_TIER);
    expect(isSoilTier("dirt")).toBe(true);
    expect(isSoilTier("mud")).toBe(false);
  });

  // Every tier has to be TELLABLE APART on the farm, or the player cannot
  // see what they bought. One shared bed texture makes the tint the only
  // signal, so the tints must be distinct and only the plain bed untinted.
  it("gives every tier its own label and a distinguishable bed", () => {
    const labels = SOIL_TIERS.map((t) => soilTierDef(t).label);
    expect(new Set(labels).size).toBe(SOIL_TIERS.length);

    const tints = SOIL_TIERS.map((t) => soilTierDef(t).tint);
    expect(new Set(tints).size).toBe(SOIL_TIERS.length);
    expect(soilTierDef(SOIL_DEFAULT_TIER).tint).toBeNull();
    for (const tier of SOIL_TIERS) {
      const tint = soilTierDef(tier).tint;
      if (tier === SOIL_DEFAULT_TIER) continue;
      expect(tint).not.toBeNull();
      // A real 24-bit colour, not a stray 0 or a CSS string.
      expect(tint).toBeGreaterThan(0);
      expect(tint).toBeLessThanOrEqual(0xffffff);
    }
  });
});
