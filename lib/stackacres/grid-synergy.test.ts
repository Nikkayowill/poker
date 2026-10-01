import { describe, expect, it } from "vitest";
import { createSoilMap } from "./soil";
import {
  orthogonalNeighbours,
  stockBySoilSlot,
  synergyBonusPct,
  synergyGrowthMultiplier,
  synergyYieldBonus,
  TIER4_SYNERGY,
} from "./grid-synergy";

describe("orthogonalNeighbours", () => {
  it("returns the four tiles touching a cell, no diagonals", () => {
    expect(orthogonalNeighbours(2, 3)).toEqual([
      { tx: 3, ty: 3 },
      { tx: 1, ty: 3 },
      { tx: 2, ty: 4 },
      { tx: 2, ty: 2 },
    ]);
  });
});

describe("stockBySoilSlot", () => {
  it("keys stock by soil slot, dropping units with no bed", () => {
    const bySlot = stockBySoilSlot([
      { soilSlot: 0, stock: "corn" },
      { soilSlot: null, stock: "hen" },
      { soilSlot: 2, stock: "lettuce" },
    ]);
    expect(bySlot.get(0)).toBe("corn");
    expect(bySlot.get(2)).toBe("lettuce");
    expect(bySlot.size).toBe(2);
  });
});

describe("synergyBonusPct", () => {
  // A plus-shape of five beds: a centre tile with all four orthogonal
  // neighbours planted. Order matches insertion, so slot 0 is the centre.
  function plusSoil() {
    return createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
      { tx: -1, ty: 0, order: 2, origin: "purchased" },
      { tx: 0, ty: 1, order: 3, origin: "purchased" },
      { tx: 0, ty: -1, order: 4, origin: "purchased" },
    ]);
  }

  it("is zero on an empty board", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    const bySlot = stockBySoilSlot([]);
    expect(synergyBonusPct("growthSpeed", soil, { tx: 0, ty: 0 }, bySlot)).toBe(0);
  });

  it("sums one neighbour's bonus", () => {
    const soil = plusSoil();
    const bySlot = stockBySoilSlot([{ soilSlot: 1, stock: "corn" }]);
    expect(synergyBonusPct("growthSpeed", soil, { tx: 0, ty: 0 }, bySlot)).toBe(
      TIER4_SYNERGY.corn!.bonusPct,
    );
  });

  it("adds up every matching neighbour, capped at the four orthogonal sides", () => {
    const soil = plusSoil();
    // corn (east), tomato (west), and eggplant (south) all touch the centre.
    // corn and tomato share the growthSpeed kind, so both count; eggplant's
    // yieldQty bonus does not.
    const bySlot = stockBySoilSlot([
      { soilSlot: 1, stock: "corn" },
      { soilSlot: 2, stock: "tomato" },
      { soilSlot: 3, stock: "eggplant" },
    ]);
    expect(synergyBonusPct("growthSpeed", soil, { tx: 0, ty: 0 }, bySlot)).toBe(
      TIER4_SYNERGY.corn!.bonusPct + TIER4_SYNERGY.tomato!.bonusPct,
    );
    expect(synergyBonusPct("yieldQty", soil, { tx: 0, ty: 0 }, bySlot)).toBe(
      TIER4_SYNERGY.eggplant!.bonusPct,
    );
  });

  it("ignores a non-Tier-4 neighbour entirely", () => {
    const soil = plusSoil();
    const bySlot = stockBySoilSlot([{ soilSlot: 1, stock: "lettuce" }]);
    expect(synergyBonusPct("growthSpeed", soil, { tx: 0, ty: 0 }, bySlot)).toBe(0);
  });

  it("does not buff a tile diagonally adjacent to a Tier 4 crop", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 1, order: 1, origin: "purchased" },
    ]);
    const bySlot = stockBySoilSlot([{ soilSlot: 1, stock: "corn" }]);
    expect(synergyBonusPct("growthSpeed", soil, { tx: 0, ty: 0 }, bySlot)).toBe(0);
  });

  it("does not buff a crop growing in the Tier 4 bed itself", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    const bySlot = stockBySoilSlot([{ soilSlot: 0, stock: "corn" }]);
    // corn's own tile is not one of its own orthogonal neighbours.
    expect(synergyBonusPct("growthSpeed", soil, { tx: 0, ty: 0 }, bySlot)).toBe(0);
  });
});

describe("synergyGrowthMultiplier", () => {
  it("returns exactly 1 with no bonus", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    expect(synergyGrowthMultiplier(soil, { tx: 0, ty: 0 }, stockBySoilSlot([]))).toBe(1);
  });

  it("returns a multiplier below 1 -- faster -- for a positive bonus", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    const bySlot = stockBySoilSlot([{ soilSlot: 1, stock: "corn" }]);
    const multiplier = synergyGrowthMultiplier(soil, { tx: 0, ty: 0 }, bySlot);
    expect(multiplier).toBeLessThan(1);
    expect(multiplier).toBeCloseTo(1 / 1.08, 5);
  });
});

describe("synergyYieldBonus", () => {
  it("floors a fractional bonus rather than rounding up a free unit", () => {
    const soil = createSoilMap([
      { tx: 0, ty: 0, order: 0, origin: "purchased" },
      { tx: 1, ty: 0, order: 1, origin: "purchased" },
    ]);
    const bySlot = stockBySoilSlot([{ soilSlot: 1, stock: "eggplant" }]);
    // base 5 * 8% = 0.4, floors to 0 -- an 8% bonus needs a bigger base yield
    // to ever pay out a whole extra unit, which is the honest behaviour for
    // a percentage bonus on a small number.
    expect(synergyYieldBonus(5, soil, { tx: 0, ty: 0 }, bySlot)).toBe(0);
    // base 20 * 8% = 1.6, floors to 1.
    expect(synergyYieldBonus(20, soil, { tx: 0, ty: 0 }, bySlot)).toBe(1);
  });

  it("is zero with no yieldQty neighbour", () => {
    const soil = createSoilMap([{ tx: 0, ty: 0, order: 0, origin: "purchased" }]);
    expect(synergyYieldBonus(100, soil, { tx: 0, ty: 0 }, stockBySoilSlot([]))).toBe(0);
  });
});
