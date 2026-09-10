import { describe, expect, it } from "vitest";
import { applyRecipeOptimistically } from "./optimistic-recipe";
import { RECIPE_CATALOGUE } from "./recipes";

describe("applyRecipeOptimistically", () => {
  it("runs the same arithmetic the server will", () => {
    const def = RECIPE_CATALOGUE.cheese;
    const result = applyRecipeOptimistically({ milk: 10, cheese: 2 }, "cheese");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.milk).toBe(10 - def.inputs[0].quantity);
    expect(result.next.cheese).toBe(2 + def.output.quantity);
  });

  it("spends every input of a multi-input recipe and credits the one output", () => {
    const result = applyRecipeOptimistically({ eggs: 5, milk: 3, flour: 2 }, "cake");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next).toEqual({ eggs: 3, milk: 2, flour: 1, cake: 1 });
  });

  it("starts a byproduct the player has never held before at the batch size", () => {
    const result = applyRecipeOptimistically({ wool: 4 }, "cloth");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.cloth).toBe(RECIPE_CATALOGUE.cloth.output.quantity);
    expect(result.next.wool).toBe(0);
  });

  it("refuses locally when the player plainly does not have enough, and says which input and by how much", () => {
    const result = applyRecipeOptimistically({ milk: 1 }, "cheese");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.item).toBe("milk");
    expect(result.shortfall).toBe(RECIPE_CATALOGUE.cheese.inputs[0].quantity - 1);
  });

  it("refuses a multi-input recipe on the first short input and changes nothing", () => {
    const before = { eggs: 2, milk: 1 };
    const result = applyRecipeOptimistically(before, "cake");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.item).toBe("flour");
    expect(result.shortfall).toBe(1);
    expect(before).toEqual({ eggs: 2, milk: 1 });
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
    const before = { milk: 10, cheese: 2 };
    const result = applyRecipeOptimistically(before, "cheese");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rollback()).toEqual(before);
    // Safe to call more than once.
    expect(result.rollback()).toEqual(before);
  });
});
