import { describe, expect, it } from "vitest";
import type { StackAcresMachineSnapshot } from "./machines";
import type { StackAcresUnitSnapshot } from "./units";
import type { StackAcresWheatPlotSnapshot } from "./wheat-plot";
import {
  divertableUnits,
  finishedMachineCount,
  machineOfKind,
  ripeWheatCount,
  workDue,
  workshopAttention,
} from "./workshop";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const MINUTE = 60 * 1000;

function unit(overrides: Partial<StackAcresUnitSnapshot> = {}): StackAcresUnitSnapshot {
  return {
    id: "u1",
    state: "ready",
    stock: "cattle",
    stake: 50,
    yieldQuantity: 8,
    startedAt: new Date(NOW - 20 * MINUTE).toISOString(),
    readyAt: new Date(NOW - MINUTE).toISOString(),
    progress: 1,
    hungryAt: null,
    thirstyAt: null,
    isWatered: true,
    muckFee: null,
    permanent: false,
    housedIn: null,
    soilSlot: null,
    ...overrides,
  };
}

function plot(readyInMs: number): StackAcresWheatPlotSnapshot {
  return {
    id: `plot-${readyInMs}`,
    startedAt: new Date(NOW - 10 * MINUTE).toISOString(),
    readyAt: new Date(NOW + readyInMs).toISOString(),
    ready: readyInMs <= 0,
    progress: readyInMs <= 0 ? 1 : 0.5,
  };
}

function machine(overrides: Partial<StackAcresMachineSnapshot> = {}): StackAcresMachineSnapshot {
  return {
    id: "m1",
    kind: "mill",
    status: "idle",
    startedAt: null,
    readyAt: null,
    recipeId: null,
    unitsProcessing: 0,
    done: false,
    progress: null,
    ...overrides,
  };
}

describe("divertableUnits", () => {
  it("lists ready cattle and sheep with the item a machine takes", () => {
    const cow = unit({ id: "cow", stock: "cattle", yieldQuantity: 8 });
    const sheep = unit({ id: "sheep", stock: "pig", yieldQuantity: 6 });
    expect(divertableUnits([cow, sheep])).toEqual([
      { unitId: "cow", stock: "cattle", item: "milk", quantity: 8 },
      { unitId: "sheep", stock: "pig", item: "wool", quantity: 6 },
    ]);
  });

  it("skips hens (eggs feed no machine), crops, and anything not ready", () => {
    const hen = unit({ id: "hen", stock: "hen" });
    const carrot = unit({ id: "carrot", stock: "carrot" });
    const growing = unit({ id: "growing", stock: "cattle", state: "working" });
    const hungry = unit({ id: "hungry", stock: "cattle", state: "hungry" });
    expect(divertableUnits([hen, carrot, growing, hungry])).toEqual([]);
  });
});

describe("machineOfKind", () => {
  it("finds the one machine of a kind and null otherwise", () => {
    const mill = machine({ kind: "mill" });
    expect(machineOfKind([mill], "mill")).toBe(mill);
    expect(machineOfKind([mill], "dairy")).toBeNull();
  });
});

describe("work due", () => {
  it("counts ripe plots by the clock it is handed, not the snapshot's flag", () => {
    const plots = [plot(-1), plot(5 * MINUTE)];
    expect(ripeWheatCount(plots, NOW)).toBe(1);
    expect(ripeWheatCount(plots, NOW + 6 * MINUTE)).toBe(2);
  });

  it("counts finished runs and ignores idle machines", () => {
    const done = machine({ status: "working", readyAt: new Date(NOW - 1000).toISOString() });
    const running = machine({ id: "m2", status: "working", readyAt: new Date(NOW + 1000).toISOString() });
    const idle = machine({ id: "m3" });
    expect(finishedMachineCount([done, running, idle], NOW)).toBe(1);
  });

  it("is due only when a plot is ripe or a run has finished", () => {
    expect(workDue([], [], NOW)).toBe(false);
    expect(workDue([plot(MINUTE)], [machine()], NOW)).toBe(false);
    expect(workDue([plot(0)], [], NOW)).toBe(true);
    expect(
      workDue([], [machine({ status: "working", readyAt: new Date(NOW).toISOString() })], NOW),
    ).toBe(true);
  });
});

describe("workshopAttention", () => {
  it("dots the signpost for due work or a collectible vat, and nothing else", () => {
    expect(workshopAttention({ plots: [], machines: [], vat: null, nowMs: NOW })).toBe(false);
    expect(workshopAttention({ plots: [], machines: [], vat: { status: "aging" }, nowMs: NOW })).toBe(false);
    expect(workshopAttention({ plots: [], machines: [], vat: { status: "collectible" }, nowMs: NOW })).toBe(true);
    expect(workshopAttention({ plots: [plot(0)], machines: [], vat: null, nowMs: NOW })).toBe(true);
  });
});
