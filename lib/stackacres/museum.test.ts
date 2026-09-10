import { describe, expect, it } from "vitest";
import { STACKACRES_ITEMS } from "./items";
import {
  MUSEUM_DISCOVERY_BONUS_RATE,
  MUSEUM_EXHIBITS,
  MUSEUM_EXHIBIT_CATALOGUE,
  emptyMuseumRegistry,
  exhibitForItem,
  isMuseumExhibit,
  museumDiscoveryBonusQuantity,
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
  it("is half again the units the sweep brought home, rounded", () => {
    expect(MUSEUM_DISCOVERY_BONUS_RATE).toBe(0.5);
    expect(museumDiscoveryBonusQuantity(4)).toBe(2);
    expect(museumDiscoveryBonusQuantity(8)).toBe(4);
    expect(museumDiscoveryBonusQuantity(3)).toBe(Math.round(3 * 0.5));
  });

  it("scales with quantity and is nothing for nothing", () => {
    expect(museumDiscoveryBonusQuantity(12)).toBe(museumDiscoveryBonusQuantity(6) * 2);
    expect(museumDiscoveryBonusQuantity(0)).toBe(0);
  });
});
