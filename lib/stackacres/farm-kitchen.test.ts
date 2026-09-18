import { describe, expect, it } from "vitest";
import {
  FARM_KITCHEN_BANK,
  FARM_KITCHEN_RECIPES,
  FARM_KITCHEN_STEP_MS,
  batchesAffordable,
  farmKitchenBanked,
  isFarmKitchenRecipe,
  planFarmKitchen,
} from "./farm-kitchen";

const T0 = new Date("2026-09-18T12:00:00.000Z");
const at = (steps: number) => new Date(T0.getTime() + steps * FARM_KITCHEN_STEP_MS);

describe("the Farm Kitchen", () => {
  it("cooks kitchen recipes only, never the Mill's or the Dairy's", () => {
    expect(isFarmKitchenRecipe("harvest_feast")).toBe(true);
    expect(isFarmKitchenRecipe("stew")).toBe(true);
    expect(isFarmKitchenRecipe("flour")).toBe(false);
    expect(isFarmKitchenRecipe("cheese")).toBe(false);
    expect(FARM_KITCHEN_RECIPES).not.toContain("cattle_feed");
  });

  it("banks one batch per half hour, up to the cap, and nothing before an order", () => {
    expect(farmKitchenBanked(null, at(10))).toBe(0);
    expect(farmKitchenBanked(T0.toISOString(), at(0.9))).toBe(0);
    expect(farmKitchenBanked(T0.toISOString(), at(3))).toBe(3);
    expect(farmKitchenBanked(T0.toISOString(), at(100))).toBe(FARM_KITCHEN_BANK);
  });

  it("counts whole batches the shelf can pay for", () => {
    expect(batchesAffordable({ potato: 5, carrot: 4, onion: 9 }, "stew")).toBe(2);
    expect(batchesAffordable({}, "stew")).toBe(0);
  });

  it("cooks what is both banked and affordable, at double yield, and keeps the rest banked", () => {
    const plan = planFarmKitchen(
      { standingRecipe: "pickles", kitchenSince: T0.toISOString() },
      { celery: 7 },
      at(5.5),
    );
    expect(plan).toMatchObject({
      recipe: "pickles",
      batches: 3,
      inputs: [{ item: "celery", quantity: 6 }],
      output: { item: "pickles", quantity: 6 },
      nextSince: at(3).toISOString(),
    });
    // Two banked batches and the half-step in progress carry over.
    expect(farmKitchenBanked(plan!.nextSince, at(5.5))).toBe(2);
  });

  it("drops time past a full bank rather than saving it up", () => {
    const plan = planFarmKitchen(
      { standingRecipe: "pickles", kitchenSince: T0.toISOString() },
      { celery: 2 },
      at(40),
    );
    expect(plan?.batches).toBe(1);
    expect(farmKitchenBanked(plan!.nextSince, at(40))).toBe(FARM_KITCHEN_BANK - 1);
  });

  it("does nothing without an order, a bank, or ingredients", () => {
    expect(planFarmKitchen({ standingRecipe: null, kitchenSince: T0.toISOString() }, { celery: 9 }, at(4))).toBeNull();
    expect(planFarmKitchen({ standingRecipe: "pickles", kitchenSince: T0.toISOString() }, { celery: 9 }, at(0.5))).toBeNull();
    expect(planFarmKitchen({ standingRecipe: "pickles", kitchenSince: T0.toISOString() }, { celery: 1 }, at(4))).toBeNull();
  });
});
