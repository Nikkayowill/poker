import { describe, expect, it } from "vitest";
import type { StackAcresStock } from "./catalogue";
import { CASCADE_MAX_UNITS, findCascadeTargets } from "./harvest-cascade";
import type { StackAcresUnitSnapshot, StackAcresUnitState } from "./units";

function unit(id: string, stock: StackAcresStock, state: StackAcresUnitState): StackAcresUnitSnapshot {
  return {
    id,
    state,
    stock,
    stake: 10,
    yieldQuantity: 1,
    startedAt: "2026-09-05T00:00:00.000Z",
    readyAt: "2026-09-05T00:10:00.000Z",
    progress: state === "mucked" ? null : 1,
    hungryAt: null,
    thirstyAt: null,
    isWatered: true,
    muckFee: null,
    permanent: false,
    housedIn: null,
  };
}

describe("findCascadeTargets", () => {
  it("finds other ready units in the same district only", () => {
    const units = [
      unit("origin", "hen", "ready"),
      unit("same-zone-ready", "hen", "ready"),
      unit("same-zone-working", "hen", "working"),
      unit("other-zone-ready", "cattle", "ready"),
    ];
    expect(findCascadeTargets(units, "farmstead", new Set(["origin"]))).toEqual([
      "same-zone-ready",
    ]);
  });

  it("never returns an excluded id, even one that would otherwise match", () => {
    const units = [unit("a", "hen", "ready"), unit("b", "hen", "ready")];
    expect(findCascadeTargets(units, "farmstead", new Set(["a", "b"]))).toEqual([]);
  });

  it("caps at CASCADE_MAX_UNITS even with a whole district ready", () => {
    const units = Array.from({ length: CASCADE_MAX_UNITS + 5 }, (_, i) => unit(`u${i}`, "hen", "ready"));
    expect(findCascadeTargets(units, "farmstead", new Set())).toHaveLength(CASCADE_MAX_UNITS);
  });

  it("returns nothing when nothing else in the district is ready", () => {
    const units = [unit("origin", "hen", "ready"), unit("other", "pig", "ready")];
    expect(findCascadeTargets(units, "farmstead", new Set(["origin"]))).toEqual([]);
  });

  it("is stable regardless of input order", () => {
    const units = [unit("z", "hen", "ready"), unit("a", "hen", "ready")];
    expect(findCascadeTargets(units, "farmstead", new Set())).toEqual(["a", "z"]);
  });
});
