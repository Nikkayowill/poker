import { describe, expect, it } from "vitest";
import { dockEntriesFor, unitToolFor, type StackAcresDockSelection } from "./dock";
import { STACKACRES_SELECTABLE_TOOLS } from "./tools";
import type { StackAcresUnitState } from "./units";

const toolsOf = (selection: StackAcresDockSelection): string[] =>
  dockEntriesFor(selection).map((entry) => entry.tool);

const liveOf = (selection: StackAcresDockSelection): string[] =>
  dockEntriesFor(selection).filter((entry) => entry.live).map((entry) => entry.tool);

describe("unitToolFor", () => {
  // The mapping district-panel.ts's `unitRowAction` and the scene's
  // `unitTapEligible` both already make, restated in tool terms. If this
  // drifts, the dock lights a key the canvas then refuses.
  it("maps each actionable state to the one tool that answers it", () => {
    expect(unitToolFor("dry")).toBe("water");
    expect(unitToolFor("hungry")).toBe("feed");
    expect(unitToolFor("ready")).toBe("harvest");
    expect(unitToolFor("mucked")).toBe("harvest");
  });

  it("affords nothing while a unit is only growing", () => {
    expect(unitToolFor("working")).toBeNull();
  });
});

describe("dockEntriesFor", () => {
  it("rests on the three tools that drag across open ground", () => {
    expect(toolsOf({ kind: "none" })).toEqual(["scythe", "pipe", "soil"]);
    expect(liveOf({ kind: "none" })).toEqual(["scythe", "pipe", "soil"]);
  });

  it("offers a bare square only the tools that shape it", () => {
    expect(toolsOf({ kind: "ground", hasBed: false })).toEqual(["soil", "pipe", "water", "harvest"]);
    // Nothing is standing here, so watering and harvesting have no target --
    // shown, but dim.
    expect(liveOf({ kind: "ground", hasBed: false })).toEqual(["soil", "pipe"]);
  });

  it("lights watering and harvesting once a square has a bed", () => {
    expect(liveOf({ kind: "ground", hasBed: true })).toEqual(["soil", "pipe", "water", "harvest"]);
  });

  it("shows a unit the same three keys whatever state it is in", () => {
    const states: StackAcresUnitState[] = ["working", "hungry", "dry", "ready", "mucked"];
    for (const state of states) {
      expect(toolsOf({ kind: "unit", state }), `${state} reshuffled the row`).toEqual([
        "feed",
        "water",
        "harvest",
      ]);
    }
  });

  it("lights exactly the one key a unit affords", () => {
    expect(liveOf({ kind: "unit", state: "hungry" })).toEqual(["feed"]);
    expect(liveOf({ kind: "unit", state: "dry" })).toEqual(["water"]);
    expect(liveOf({ kind: "unit", state: "ready" })).toEqual(["harvest"]);
    expect(liveOf({ kind: "unit", state: "mucked" })).toEqual(["harvest"]);
  });

  it("lights nothing on a unit that is only growing", () => {
    expect(liveOf({ kind: "unit", state: "working" })).toEqual([]);
  });

  // The dock can only draw tools that have a button and a def behind them.
  it("never shows a tool the belt has no button for", () => {
    const drawable = new Set<string>(STACKACRES_SELECTABLE_TOOLS);
    const selections: StackAcresDockSelection[] = [
      { kind: "none" },
      { kind: "ground", hasBed: false },
      { kind: "ground", hasBed: true },
      { kind: "unit", state: "ready" },
    ];
    for (const selection of selections) {
      for (const tool of toolsOf(selection)) {
        expect(drawable.has(tool), `${tool} has no dock button`).toBe(true);
      }
    }
  });
});
