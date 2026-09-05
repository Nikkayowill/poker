import { describe, expect, it } from "vitest";
import { STACKACRES_STOCK } from "./catalogue";
import {
  CROSSBREED_GRID_COLS,
  CROSSBREED_GRID_ROWS,
  CROSSBREED_MATRIX,
  type CrossbreedBedPlot,
  crossbreedMatrixEntryFor,
  crossbreedableStock,
  crossedTrack,
  evaluateMutationChance,
  isCrossbreedPlotReady,
  isInCrossbreedGrid,
  resolveCrossbreedHarvest,
  rollCrossbreedMutation,
  seededRandomForPlot,
  toCrossbreedBedPlot,
} from "./crossbreeding";

/** A ripe row planted at (row, col). Every helper test grid below is built
 *  from these -- an omitted plot is treated as empty soil, matching how a
 *  real store snapshot may not bother sending untouched plots at all. */
function plot(id: string, row: number, col: number, stock: CrossbreedBedPlot["stock"], ready = true): CrossbreedBedPlot {
  return { id, row, col, stock, ready };
}

const NO_ROLL = () => 1; // never beats any chance in (0, 1]
const ALWAYS_ROLL = () => 0; // beats every chance in (0, 1]

describe("isInCrossbreedGrid", () => {
  it("accepts every cell of the fixed 4x4 bed and nothing outside it", () => {
    expect(isInCrossbreedGrid(0, 0)).toBe(true);
    expect(isInCrossbreedGrid(CROSSBREED_GRID_ROWS - 1, CROSSBREED_GRID_COLS - 1)).toBe(true);
    expect(isInCrossbreedGrid(-1, 0)).toBe(false);
    expect(isInCrossbreedGrid(0, -1)).toBe(false);
    expect(isInCrossbreedGrid(CROSSBREED_GRID_ROWS, 0)).toBe(false);
    expect(isInCrossbreedGrid(0, CROSSBREED_GRID_COLS)).toBe(false);
    expect(isInCrossbreedGrid(1.5, 0)).toBe(false);
  });
});

describe("CROSSBREED_MATRIX", () => {
  it("never lists the same unordered pair twice", () => {
    const seen = new Set<string>();
    for (const entry of CROSSBREED_MATRIX) {
      const key = [entry.a, entry.b].sort().join(":");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("never pairs a kind with itself", () => {
    for (const entry of CROSSBREED_MATRIX) {
      expect(entry.a).not.toBe(entry.b);
    }
  });

  it("only ever pairs real StackAcres stock", () => {
    for (const entry of CROSSBREED_MATRIX) {
      expect(STACKACRES_STOCK).toContain(entry.a);
      expect(STACKACRES_STOCK).toContain(entry.b);
    }
  });

  it("every chance is a real roll probability, in (0, 1]", () => {
    for (const entry of CROSSBREED_MATRIX) {
      expect(entry.chance).toBeGreaterThan(0);
      expect(entry.chance).toBeLessThanOrEqual(1);
    }
  });
});

describe("crossbreedMatrixEntryFor", () => {
  it("matches a pair in either order", () => {
    const forward = crossbreedMatrixEntryFor("sprout", "cash_crop");
    const reverse = crossbreedMatrixEntryFor("cash_crop", "sprout");
    expect(forward).not.toBeNull();
    expect(reverse).toEqual(forward);
  });

  it("refuses a kind paired with itself, even one the matrix would otherwise match", () => {
    expect(crossbreedMatrixEntryFor("sprout", "sprout")).toBeNull();
  });

  it("returns null for a pair StackAcres has never defined a cross for", () => {
    // sprout + pig is not in CROSSBREED_MATRIX above.
    expect(crossbreedMatrixEntryFor("sprout", "pig")).toBeNull();
  });
});

describe("crossbreedableStock / crossedTrack", () => {
  it("names only kinds that actually appear in the matrix", () => {
    const stock = crossbreedableStock();
    for (const kind of stock) {
      expect(CROSSBREED_MATRIX.some((e) => e.a === kind || e.b === kind)).toBe(true);
    }
  });

  it("classifies crop/livestock/mixed pairings correctly", () => {
    expect(crossedTrack("sprout", "cash_crop")).toBe("crop");
    expect(crossedTrack("hen", "pig")).toBe("livestock");
    expect(crossedTrack("sprout", "hen")).toBe("mixed");
  });
});

describe("evaluateMutationChance", () => {
  it("throws for a plot id absent from the snapshot", () => {
    expect(() => evaluateMutationChance("ghost", [plot("a", 0, 0, "sprout")])).toThrow(/no plot ghost/);
  });

  it("returns null for empty soil", () => {
    const grid = [plot("a", 0, 0, null), plot("b", 0, 1, "cash_crop")];
    expect(evaluateMutationChance("a", grid)).toBeNull();
  });

  it("returns null for a plot that has not ripened yet", () => {
    const grid = [plot("a", 0, 0, "sprout", false), plot("b", 0, 1, "cash_crop")];
    expect(evaluateMutationChance("a", grid)).toBeNull();
  });

  it("returns null when the only neighbor is not ripe", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "cash_crop", false)];
    expect(evaluateMutationChance("a", grid)).toBeNull();
  });

  it("returns null when the only neighbor is the same stock (no self-cross)", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "sprout")];
    expect(evaluateMutationChance("a", grid)).toBeNull();
  });

  it("returns null when a ripe neighbor pairs to nothing in the matrix", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "pig")];
    expect(evaluateMutationChance("a", grid)).toBeNull();
  });

  it("finds a qualifying neighbor by grid COORDINATE, not array order", () => {
    // Neighbor is listed first in the array, and at a coordinate the plot
    // does not sit adjacent to in list order -- only row/col math should
    // matter.
    const grid = [
      plot("far", 3, 3, "cash_crop"),
      plot("neighbor", 1, 0, "cash_crop"),
      plot("a", 0, 0, "sprout"),
    ];
    const evaluation = evaluateMutationChance("a", grid);
    expect(evaluation).not.toBeNull();
    expect(evaluation?.neighborPlotId).toBe("neighbor");
    expect(evaluation?.direction).toBe("south");
    expect(evaluation?.hybrid).toBe("golden_maize");
  });

  it("checks all four directions and ignores neighbors off the edge of the bed", () => {
    // Corner plot (0,0): north and west fall outside the grid and must never
    // be treated as a match even if something happened to occupy that id.
    const grid = [plot("a", 0, 0, "sprout"), plot("e", 0, 1, "cash_crop"), plot("s", 1, 0, "hen")];
    const evaluation = evaluateMutationChance("a", grid);
    expect(evaluation).not.toBeNull();
    // Two qualifying neighbors (east: sprout+cash_crop 0.18, south: sprout+hen 0.1)
    // -- the higher chance wins.
    expect(evaluation?.neighborPlotId).toBe("e");
    expect(evaluation?.hybrid).toBe("golden_maize");
  });

  it("breaks a genuine tie in chance by north-south-east-west scan order", () => {
    // Craft two directions with equal chance by using the same matrix pair
    // twice from two different neighbors.
    const grid = [
      plot("a", 1, 1, "sprout"),
      plot("north", 0, 1, "cash_crop"),
      plot("east", 1, 2, "cash_crop"),
    ];
    const evaluation = evaluateMutationChance("a", grid);
    expect(evaluation?.neighborPlotId).toBe("north");
    expect(evaluation?.direction).toBe("north");
  });
});

describe("rollCrossbreedMutation", () => {
  it("never rolls true for a null evaluation", () => {
    expect(rollCrossbreedMutation(null, ALWAYS_ROLL)).toBe(false);
  });

  it("rolls true only when random() lands under the evaluation's chance", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "cash_crop")];
    const evaluation = evaluateMutationChance("a", grid);
    expect(rollCrossbreedMutation(evaluation, ALWAYS_ROLL)).toBe(true);
    expect(rollCrossbreedMutation(evaluation, NO_ROLL)).toBe(false);
  });
});

describe("resolveCrossbreedHarvest", () => {
  it("clears only the harvested plot when nothing qualifies", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "pig")];
    const result = resolveCrossbreedHarvest("a", grid, ALWAYS_ROLL);
    expect(result).toEqual({ mutated: false, hybrid: null, clearedPlotIds: ["a"] });
  });

  it("clears only the harvested plot on a missed roll, leaving the neighbor growing", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "cash_crop")];
    const result = resolveCrossbreedHarvest("a", grid, NO_ROLL);
    expect(result).toEqual({ mutated: false, hybrid: null, clearedPlotIds: ["a"] });
  });

  it("clears BOTH original rows and reports the hybrid on a successful cross", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "cash_crop")];
    const result = resolveCrossbreedHarvest("a", grid, ALWAYS_ROLL);
    expect(result.mutated).toBe(true);
    expect(result.hybrid).toBe("golden_maize");
    expect(result.clearedPlotIds).toEqual(["a", "b"]);
  });

  it("harvesting the neighbor's own id resolves the identical pairing symmetrically", () => {
    const grid = [plot("a", 0, 0, "sprout"), plot("b", 0, 1, "cash_crop")];
    const result = resolveCrossbreedHarvest("b", grid, ALWAYS_ROLL);
    expect(result.mutated).toBe(true);
    expect(result.hybrid).toBe("golden_maize");
    expect(result.clearedPlotIds).toEqual(["b", "a"]);
  });
});

describe("isCrossbreedPlotReady / toCrossbreedBedPlot", () => {
  const READY_AT = "2026-09-05T00:10:00.000Z";
  const readyMs = Date.parse(READY_AT);

  it("is false before ready_at and true at or after it", () => {
    expect(isCrossbreedPlotReady({ readyAt: READY_AT }, readyMs - 1)).toBe(false);
    expect(isCrossbreedPlotReady({ readyAt: READY_AT }, readyMs)).toBe(true);
    expect(isCrossbreedPlotReady({ readyAt: READY_AT }, readyMs + 60_000)).toBe(true);
  });

  it("treats an unparsable timestamp as not ready, never as a crash", () => {
    expect(isCrossbreedPlotReady({ readyAt: "not-a-date" }, readyMs)).toBe(false);
  });

  it("adapts a stored row into the engine's own plot shape, ready flag included", () => {
    const row = { id: "p1", row: 2, col: 3, stock: "cattle" as const, readyAt: READY_AT };
    expect(toCrossbreedBedPlot(row, readyMs - 1)).toEqual({
      id: "p1",
      row: 2,
      col: 3,
      stock: "cattle",
      ready: false,
    });
    expect(toCrossbreedBedPlot(row, readyMs)).toEqual({
      id: "p1",
      row: 2,
      col: 3,
      stock: "cattle",
      ready: true,
    });
  });
});

describe("seededRandomForPlot", () => {
  it("is deterministic for the same plot id", () => {
    const a = seededRandomForPlot("plot-123");
    const b = seededRandomForPlot("plot-123");
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it("produces values in [0, 1)", () => {
    const random = seededRandomForPlot("plot-xyz");
    for (let i = 0; i < 20; i += 1) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs across plot ids (not a global constant stream)", () => {
    const a = seededRandomForPlot("plot-a")();
    const b = seededRandomForPlot("plot-b")();
    expect(a).not.toBe(b);
  });
});
