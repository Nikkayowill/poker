import { describe, expect, it } from "vitest";
import type { StackAcresUnitSnapshot } from "./units";
import { touchedUnitIds } from "./unit-merge";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function unit(overrides: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id: "unit-1",
    state: "working",
    stock: "lettuce",
    stake: 25,
    yieldQuantity: 4,
    startedAt: NOW.toISOString(),
    readyAt: new Date(NOW.getTime() + 60_000).toISOString(),
    progress: 0,
    hungryAt: null,
    thirstyAt: new Date(NOW.getTime() + 30_000).toISOString(),
    isWatered: true,
    seed: false,
    muckFee: null,
    permanent: false,
    housedIn: null,
    soilSlot: null,
    ...overrides,
  };
}

describe("touchedUnitIds", () => {
  it("reports only ids whose object changed against the snapshot", () => {
    const a = unit({ id: "a" });
    const b = unit({ id: "b" });
    const before = [a, b];
    // Same shape as predictStackAcresAction's own convention: an unchanged
    // unit is the SAME object, a changed one is a new one.
    const bWatered = unit({ id: "b", isWatered: true, thirstyAt: null });
    const after = [a, bWatered];

    expect(touchedUnitIds(before, after)).toEqual(["b"]);
  });

  it("reports a brand new id as touched", () => {
    const a = unit({ id: "a" });
    const created = unit({ id: "sa-optimistic-1" });
    expect(touchedUnitIds([a], [a, created])).toEqual(["sa-optimistic-1"]);
  });

  it("reports a removed id as touched too", () => {
    const a = unit({ id: "a" });
    const harvested = unit({ id: "b" });
    expect(touchedUnitIds([a, harvested], [a])).toEqual(["b"]);
  });
});
