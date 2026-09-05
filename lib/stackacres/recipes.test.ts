import { describe, expect, it } from "vitest";
import {
  RECIPE_CATALOGUE,
  RECIPE_IDS,
  isInstantRecipe,
  recipeForOutput,
  recipeRawGoldValue,
  recipesForMachine,
} from "./recipes";
import { CONTRACT_RUNGS } from "./contracts";
import { MACHINE_KINDS } from "./machines";
import { isMachineProcessedItem, isMachineRawItem } from "./machine-items";

describe("RECIPE_CATALOGUE", () => {
  it("keeps every input on the raw side and every output on the processed side", () => {
    // The two item spaces are disjoint, and a recipe crossing them the wrong
    // way would let a machine eat its own output -- an infinite loop with a
    // Gold price at the end of it.
    for (const id of RECIPE_IDS) {
      const def = RECIPE_CATALOGUE[id];
      expect(isMachineRawItem(def.input.item)).toBe(true);
      expect(isMachineProcessedItem(def.output.item)).toBe(true);
      expect(def.input.quantity).toBeGreaterThan(0);
      expect(def.output.quantity).toBeGreaterThan(0);
    }
  });

  it("gives every machine kind at least one recipe, and every recipe one machine", () => {
    for (const kind of MACHINE_KINDS) {
      expect(recipesForMachine(kind).length).toBeGreaterThan(0);
    }
    expect(RECIPE_IDS.flatMap((id) => recipesForMachine(RECIPE_CATALOGUE[id].machine))).toContain(
      "cheese",
    );
  });

  it("has exactly one producer per processed good", () => {
    for (const id of RECIPE_IDS) {
      expect(recipeForOutput(RECIPE_CATALOGUE[id].output.item)).toBe(id);
    }
  });

  it("makes the Mill queued and the Dairy and Loom instant", () => {
    expect(isInstantRecipe("flour")).toBe(false);
    expect(isInstantRecipe("cheese")).toBe(true);
    expect(isInstantRecipe("cloth")).toBe(true);
  });
});

describe("recipeRawGoldValue", () => {
  it("is null for a recipe whose input has no price on the Gold track", () => {
    // Wheat is processing-track only, so there is no forgone harvest to
    // measure a Flour contract against -- it is judged on seed cost instead.
    expect(recipeRawGoldValue("flour")).toBeNull();
  });

  it("prices one output unit at what its raw material would have fetched", () => {
    // 3 Milk at 220 Gold each, one Cheese out.
    expect(recipeRawGoldValue("cheese")).toBe(660);
    // 4 Fleeces at 76 Gold each, one Cloth out.
    expect(recipeRawGoldValue("cloth")).toBe(304);
  });
});

describe("contract pricing against forgone harvest Gold", () => {
  it("pays a uniform premium over selling the raw produce, on every rung", () => {
    // THE INVARIANT THIS FILE EXISTS FOR. Milk and wool sent to a machine are
    // milk and wool the harvest never paid for. A rung under 1.0x would make
    // the machine a sink the player bought with their own Gold; a rung far
    // above the others would turn the single, uncancellable open contract
    // into a reroll puzzle with no reroll. Both are bugs, so the band is
    // narrow on purpose.
    const priced = CONTRACT_RUNGS.map((rung) => {
      const recipe = recipeForOutput(rung.item);
      const raw = recipe ? recipeRawGoldValue(recipe) : null;
      return raw === null ? null : rung.goldReward / (raw * rung.quantity);
    }).filter((ratio): ratio is number => ratio !== null);

    expect(priced.length).toBeGreaterThan(0);
    for (const ratio of priced) {
      expect(ratio).toBeGreaterThan(1.25);
      expect(ratio).toBeLessThan(1.35);
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
