import { describe, expect, it } from "vitest";
import {
  UNBUILT_CUTTERS,
  UNBUILT_ENCHANTMENTS,
  UNBUILT_MERCHANT_ITEMS,
  UNBUILT_PERKS,
  isUnbuiltCutter,
  isUnbuiltEnchantment,
  isUnbuiltPerk,
} from "./unbuilt";
import { STACKACRES_CUTTERS } from "./cutters";
import { FORGE_ENCHANTMENTS } from "./forge";
import { SYNERGY_ARCHETYPES } from "./synergy-perks";
import { MIDNIGHT_MERCHANT_ITEM_IDS } from "./midnight-merchant";

/**
 * Every id here has to match the catalogue it hides from. A typo would read
 * as "nothing to hide" and quietly put an inert purchase back on the shelf,
 * which is the exact thing this list exists to prevent.
 */
describe("unbuilt ids match their catalogues", () => {
  it("names real cutters", () => {
    for (const id of UNBUILT_CUTTERS) expect(STACKACRES_CUTTERS).toContain(id);
  });

  it("names real perks", () => {
    for (const id of UNBUILT_PERKS) expect(SYNERGY_ARCHETYPES).toContain(id);
  });

  it("names real enchantments", () => {
    for (const id of UNBUILT_ENCHANTMENTS) expect(Object.keys(FORGE_ENCHANTMENTS)).toContain(id);
  });

  it("names real merchant items", () => {
    for (const id of UNBUILT_MERCHANT_ITEMS) expect(MIDNIGHT_MERCHANT_ITEM_IDS).toContain(id);
  });
});

describe("the predicates", () => {
  it("answer for the ids that are listed", () => {
    expect(isUnbuiltCutter("mower")).toBe(true);
    expect(isUnbuiltPerk("automated_logistics")).toBe(true);
    expect(isUnbuiltEnchantment("quickened_haft")).toBe(true);
  });

  it("leave everything else alone", () => {
    expect(isUnbuiltPerk("sunlight_harvester")).toBe(false);
    expect(isUnbuiltEnchantment("sunwoven_edge")).toBe(false);
    expect(isUnbuiltEnchantment("gilded_bounty")).toBe(false);
  });

  it("leaves at least one perk and two enchantments still buyable", () => {
    expect(SYNERGY_ARCHETYPES.filter((id) => !isUnbuiltPerk(id)).length).toBeGreaterThan(0);
    expect(
      Object.keys(FORGE_ENCHANTMENTS).filter((id) => !isUnbuiltEnchantment(id)),
    ).toHaveLength(2);
  });
});
