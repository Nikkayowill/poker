import { describe, expect, it } from "vitest";
import {
  SYNERGY_ARCHETYPES,
  SYNERGY_PERKS,
  applySynergyEffects,
  isSynergyArchetype,
  synergyPerkItemId,
  type StackAcresBaseStats,
} from "./synergy-perks";

const BASE: StackAcresBaseStats = {
  harvestCritChance: 0.12,
  farmhandSpeed: 20,
  millDoubleOutputChance: 0,
};

describe("synergyPerkItemId", () => {
  it("versions the item_id so a rebalance never reinterprets a paid-for v1", () => {
    expect(synergyPerkItemId("sunlight_harvester")).toBe("perk_sunlight_harvester_v1");
    expect(synergyPerkItemId("sunlight_harvester", 2)).toBe("perk_sunlight_harvester_v2");
  });
});

describe("isSynergyArchetype", () => {
  it("accepts every catalogued id and rejects an unknown one", () => {
    for (const id of SYNERGY_ARCHETYPES) expect(isSynergyArchetype(id)).toBe(true);
    expect(isSynergyArchetype("perk_does_not_exist")).toBe(false);
  });
});

describe("applySynergyEffects", () => {
  it("is a no-op with no active perks", () => {
    expect(applySynergyEffects(BASE, [])).toEqual({ ...BASE, appliedPerkIds: [] });
  });

  it("adds Sunlight Harvester's flat crit bonus", () => {
    const result = applySynergyEffects(BASE, ["sunlight_harvester"]);
    expect(result.harvestCritChance).toBeCloseTo(0.17, 10);
    expect(result.farmhandSpeed).toBe(BASE.farmhandSpeed);
    expect(result.appliedPerkIds).toEqual(["sunlight_harvester"]);
  });

  it("multiplies farmhand speed by Automated Logistics rather than adding to it", () => {
    const result = applySynergyEffects(BASE, ["automated_logistics"]);
    expect(result.farmhandSpeed).toBeCloseTo(23, 10); // 20 * 1.15
  });

  it("adds High-Yield Processing's double-output chance", () => {
    const result = applySynergyEffects(BASE, ["high_yield_processing"]);
    expect(result.millDoubleOutputChance).toBeCloseTo(0.1, 10);
  });

  it("stacks all three archetypes together, each on its own stat", () => {
    const result = applySynergyEffects(BASE, [
      "sunlight_harvester",
      "automated_logistics",
      "high_yield_processing",
    ]);
    expect(result.harvestCritChance).toBeCloseTo(0.17, 10);
    expect(result.farmhandSpeed).toBeCloseTo(23, 10);
    expect(result.millDoubleOutputChance).toBeCloseTo(0.1, 10);
    expect(result.appliedPerkIds).toHaveLength(3);
  });

  it("clamps a chance at 1 rather than letting it overflow", () => {
    const hot: StackAcresBaseStats = { ...BASE, harvestCritChance: 0.98 };
    const result = applySynergyEffects(hot, ["sunlight_harvester"]);
    expect(result.harvestCritChance).toBe(1);
  });

  it("ignores an unknown or stale perk_id rather than throwing", () => {
    const result = applySynergyEffects(BASE, ["perk_retired_v0"]);
    expect(result).toEqual({ ...BASE, appliedPerkIds: [] });
  });

  it("de-duplicates a repeated id so it cannot apply twice", () => {
    const result = applySynergyEffects(BASE, ["sunlight_harvester", "sunlight_harvester"]);
    expect(result.harvestCritChance).toBeCloseTo(0.17, 10);
    expect(result.appliedPerkIds).toEqual(["sunlight_harvester"]);
  });

  it("has an unlock cost for every archetype and no orphaned catalogue entry", () => {
    for (const id of SYNERGY_ARCHETYPES) {
      expect(SYNERGY_PERKS[id].unlockCostGold).toBeGreaterThan(0);
      expect(SYNERGY_PERKS[id].id).toBe(id);
    }
  });
});
