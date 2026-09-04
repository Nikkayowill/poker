import { describe, expect, it } from "vitest";
import { canStartMachine, isMachineDone, machineProgress, MACHINE_CATALOGUE } from "./machines";

describe("canStartMachine", () => {
  it("requires the mill's full input batch, not just some of it", () => {
    const def = MACHINE_CATALOGUE.mill;
    expect(canStartMachine({ wheat: def.input.quantity - 1 }, "mill")).toBe(false);
    expect(canStartMachine({ wheat: def.input.quantity }, "mill")).toBe(true);
    expect(canStartMachine({ wheat: def.input.quantity + 5 }, "mill")).toBe(true);
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
