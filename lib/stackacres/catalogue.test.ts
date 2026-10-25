import { describe, expect, it } from "vitest";
import { cropPurpose, STACKACRES_CATALOGUE } from "./catalogue";
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
      seedCost: 2,
      durationMs: 15 * 60 * 1000,
      thirstMs: 5 * 60 * 1000,
    });
    expect(STACKACRES_CATALOGUE.wheat).toMatchObject({
      seedCost: 3,
      durationMs: 10 * 60 * 1000,
      thirstMs: null,
    });
  });

  it("makes the early crop yields reinforce their roles", () => {
    expect(STACKACRES_YIELDS.carrot).toEqual({ item: "carrot", quantity: 1 });
    expect(STACKACRES_YIELDS.potato).toEqual({ item: "potato", quantity: 3 });
    expect(yieldValue("carrot")).toBe(5);
    expect(yieldValue("potato")).toBe(3);
    expect(yieldValue("wheat")).toBe(28);
    expect(yieldValue("wheat")).toBeGreaterThan(yieldValue("carrot"));
    expect(yieldValue("carrot") / STACKACRES_CATALOGUE.carrot.durationMs).toBeGreaterThan(
      yieldValue("potato") / STACKACRES_CATALOGUE.potato.durationMs,
    );
    // Wheat intentionally has the larger raw shelf value: its role is chosen
    // because it is no-water utility for hens and the Mill, not because it
    // wins the active carrot loop.
    expect(STACKACRES_CATALOGUE.wheat.thirstMs).toBeNull();
  });

  it("teaches the four first-session crop jobs", () => {
    expect(cropPurpose("carrot")).toContain("money");
    expect(cropPurpose("potato")).toContain("Stew Pot");
    expect(cropPurpose("radish")).toContain("bait");
    expect(cropPurpose("wheat")).toContain("No watering");
  });
});
