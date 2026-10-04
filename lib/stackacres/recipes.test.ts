import { describe, expect, it } from "vitest";
import {
  RECIPE_CATALOGUE,
  RECIPE_IDS,
  canStartRecipe,
  isInstantRecipe,
  recipeRawGoldValue,
  recipesForMachine,
} from "./recipes";
import { CONTRACT_RUNGS } from "./contracts";
import { MACHINE_KINDS } from "./machines";
import {
  isMachineItem,
  isMachineProcessedItem,
  machineItemPurpose,
  machineItemSellPrice,
} from "./machine-items";

describe("RECIPE_CATALOGUE", () => {
  it("eats real inventory items and makes a processed good, never its own output", () => {
    for (const id of RECIPE_IDS) {
      const def = RECIPE_CATALOGUE[id];
      expect(def.inputs.length).toBeGreaterThan(0);
      for (const input of def.inputs) {
        expect(isMachineItem(input.item)).toBe(true);
        expect(input.quantity).toBeGreaterThan(0);
        expect(input.item).not.toBe(def.output.item);
      }
      expect(isMachineProcessedItem(def.output.item)).toBe(true);
      expect(def.output.quantity).toBeGreaterThan(0);
    }
  });

  it("gives every recipe-driven machine kind at least one recipe, and every recipe one machine", () => {
    // The Vat is not recipe-driven; see aging.ts. Nor is the Feed Silo, and
    // nor is the Barn -- it buys comfort and room, not throughput (barn.ts).
    for (const kind of MACHINE_KINDS) {
      if (
        kind === "vat" ||
        kind === "feed_silo" ||
        kind === "cellar" ||
        kind === "farm_kitchen" ||
        kind === "barn"
      ) {
        continue;
      }
      expect(recipesForMachine(kind).length).toBeGreaterThan(0);
    }
    expect(recipesForMachine("dairy")).toEqual(["cheese", "cake"]);
  });

  it("makes the Mill queued and the Dairy and Loom instant, Cake included", () => {
    expect(isInstantRecipe("flour")).toBe(false);
    expect(isInstantRecipe("cheese")).toBe(true);
    expect(isInstantRecipe("cloth")).toBe(true);
    expect(isInstantRecipe("cake")).toBe(true);
  });

  it("bakes Cake from 2 Eggs, 1 Milk and 1 Flour on the Dairy", () => {
    expect(RECIPE_CATALOGUE.cake.machine).toBe("dairy");
    expect(RECIPE_CATALOGUE.cake.inputs).toEqual([
      { item: "eggs", quantity: 2 },
      { item: "milk", quantity: 1 },
      { item: "flour", quantity: 1 },
    ]);
    expect(RECIPE_CATALOGUE.cake.output).toEqual({ item: "cake", quantity: 1 });
  });
});

describe("canStartRecipe", () => {
  it("needs every input of a multi-input recipe, not just some", () => {
    expect(canStartRecipe({ eggs: 2, milk: 1, flour: 1 }, "cake")).toBe(true);
    expect(canStartRecipe({ eggs: 2, milk: 1 }, "cake")).toBe(false);
    expect(canStartRecipe({ eggs: 1, milk: 1, flour: 1 }, "cake")).toBe(false);
    expect(canStartRecipe({ eggs: 9, milk: 0, flour: 9 }, "cake")).toBe(false);
  });

  it("reads a single-input recipe's own input", () => {
    expect(canStartRecipe({ wool: 3 }, "cloth")).toBe(false);
    expect(canStartRecipe({ wool: 4 }, "cloth")).toBe(true);
  });
});

describe("recipeRawGoldValue", () => {
  it("sums every input's sell price per unit of output", () => {
    // 3 Wheat at 7.
    expect(recipeRawGoldValue("flour")).toBe(21);
    // 3 Milk at 120.
    expect(recipeRawGoldValue("cheese")).toBe(360);
    // 4 Fleeces at 40.
    expect(recipeRawGoldValue("cloth")).toBe(160);
    // 2 Eggs at 12, 1 Milk at 120, 1 Flour at 24.
    expect(recipeRawGoldValue("cake")).toBe(2 * 12 + 120 + 24);
  });

  it("never sells a made good for less than its inputs, so crafting never loses to selling raw", () => {
    for (const id of RECIPE_IDS) {
      const def = RECIPE_CATALOGUE[id];
      expect(machineItemSellPrice(def.output.item), id).toBeGreaterThanOrEqual(recipeRawGoldValue(id));
    }
  });

  it("sells every made good for at most 1.15x its raw inputs, so raw goods stay the income", () => {
    for (const id of RECIPE_IDS) {
      const def = RECIPE_CATALOGUE[id];
      expect(machineItemSellPrice(def.output.item), id).toBeLessThanOrEqual(recipeRawGoldValue(id) * 1.15);
    }
  });
});

describe("contract pricing", () => {

  it("asks for no Cheese or Cloth", () => {
    expect(CONTRACT_RUNGS.filter((rung) => rung.item === "cheese" || rung.item === "cloth")).toEqual([]);
  });

  it("still pays more per unit than Sell does, for every good a contract asks for", () => {
    for (const rung of CONTRACT_RUNGS) {
      expect(rung.goldReward / rung.quantity).toBeGreaterThan(machineItemSellPrice(rung.item));
    }
  });

  it("pays more Gold and more Influence the more it asks for, within a good", () => {
    for (const item of new Set(CONTRACT_RUNGS.map((rung) => rung.item))) {
      const rungs = CONTRACT_RUNGS.filter((rung) => rung.item === item).sort(
        (a, b) => a.quantity - b.quantity,
      );
      for (let i = 1; i < rungs.length; i += 1) {
        expect(rungs[i].goldReward).toBeGreaterThan(rungs[i - 1].goldReward);
        expect(rungs[i].influenceReward).toBeGreaterThan(rungs[i - 1].influenceReward);
      }
    }
  });
});

describe("machine item purpose hints", () => {
  it("give common raw resources a useful next step", () => {
    expect(machineItemPurpose("wood").toLowerCase()).toContain("building material");
    expect(machineItemPurpose("bluegill")).toContain("sell for Gold");
    expect(machineItemPurpose("meat")).toContain("Exploration find");
    expect(machineItemPurpose("flour")).toContain("recipes");
  });
});
