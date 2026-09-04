import { describe, expect, it } from "vitest";
import { STACKACRES_ITEMS, STACKACRES_ITEM_CATALOGUE } from "./items";
import {
  MUSEUM_EXHIBITS,
  MUSEUM_EXHIBIT_CATALOGUE,
  emptyMuseumRegistry,
  exhibitForItem,
  isMuseumExhibit,
  museumDiscoveryBonus,
} from "./museum";

describe("exhibit groupings", () => {
  it("places every produce item in exactly one exhibit", () => {
    const seen = new Set<string>();
    for (const exhibitId of MUSEUM_EXHIBITS) {
      for (const item of MUSEUM_EXHIBIT_CATALOGUE[exhibitId].items) {
        expect(seen.has(item)).toBe(false);
        seen.add(item);
      }
    }
    expect([...seen].sort()).toEqual([...STACKACRES_ITEMS].sort());
  });

  it("agrees with itself: an item's exhibit actually lists it", () => {
    for (const item of STACKACRES_ITEMS) {
      const exhibitId = exhibitForItem(item);
      expect(MUSEUM_EXHIBIT_CATALOGUE[exhibitId].items).toContain(item);
    }
  });

  it("recognises its own exhibit ids and nothing else", () => {
    for (const exhibitId of MUSEUM_EXHIBITS) expect(isMuseumExhibit(exhibitId)).toBe(true);
    expect(isMuseumExhibit("not-a-real-exhibit")).toBe(false);
  });
});

describe("a fresh registry", () => {
  it("starts with nothing donated", () => {
    const registry = emptyMuseumRegistry();
    for (const item of STACKACRES_ITEMS) expect(registry[item]).toBe(false);
  });
});

describe("the discovery bonus", () => {
  it("is half of what the harvest is worth in Gold, rounded", () => {
    for (const item of STACKACRES_ITEMS) {
      const goldValue = STACKACRES_ITEM_CATALOGUE[item].goldValue;
      expect(museumDiscoveryBonus(item, 4)).toBe(Math.round(goldValue * 4 * 0.5));
    }
  });

  it("scales with quantity, the same way the harvest ledger's own payout does", () => {
    expect(museumDiscoveryBonus("carrot", 6)).toBe(museumDiscoveryBonus("carrot", 3) * 2);
  });
});
