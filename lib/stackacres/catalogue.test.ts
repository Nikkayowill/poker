import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE } from "./catalogue";
import { STACKACRES_YIELDS, yieldValue } from "./items";

describe("StackAcres early crop loop", () => {
  it("gives starter crops distinct timing and tending jobs", () => {
    expect(STACKACRES_CATALOGUE.carrot).toMatchObject({
      seedCost: 1,
      durationMs: 5 * 60 * 1000,
      thirstMs: 2 * 60 * 1000,
    });
    expect(STACKACRES_CATALOGUE.potato).toMatchObject({
      seedCost: 1,
      durationMs: 10 * 60 * 1000,
      thirstMs: 5 * 60 * 1000,
    });
    expect(STACKACRES_CATALOGUE.radish).toMatchObject({
      seedCost: 1,
      durationMs: 15 * 60 * 1000,
      thirstMs: 5 * 60 * 1000,
    });
    expect(STACKACRES_CATALOGUE.wheat).toMatchObject({
      seedCost: 3,
      durationMs: 20 * 60 * 1000,
      thirstMs: 8 * 60 * 1000,
    });
  });

  it("makes the early crop yields reinforce their roles", () => {
    expect(STACKACRES_YIELDS.carrot).toEqual({ item: "carrot", quantity: 1 });
    expect(STACKACRES_YIELDS.potato).toEqual({ item: "potato", quantity: 3 });
    expect(yieldValue("carrot")).toBe(5);
    expect(yieldValue("potato")).toBe(3);
    expect(yieldValue("wheat")).toBe(16);
    expect(yieldValue("carrot")).toBeGreaterThan(yieldValue("potato"));
    expect(yieldValue("carrot") / STACKACRES_CATALOGUE.carrot.durationMs).toBeGreaterThan(
      yieldValue("wheat") / STACKACRES_CATALOGUE.wheat.durationMs,
    );
  });
});
