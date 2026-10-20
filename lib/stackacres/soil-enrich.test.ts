import { describe, expect, it } from "vitest";

import {
  ENRICHED_GROWTH_MULTIPLIER,
  enrichedGrowthMultiplier,
  enrichesSoil,
  isSoilEnrichingItem,
  isSoilTileEnriched,
} from "./soil-enrich";

describe("soil enrichment", () => {
  it("only beans enrich", () => {
    expect(enrichesSoil("green_bean")).toBe(true);
    expect(enrichesSoil("carrot")).toBe(false);
    expect(enrichesSoil("onion")).toBe(false);
    expect(isSoilEnrichingItem("green_bean")).toBe(true);
    expect(isSoilEnrichingItem("carrot")).toBe(false);
  });

  it("an enriched bed grows the next crop in 75% of the time", () => {
    expect(ENRICHED_GROWTH_MULTIPLIER).toBe(0.75);
    expect(enrichedGrowthMultiplier(true)).toBe(0.75);
    expect(enrichedGrowthMultiplier(false)).toBe(1);
    expect(Math.round(60_000 * enrichedGrowthMultiplier(true))).toBe(45_000);
  });

  it("an absent flag reads as a plain bed", () => {
    expect(isSoilTileEnriched({})).toBe(false);
    expect(isSoilTileEnriched({ enriched: true })).toBe(true);
  });
});
