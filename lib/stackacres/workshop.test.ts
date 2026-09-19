import { describe, expect, it } from "vitest";
import type { StackAcresMachineSnapshot } from "./machines";
import {
  finishedMachineCount,
  machineOfKind,
  workDue,
  workshopAttention,
} from "./workshop";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");

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
    autoFeedsLeft: null,
    standingRecipe: null,
    kitchenSince: null,
    ...overrides,
  };
}

describe("machineOfKind", () => {
  it("finds the one machine of a kind and null otherwise", () => {
    const mill = machine({ kind: "mill" });
    expect(machineOfKind([mill], "mill")).toBe(mill);
    expect(machineOfKind([mill], "dairy")).toBeNull();
  });
});

describe("work due", () => {
  it("counts finished runs and ignores idle machines", () => {
    const done = machine({ status: "working", readyAt: new Date(NOW - 1000).toISOString() });
    const running = machine({ id: "m2", status: "working", readyAt: new Date(NOW + 1000).toISOString() });
    const idle = machine({ id: "m3" });
    expect(finishedMachineCount([done, running, idle], NOW)).toBe(1);
  });

  it("is due only when a run has finished", () => {
    expect(workDue([], NOW)).toBe(false);
    expect(workDue([machine()], NOW)).toBe(false);
    expect(
      workDue([machine({ status: "working", readyAt: new Date(NOW).toISOString() })], NOW),
    ).toBe(true);
  });
});

describe("workshopAttention", () => {
  it("dots the signpost for due work or a collectible vat, and nothing else", () => {
    expect(workshopAttention({ machines: [], vat: null, nowMs: NOW })).toBe(false);
    expect(workshopAttention({ machines: [], vat: { status: "aging" }, nowMs: NOW })).toBe(false);
    expect(workshopAttention({ machines: [], vat: { status: "collectible" }, nowMs: NOW })).toBe(true);
    expect(
      workshopAttention({
        machines: [machine({ status: "working", readyAt: new Date(NOW).toISOString() })],
        vat: null,
        nowMs: NOW,
      }),
    ).toBe(true);
  });
});
