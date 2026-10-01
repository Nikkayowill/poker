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
import { CONTRACT_PREMIUM, buildContract, contractQuantityLadder } from "./contracts";
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
    // The Vat is not recipe-driven; see aging.ts. Nor is the Feed Silo.
    for (const kind of MACHINE_KINDS) {
      if (kind === "vat" || kind === "feed_silo" || kind === "cellar" || kind === "farm_kitchen") continue;
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
    // 2 Eggs at 18, 1 Milk at 220, 1 Flour at 16.
    expect(recipeRawGoldValue("cake")).toBe(2 * 18 + 220 + 16);
  });

  it("sits under every processed good's own sell price, so crafting never loses to selling raw", () => {
    for (const id of RECIPE_IDS) {
      const def = RECIPE_CATALOGUE[id];
      expect(machineItemSellPrice(def.output.item)).toBeGreaterThan(recipeRawGoldValue(id));
    }
  });
});

describe("contract pricing", () => {
  const goods = RECIPE_IDS.map((id) => RECIPE_CATALOGUE[id].output.item).filter(
    (item) => item !== "cattle_feed" && item !== "metal",
  );

  it("pays a uniform premium over the goods' Sell value, on every machine good", () => {
    // Under 1.0x makes the machine a sink; a good paid far above the others
    // turns the board into an arbitrage puzzle. One flat number, pinned.
    for (const item of goods) {
      for (const quantity of contractQuantityLadder(item)) {
        const order = buildContract([{ item, quantity }]);
        const ratio = order.goldReward / (machineItemSellPrice(item) * quantity);
        expect(ratio).toBeGreaterThan(CONTRACT_PREMIUM - 0.05);
        expect(ratio).toBeLessThan(CONTRACT_PREMIUM + 0.05);
      }
    }
  });

  it("still clears what the raw inputs would have sold for, so no machine is a sink", () => {
    for (const item of goods) {
      const recipe = recipeForOutput(item)!;
      const order = buildContract([{ item, quantity: 1 }]);
      expect(order.goldReward).toBeGreaterThan(recipeRawGoldValue(recipe));
    }
  });

  it("pays more Gold and more Influence the more it asks for, within a good", () => {
    for (const item of goods) {
      const ladder = contractQuantityLadder(item);
      for (let i = 1; i < ladder.length; i += 1) {
        const smaller = buildContract([{ item, quantity: ladder[i - 1] }]);
        const larger = buildContract([{ item, quantity: ladder[i] }]);
        expect(larger.goldReward).toBeGreaterThan(smaller.goldReward);
        expect(larger.influenceReward).toBeGreaterThanOrEqual(smaller.influenceReward);
      }
    }
  });
});
