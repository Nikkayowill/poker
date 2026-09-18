import { describe, expect, it } from "vitest";
import { missingLine, otherUsesOf, recipeIngredients, recipesUsing, wantedForLine } from "./recipe-uses";
import { RECIPE_CATALOGUE } from "./recipes";
import { MACHINE_CAP, MACHINE_CATALOGUE, MACHINE_KINDS } from "./machines";
import { FOOD_ENERGY, isFoodItem } from "./energy";
import { machineItemSellPrice } from "./machine-items";

describe("the Hearty Stew recipe", () => {
  it("is 2 Potato, 2 Carrot and 1 Onion in the Stew Pot, instant, for 1 Stew", () => {
    expect(RECIPE_CATALOGUE.stew).toMatchObject({
      label: "Hearty Stew",
      machine: "stew_pot",
      inputs: [
        { item: "potato", quantity: 2 },
        { item: "carrot", quantity: 2 },
        { item: "onion", quantity: 1 },
      ],
      output: { item: "stew", quantity: 1 },
      processingMs: 0,
    });
  });

  it("makes Stew a 30 Gold food worth 50 energy", () => {
    expect(machineItemSellPrice("stew")).toBe(30);
    expect(isFoodItem("stew")).toBe(true);
    expect(FOOD_ENERGY.stew).toBe(50);
  });

  it("grows the machine cap to 6 with the Stew Pot", () => {
    expect(MACHINE_KINDS).toContain("stew_pot");
    expect(MACHINE_CAP).toBeGreaterThanOrEqual(6);
  });
});

describe("the Garden Salad recipe", () => {
  it("is 2 Lettuce, 1 Spinach and 1 Radish on the Kitchen Counter, instant, for 1 Salad", () => {
    expect(RECIPE_CATALOGUE.salad).toMatchObject({
      label: "Garden Salad",
      machine: "counter",
      inputs: [
        { item: "lettuce", quantity: 2 },
        { item: "spinach", quantity: 1 },
        { item: "radish", quantity: 1 },
      ],
      output: { item: "salad", quantity: 1 },
      processingMs: 0,
    });
  });

  it("makes Salad a 12 Gold food worth 15 energy", () => {
    expect(machineItemSellPrice("salad")).toBe(12);
    expect(isFoodItem("salad")).toBe(true);
    expect(FOOD_ENERGY.salad).toBe(15);
  });

  it("adds the Kitchen Counter at 800 Gold", () => {
    expect(MACHINE_KINDS).toContain("counter");
    expect(MACHINE_CATALOGUE.counter.placeCost).toBe(800);
  });
});

describe("wantedForLine", () => {
  it("names the recipes that use a crop", () => {
    expect(recipesUsing("potato")).toEqual(["stew"]);
    expect(wantedForLine("potato")).toBe("For: Hearty Stew");
    expect(wantedForLine("onion")).toBe("For: Hearty Stew");
  });

  it("lists every recipe when more than one wants the item", () => {
    expect(wantedForLine("flour")).toBe("For: Cake, Bread");
  });

  it("says nothing for a crop nothing uses", () => {
    expect(recipesUsing("celery")).toEqual([]);
    expect(wantedForLine("celery")).toBeNull();
  });

  it("lists hen feed and fishing bait beside the recipes", () => {
    expect(otherUsesOf("spinach")).toEqual(["Hen feed (+1 egg)"]);
    expect(wantedForLine("spinach")).toBe("For: Garden Salad, Hen feed (+1 egg)");
    expect(wantedForLine("lettuce")).toBe("For: Garden Salad, Hen feed");
    expect(wantedForLine("cabbage")).toBe("For: Hen feed");
    expect(wantedForLine("wheat")).toBe("For: Flour, Hen feed");
    expect(wantedForLine("radish")).toBe("For: Garden Salad, Fishing bait");
    expect(wantedForLine("corn")).toBe("For: Cattle feed (at the Mill)");
    expect(otherUsesOf("cattle_feed")).toEqual(["Cattle feed"]);
  });

  it("tags beans as a soil helper", () => {
    expect(otherUsesOf("green_bean")).toContain("Soil helper (next crop grows faster)");
    expect(wantedForLine("green_bean")).toContain("Soil helper (next crop grows faster)");
  });
});

describe("recipeIngredients", () => {
  it("shows what is held and what is still missing", () => {
    const rows = recipeIngredients("stew", { potato: 5, carrot: 1 });
    expect(rows).toEqual([
      { item: "potato", need: 2, have: 5, missing: 0 },
      { item: "carrot", need: 2, have: 1, missing: 1 },
      { item: "onion", need: 1, have: 0, missing: 1 },
    ]);
    expect(rows.map(missingLine)).toEqual([null, "Need 1 more Carrot", "Need 1 more Onion"]);
  });

  it("pluralises a bigger shortfall", () => {
    expect(missingLine(recipeIngredients("stew", {})[0])).toBe("Need 2 more Potatoes");
  });
});

describe("the Cattle Feed recipe", () => {
  it("is 1 Corn in the Mill, queued like Flour, for 4 Cattle Feed worth more than the corn", () => {
    expect(RECIPE_CATALOGUE.cattle_feed).toMatchObject({
      label: "Cattle Feed",
      machine: "mill",
      inputs: [{ item: "corn", quantity: 1 }],
      output: { item: "cattle_feed", quantity: 4 },
      processingMs: RECIPE_CATALOGUE.flour.processingMs,
    });
    expect(machineItemSellPrice("cattle_feed")).toBe(12);
    expect(4 * machineItemSellPrice("cattle_feed")).toBeGreaterThan(machineItemSellPrice("corn"));
  });

  it("puts the Feed Silo on the machine list for 12,000 Gold, one of eight", () => {
    expect(MACHINE_CATALOGUE.feed_silo.placeCost).toBe(12_000);
    expect(MACHINE_CAP).toBe(8);
    expect(MACHINE_KINDS).toHaveLength(MACHINE_CAP);
  });
});
