import { describe, expect, it } from "vitest";
import { missingLine, recipeIngredients, recipesUsing, wantedForLine } from "./recipe-uses";
import { RECIPE_CATALOGUE } from "./recipes";
import { MACHINE_CAP, MACHINE_KINDS } from "./machines";
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
    expect(MACHINE_CAP).toBe(6);
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

  it("says nothing for a crop no recipe uses", () => {
    expect(recipesUsing("lettuce")).toEqual([]);
    expect(wantedForLine("lettuce")).toBeNull();
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
