import { describe, expect, it } from "vitest";
import {
  addToInventory,
  emptyInventory,
  hasEnough,
  inventoryQuantity,
  removeFromInventory,
} from "./inventory";

describe("inventoryQuantity", () => {
  it("reads a missing item as zero", () => {
    expect(inventoryQuantity(emptyInventory(), "wheat")).toBe(0);
  });
});

describe("addToInventory", () => {
  it("adds to a missing item as if it started at zero", () => {
    expect(addToInventory(emptyInventory(), "wheat", 3)).toEqual({ wheat: 3 });
  });

  it("adds onto an existing quantity without touching other items", () => {
    const inventory = { wheat: 2, flour: 1 };
    expect(addToInventory(inventory, "wheat", 3)).toEqual({ wheat: 5, flour: 1 });
  });

  it("is a no-op for a non-positive quantity, returning the same reference", () => {
    const inventory = { wheat: 2 };
    expect(addToInventory(inventory, "wheat", 0)).toBe(inventory);
    expect(addToInventory(inventory, "wheat", -1)).toBe(inventory);
  });
});

describe("removeFromInventory", () => {
  it("subtracts when there is enough", () => {
    expect(removeFromInventory({ wheat: 5 }, "wheat", 3)).toEqual({ wheat: 2 });
  });

  it("returns null rather than going negative", () => {
    expect(removeFromInventory({ wheat: 2 }, "wheat", 3)).toBeNull();
    expect(removeFromInventory(emptyInventory(), "wheat", 1)).toBeNull();
  });

  it("is a no-op for a non-positive quantity, returning the same reference", () => {
    const inventory = { wheat: 2 };
    expect(removeFromInventory(inventory, "wheat", 0)).toBe(inventory);
  });
});

describe("hasEnough", () => {
  it("matches removeFromInventory's own boundary exactly", () => {
    expect(hasEnough({ wheat: 3 }, "wheat", 3)).toBe(true);
    expect(hasEnough({ wheat: 2 }, "wheat", 3)).toBe(false);
  });
});
