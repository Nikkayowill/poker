import { describe, expect, it } from "vitest";
import { canStartMachine, isMachineDone, machineProgress, rollMillDoubleOutput } from "./machines";
import { RECIPE_CATALOGUE, canStartRecipe } from "./recipes";

describe("canStartMachine", () => {
  it("requires the mill's full input batch, not just some of it", () => {
    const wheat = RECIPE_CATALOGUE.flour.inputs[0].quantity;
    expect(canStartMachine({ wheat: wheat - 1 }, "mill")).toBe(false);
    expect(canStartMachine({ wheat }, "mill")).toBe(true);
    expect(canStartMachine({ wheat: wheat + 5 }, "mill")).toBe(true);
  });

  it("lets a Dairy start on whichever of its recipes the shelf covers", () => {
    expect(canStartMachine({ eggs: 2, milk: 1, flour: 1 }, "dairy")).toBe(true);
    expect(canStartMachine({ eggs: 2, flour: 1 }, "dairy")).toBe(false);
  });

  it("does not confuse one machine's input for another's", () => {
    // A Dairy full of milk says nothing about whether the Mill can run, and
    // vice versa -- the pair is what would break if `canStartMachine` ever
    // stopped filtering by the machine's own recipes.
    expect(canStartMachine({ milk: 99 }, "mill")).toBe(false);
    expect(canStartMachine({ wheat: 99 }, "dairy")).toBe(false);
    expect(canStartMachine({ milk: RECIPE_CATALOGUE.cheese.inputs[0].quantity }, "dairy")).toBe(true);
    expect(canStartMachine({ wool: RECIPE_CATALOGUE.cloth.inputs[0].quantity }, "loom")).toBe(true);
  });
});

describe("canStartRecipe", () => {
  it("reads the recipe's own input, not the machine's kind", () => {
    expect(canStartRecipe({ wool: 3 }, "cloth")).toBe(false);
    expect(canStartRecipe({ wool: 4 }, "cloth")).toBe(true);
  });
});

describe("isMachineDone", () => {
  it("is false while idle regardless of readyAt", () => {
    expect(
      isMachineDone({ status: "idle", readyAt: "2020-01-01T00:00:00.000Z" }, new Date()),
    ).toBe(false);
  });

  it("is true once a working machine's readyAt has passed", () => {
    expect(
      isMachineDone(
        { status: "working", readyAt: "2026-09-04T00:00:20.000Z" },
        new Date("2026-09-04T00:00:20.000Z"),
      ),
    ).toBe(true);
    expect(
      isMachineDone(
        { status: "working", readyAt: "2026-09-04T00:00:20.000Z" },
        new Date("2026-09-04T00:00:19.000Z"),
      ),
    ).toBe(false);
  });
});

describe("machineProgress", () => {
  it("is null while idle -- there is no run to show a bar for", () => {
    expect(machineProgress({ status: "idle", startedAt: null, readyAt: null }, new Date())).toBeNull();
  });

  it("runs 0..1 while working", () => {
    const started = "2026-09-04T00:00:00.000Z";
    const ready = "2026-09-04T00:00:20.000Z";
    expect(
      machineProgress({ status: "working", startedAt: started, readyAt: ready }, new Date(started)),
    ).toBe(0);
    expect(
      machineProgress({ status: "working", startedAt: started, readyAt: ready }, new Date(ready)),
    ).toBe(1);
  });
});

describe("rollMillDoubleOutput", () => {
  it("never hits at chance 0, whatever the roll", () => {
    expect(rollMillDoubleOutput(0, () => 0)).toBe(false);
  });

  it("hits below the chance and misses at or above it", () => {
    expect(rollMillDoubleOutput(0.1, () => 0.099)).toBe(true);
    expect(rollMillDoubleOutput(0.1, () => 0.1)).toBe(false);
  });
});
