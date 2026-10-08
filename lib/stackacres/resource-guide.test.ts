import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LAND_OBSTACLES } from "./land-clearing";
import { describe, expect, it } from "vitest";
import {
  GATHER_SOURCES,
  GUIDE_DESTINATION_LABELS,
  GUIDE_ITEM_IDS,
  isObtainable,
  resourceGuideEntry,
  resourceSources,
  resourceUses,
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

  it("offers no sale for what the farm builds with, since nobody in town buys it", () => {
    for (const item of ["stone", "iron_ore", "metal"] as const) {
      expect(resourceUses(item).some((use) => use.kind === "sell"), item).toBe(false);
    }
    expect(resourceUses("wood").some((use) => use.kind === "sell")).toBe(true);
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

  it("has boulders to break exactly when stone is open", () => {
    // The wild land's boulders are obstacles, not map tags (lib/stackacres/land-clearing.ts).
    const breakable = LAND_OBSTACLES.cropfields.some((obstacle) => obstacle.kind === "boulder");
    expect(breakable).toBe(GATHER_SOURCES.stone.open);
  });

  it("has a thicket on a map exactly when hunting is open", () => {
    expect(tags.some((tag) => tag.startsWith("thicket"))).toBe(GATHER_SOURCES.hunting.open);
  });
});

describe("nothing is required before its source is open", () => {

  it("follows a crafted item back to its raw inputs", () => {
    // Cheese needs milk, and milk needs a Cattle Pen from the Store.
    expect(resourceSources("cheese").every((source) => source.open)).toBe(true);
    expect(isObtainable("cheese")).toBe(true);
    expect(isObtainable("flour")).toBe(true);
    expect(isObtainable("wood")).toBe(true);
    expect(isObtainable("trout")).toBe(true);
  });
});
