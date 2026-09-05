import { describe, expect, it } from "vitest";
import {
  FORGE_ENCHANTMENTS,
  canAffordForge,
  computeForgedToolStats,
  forgeEnchantmentItemId,
  forgeMaterialStatus,
  isForgeEnchantmentId,
  type ForgeBaseStats,
} from "./forge";
import { emptyInventory, addToInventory, type StackAcresInventory } from "./inventory";

const BASE: ForgeBaseStats = {
  critChance: 0.12,
  critBonus: 0.75,
  reach: 20,
};

describe("forgeEnchantmentItemId", () => {
  it("versions the item_id so a rebalance never reinterprets a paid-for v1", () => {
    expect(forgeEnchantmentItemId("sunwoven_edge")).toBe("enchant_sunwoven_edge_v1");
    expect(forgeEnchantmentItemId("sunwoven_edge", 2)).toBe("enchant_sunwoven_edge_v2");
  });
});

describe("isForgeEnchantmentId", () => {
  it("accepts every catalogued id and rejects an unknown one", () => {
    for (const id of Object.keys(FORGE_ENCHANTMENTS)) expect(isForgeEnchantmentId(id)).toBe(true);
    expect(isForgeEnchantmentId("enchant_does_not_exist")).toBe(false);
  });
});

describe("computeForgedToolStats", () => {
  it("is a no-op with no applied enchantments", () => {
    expect(computeForgedToolStats(BASE, [])).toEqual({ ...BASE, appliedEnchantmentIds: [] });
  });

  it("adds Sunwoven Edge's flat crit-chance bonus", () => {
    const result = computeForgedToolStats(BASE, ["sunwoven_edge"]);
    expect(result.critChance).toBeCloseTo(0.2, 10); // 0.12 + 0.08
    expect(result.critBonus).toBe(BASE.critBonus);
    expect(result.appliedEnchantmentIds).toEqual(["sunwoven_edge"]);
  });

  it("adds Gilded Bounty's flat crit-bonus increase, leaving chance untouched", () => {
    const result = computeForgedToolStats(BASE, ["gilded_bounty"]);
    expect(result.critBonus).toBeCloseTo(1.25, 10); // 0.75 + 0.5
    expect(result.critChance).toBe(BASE.critChance);
  });

  it("multiplies reach by Quickened Haft rather than adding to it", () => {
    const result = computeForgedToolStats(BASE, ["quickened_haft"]);
    expect(result.reach).toBeCloseTo(24, 10); // 20 * 1.2
  });

  it("stacks all three enchantments together, each on its own stat", () => {
    const result = computeForgedToolStats(BASE, [
      "sunwoven_edge",
      "gilded_bounty",
      "quickened_haft",
    ]);
    expect(result.critChance).toBeCloseTo(0.2, 10);
    expect(result.critBonus).toBeCloseTo(1.25, 10);
    expect(result.reach).toBeCloseTo(24, 10);
    expect(result.appliedEnchantmentIds).toHaveLength(3);
  });

  it("clamps crit chance at 1 rather than letting it overflow", () => {
    const hot: ForgeBaseStats = { ...BASE, critChance: 0.98 };
    const result = computeForgedToolStats(hot, ["sunwoven_edge"]);
    expect(result.critChance).toBe(1);
  });

  it("never lets crit chance go negative, even from a hostile base", () => {
    const cursed: ForgeBaseStats = { ...BASE, critChance: -1 };
    const result = computeForgedToolStats(cursed, []);
    expect(result.critChance).toBe(0);
  });

  it("ignores an unknown or stale enchantment id rather than throwing", () => {
    const result = computeForgedToolStats(BASE, ["enchant_retired_v0"]);
    expect(result).toEqual({ ...BASE, appliedEnchantmentIds: [] });
  });

  it("de-duplicates a repeated id so it cannot apply twice", () => {
    const result = computeForgedToolStats(BASE, ["sunwoven_edge", "sunwoven_edge"]);
    expect(result.critChance).toBeCloseTo(0.2, 10);
    expect(result.appliedEnchantmentIds).toEqual(["sunwoven_edge"]);
  });

  it("has a positive Gold cost, a real material and a catalogue id matching its own key for every entry", () => {
    for (const [key, def] of Object.entries(FORGE_ENCHANTMENTS)) {
      expect(def.id).toBe(key);
      expect(def.goldCost).toBeGreaterThanOrEqual(0);
      expect(def.materialQuantity).toBeGreaterThan(0);
    }
  });
});

describe("forgeMaterialStatus", () => {
  const def = FORGE_ENCHANTMENTS.sunwoven_edge;

  it("reports short when the shelf has nothing", () => {
    const status = forgeMaterialStatus(def, emptyInventory());
    expect(status).toEqual({ item: def.materialItem, required: def.materialQuantity, held: 0, met: false });
  });

  it("reports met once the shelf has enough", () => {
    const inventory = addToInventory(emptyInventory(), def.materialItem, def.materialQuantity);
    expect(forgeMaterialStatus(def, inventory).met).toBe(true);
  });

  it("reports met with more than enough on the shelf, not just exactly enough", () => {
    const inventory = addToInventory(emptyInventory(), def.materialItem, def.materialQuantity + 100);
    expect(forgeMaterialStatus(def, inventory).met).toBe(true);
  });
});

describe("canAffordForge", () => {
  const def = FORGE_ENCHANTMENTS.sunwoven_edge;
  const fullShelf: StackAcresInventory = addToInventory(
    emptyInventory(),
    def.materialItem,
    def.materialQuantity,
  );

  it("requires both Gold and material -- Gold alone is not enough", () => {
    expect(canAffordForge(def, def.goldCost, emptyInventory())).toBe(false);
  });

  it("requires both Gold and material -- material alone is not enough", () => {
    expect(canAffordForge(def, 0, fullShelf)).toBe(false);
  });

  it("affords the purchase once both are met", () => {
    expect(canAffordForge(def, def.goldCost, fullShelf)).toBe(true);
  });
});
