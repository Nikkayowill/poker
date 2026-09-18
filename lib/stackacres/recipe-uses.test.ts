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
    expect(recipesUsing("potato")).toEqual(["stew", "stuffed_peppers"]);
    expect(wantedForLine("potato")).toBe("For: Hearty Stew, Stuffed Peppers");
    expect(wantedForLine("onion")).toBe("For: Hearty Stew, Tomato Sauce, Hot Salsa");
  });

  it("lists every recipe when more than one wants the item", () => {
    expect(wantedForLine("flour")).toBe("For: Cake, Bread");
  });

  it("says nothing for a crop nothing uses", () => {
    expect(recipesUsing("wheatsheaf")).toEqual([]);
    expect(wantedForLine("wheatsheaf")).toBeNull();
  });

  it("lists hen feed and fishing bait beside the recipes", () => {
    expect(otherUsesOf("spinach")).toEqual(["Hen feed (+1 egg)"]);
    expect(wantedForLine("spinach")).toBe("For: Garden Salad, Harvest Feast, Hen feed (+1 egg)");
    expect(wantedForLine("lettuce")).toBe("For: Garden Salad, Hen feed");
    expect(wantedForLine("cabbage")).toBe("For: Sauerkraut, Hen feed");
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

  it("puts the Feed Silo on the machine list for 12,000 Gold", () => {
    expect(MACHINE_CATALOGUE.feed_silo.placeCost).toBe(12_000);
    expect(MACHINE_KINDS).toHaveLength(MACHINE_CAP);
  });
});

describe("the town kitchen (Chapter 5)", () => {
  it("cooks Tomato Sauce in the Stew Pot and bakes it into Stuffed Peppers", () => {
    expect(RECIPE_CATALOGUE.sauce.machine).toBe("stew_pot");
    expect(RECIPE_CATALOGUE.stuffed_peppers.machine).toBe("oven");
    expect(recipesUsing("sauce")).toEqual(["stuffed_peppers"]);
    expect(wantedForLine("bell_pepper")).toBe("For: Stuffed Peppers");
  });

  it("mixes Hot Salsa and jars Pickles and Sauerkraut on the Counter", () => {
    expect(RECIPE_CATALOGUE.salsa.machine).toBe("counter");
    expect(RECIPE_CATALOGUE.pickles.inputs).toEqual([{ item: "celery", quantity: 2 }]);
    expect(RECIPE_CATALOGUE.sauerkraut.inputs).toEqual([{ item: "cabbage", quantity: 3 }]);
    expect(wantedForLine("pepper")).toBe("For: Hot Salsa");
    expect(wantedForLine("celery")).toBe("For: Tomato Sauce, Pickles");
    expect(wantedForLine("tomato")).toBe("For: Tomato Sauce, Hot Salsa");
  });

  it("makes Salsa and Stuffed Peppers food", () => {
    expect(FOOD_ENERGY.salsa).toBe(20);
    expect(FOOD_ENERGY.stuffed_peppers).toBe(40);
    expect(isFoodItem("sauce")).toBe(false);
    expect(isFoodItem("pickles")).toBe(false);
  });

  it("adds the Preserves Cellar at 25,000 Gold", () => {
    expect(MACHINE_CATALOGUE.cellar.placeCost).toBe(25_000);
  });
});

describe("feasts (Chapter 6)", () => {
  it("bakes Bean Casserole and the Harvest Feast in the Oven", () => {
    expect(RECIPE_CATALOGUE.bean_casserole.machine).toBe("oven");
    expect(RECIPE_CATALOGUE.harvest_feast.machine).toBe("oven");
    expect(wantedForLine("eggplant")).toBe("For: Harvest Feast");
    expect(wantedForLine("broccoli")).toBe("For: Bean Casserole, Harvest Feast");
    expect(recipesUsing("bread")).toEqual(["harvest_feast"]);
  });

  it("makes the Feast a full bar and the Casserole 40", () => {
    expect(FOOD_ENERGY.harvest_feast).toBe(100);
    expect(FOOD_ENERGY.bean_casserole).toBe(40);
  });

  it("adds the Farm Kitchen at 60,000 Gold, one of ten", () => {
    expect(MACHINE_CATALOGUE.farm_kitchen.placeCost).toBe(60_000);
    expect(MACHINE_CAP).toBe(10);
  });
});
