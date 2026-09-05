import { describe, expect, it } from "vitest";
import { applyRecipeOptimistically } from "./optimistic-recipe";
import { RECIPE_CATALOGUE } from "./recipes";

describe("applyRecipeOptimistically", () => {
  it("runs the same arithmetic the server will", () => {
    const def = RECIPE_CATALOGUE.cheese;
    const result = applyRecipeOptimistically({ milk: 10, cheese: 2 }, "cheese");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.milk).toBe(10 - def.input.quantity);
    expect(result.next.cheese).toBe(2 + def.output.quantity);
  });

  it("starts a byproduct the player has never held before at the batch size", () => {
    const result = applyRecipeOptimistically({ wool: 4 }, "cloth");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.cloth).toBe(RECIPE_CATALOGUE.cloth.output.quantity);
    expect(result.next.wool).toBe(0);
  });

  it("refuses locally when the player plainly does not have enough, and says by how much", () => {
    const result = applyRecipeOptimistically({ milk: 1 }, "cheese");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.shortfall).toBe(RECIPE_CATALOGUE.cheese.input.quantity - 1);
  });

  it("treats a missing key and a zero the same way", () => {
    expect(applyRecipeOptimistically({}, "cheese")).toEqual(
      applyRecipeOptimistically({ milk: 0 }, "cheese"),
    );
  });

  it("never mutates the inventory it was handed", () => {
    const before = { milk: 10 };
    const result = applyRecipeOptimistically(before, "cheese");
    expect(before).toEqual({ milk: 10 });
    if (result.ok) result.rollback();
    expect(before).toEqual({ milk: 10 });
  });

  it("rolls back to the pre-tap snapshot, not to an undo of the delta", () => {
    // The distinction matters when the caller's state has moved on: rollback
    // restores what was on screen when the tap happened, which is the correct
    // answer for a refusal, because a refusal means nothing was written.
    const before = { milk: 10, cheese: 2 };
    const result = applyRecipeOptimistically(before, "cheese");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rollback()).toEqual(before);
    // Safe to call more than once.
    expect(result.rollback()).toEqual(before);
  });
});
