import { describe, expect, it } from "vitest";
import {
  RECIPE_CATALOGUE,
  RECIPE_IDS,
  canStartRecipe,
  isInstantRecipe,
  recipeForOutput,
  recipeRawGoldValue,
  recipesForMachine,
} from "./recipes";
import { CONTRACT_RUNGS } from "./contracts";
import { MACHINE_KINDS } from "./machines";
import { isMachineItem, isMachineProcessedItem, machineItemSellPrice } from "./machine-items";

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
    // The Vat is not recipe-driven; see aging.ts.
    for (const kind of MACHINE_KINDS) {
      if (kind === "vat") continue;
      expect(recipesForMachine(kind).length).toBeGreaterThan(0);
    }
    expect(recipesForMachine("dairy")).toEqual(["cheese", "cake"]);
  });

  it("has exactly one producer per processed good", () => {
    for (const id of RECIPE_IDS) {
      expect(recipeForOutput(RECIPE_CATALOGUE[id].output.item)).toBe(id);
    }
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
    // 3 Wheat at 4.
    expect(recipeRawGoldValue("flour")).toBe(12);
    // 3 Milk at 220.
    expect(recipeRawGoldValue("cheese")).toBe(660);
    // 4 Fleeces at 76.
    expect(recipeRawGoldValue("cloth")).toBe(304);
    // 2 Eggs at 18, 1 Milk at 220, 1 Flour at 40.
    expect(recipeRawGoldValue("cake")).toBe(2 * 18 + 220 + 40);
  });

  it("sits under every processed good's own sell price, so crafting never loses to selling raw", () => {
    for (const id of RECIPE_IDS) {
      const def = RECIPE_CATALOGUE[id];
      expect(machineItemSellPrice(def.output.item)).toBeGreaterThan(recipeRawGoldValue(id));
    }
  });
});

describe("contract pricing", () => {
  it("pays a uniform premium over the raw inputs, on every rung", () => {
    // A rung under 1.0x makes the machine a sink; one far above the others
    // turns the single open contract into a reroll puzzle. Narrow band.
    const priced = CONTRACT_RUNGS.map((rung) => {
      const recipe = recipeForOutput(rung.item);
      if (!recipe) return null;
      return rung.goldReward / (recipeRawGoldValue(recipe) * rung.quantity);
    }).filter((ratio): ratio is number => ratio !== null);

    expect(priced.length).toBeGreaterThan(0);
    for (const rung of CONTRACT_RUNGS) {
      if (rung.item === "flour") continue; // priced off seed, see contracts.ts
      const recipe = recipeForOutput(rung.item)!;
      const ratio = rung.goldReward / (recipeRawGoldValue(recipe) * rung.quantity);
      expect(ratio).toBeGreaterThan(1.25);
      expect(ratio).toBeLessThan(1.35);
    }
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
