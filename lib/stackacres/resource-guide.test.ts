import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CROSSBREED_ITEMS } from "./crossbreed-items";
import {
  GATHER_SOURCES,
  GUIDE_DESTINATION_LABELS,
  GUIDE_ITEM_IDS,
  isGatingUse,
  isObtainable,
  nonSellUses,
  resourceGuideEntry,
  resourceSources,
  resourceUses,
  type GuideItemId,
} from "./resource-guide";
import { RECIPE_CATALOGUE, RECIPE_IDS } from "./recipes";

const AREAS_DIR = join(process.cwd(), "public/stackacres-td/areas");

/** Every prop tag on every map, e.g. "tree:homestead-1". */
function mapTags(): string[] {
  const tags: string[] = [];
  for (const dir of readdirSync(AREAS_DIR)) {
    const file = join(AREAS_DIR, dir, "area.json");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/"tag":"([^"]+)"/g)) tags.push(match[1]);
  }
  return tags;
}

describe("every item has a guide entry", () => {
  it("has a description, an icon and at least one source", () => {
    for (const item of GUIDE_ITEM_IDS) {
      const entry = resourceGuideEntry(item);
      expect(entry.description.length, item).toBeGreaterThan(0);
      expect(entry.icon, item).toMatch(/^ico-/);
      expect(entry.sources.length, `${item} has no source`).toBeGreaterThan(0);
    }
  });

  it("lists each item once", () => {
    expect(new Set(GUIDE_ITEM_IDS).size).toBe(GUIDE_ITEM_IDS.length);
  });

  it("covers every hybrid", () => {
    for (const item of CROSSBREED_ITEMS) expect(GUIDE_ITEM_IDS).toContain(item);
  });

  it("points every use and source at a destination the farm can open", () => {
    for (const item of GUIDE_ITEM_IDS) {
      const entry = resourceGuideEntry(item);
      for (const row of [...entry.uses, ...entry.sources]) {
        if (row.destination) expect(GUIDE_DESTINATION_LABELS, `${item}: ${row.label}`).toHaveProperty(row.destination);
      }
    }
  });
});

describe("nothing is sellable but useless", () => {
  it("gives every sellable item a use besides selling it", () => {
    const useless = GUIDE_ITEM_IDS.filter((item) => resourceGuideEntry(item).sellPrice !== null && nonSellUses(item).length === 0);
    expect(useless).toEqual([]);
  });

  it("gives every hybrid a use, even though none can be sold", () => {
    for (const item of CROSSBREED_ITEMS) {
      expect(resourceGuideEntry(item).sellPrice).toBeNull();
      expect(nonSellUses(item).length, item).toBeGreaterThan(0);
    }
  });

  it("keeps the at-risk items off the list", () => {
    const atRisk: GuideItemId[] = ["bluegill", "trout", "catfish", "meat", "pelt", "cheese", "cloth", "wood", "stone", ...CROSSBREED_ITEMS];
    for (const item of atRisk) expect(nonSellUses(item).length, item).toBeGreaterThan(0);
  });

  it("lists every recipe that takes an item among that item's uses", () => {
    for (const id of RECIPE_IDS) {
      for (const input of RECIPE_CATALOGUE[id].inputs) {
        const recipes = resourceUses(input.item)
          .filter((use) => use.kind === "recipe")
          .map((use) => use.recipe);
        expect(recipes, `${input.item} -> ${id}`).toContain(id);
      }
    }
  });
});

describe("gathering sources match the maps", () => {
  const tags = mapTags();

  it("has trees on a map exactly when wood is open", () => {
    expect(tags.some((tag) => tag.startsWith("tree:"))).toBe(GATHER_SOURCES.wood.open);
  });

  it("has boulders on a map exactly when stone is open", () => {
    expect(tags.some((tag) => tag.startsWith("stone:"))).toBe(GATHER_SOURCES.stone.open);
  });

  it("has a thicket on a map exactly when hunting is open", () => {
    expect(tags.some((tag) => tag.startsWith("thicket"))).toBe(GATHER_SOURCES.hunting.open);
  });
});

/**
 * Things a player must hand over that cannot be got on the live farm today.
 *
 * This is the list as found on 2026-09-30, not a list of things that are fine.
 * Sheep and cattle have no open pen and no map has boulders, so the chain from
 * wool, milk and ore is shut. The test fails both ways: a new requirement on
 * one of these items fails it, and so does opening a source, until the entry
 * is deleted.
 */
const KNOWN_BLOCKED_REQUIREMENTS = [
  "wool: Cloth at the Loom",
  "milk: Cheese at the Dairy",
  "milk: Cake at the Dairy",
  "stone: Build the Feed Silo",
  "stone: Build the Preserves Cellar",
  "stone: Build the Smelter",
  "stone: Make the Steel Axe",
  "iron_ore: Metal at the Smelter",
  "cheese: Mythic Ember Spire: Framework",
  "cheese: Mythic Ember Spire: Spire Crown",
  "cheese: Town orders",
  "cheese: Age it in the Fermenting Vat",
  "cloth: Mythic Ember Spire: Spire Crown",
  "cloth: Town orders",
  "metal: Raise the Barn in the Far Field",
];

describe("nothing is required before its source is open", () => {
  it("only asks for unobtainable items where it already did", () => {
    const found: string[] = [];
    for (const item of GUIDE_ITEM_IDS) {
      if (isObtainable(item)) continue;
      for (const use of resourceUses(item)) {
        if (isGatingUse(use)) found.push(`${item}: ${use.label}`);
      }
    }
    expect(found.sort()).toEqual([...KNOWN_BLOCKED_REQUIREMENTS].sort());
  });

  it("follows a crafted item back to its raw inputs", () => {
    // Cheese has an open recipe, but it needs milk and milk needs a cattle pen.
    expect(resourceSources("cheese").every((source) => source.open)).toBe(true);
    expect(isObtainable("cheese")).toBe(false);
    expect(isObtainable("flour")).toBe(true);
    expect(isObtainable("wood")).toBe(true);
    expect(isObtainable("trout")).toBe(true);
  });
});
