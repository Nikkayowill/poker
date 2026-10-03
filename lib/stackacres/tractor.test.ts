import { describe, expect, it } from "vitest";
import {
  STACKACRES_EQUIPMENT_DEFS,
  TRACTOR_ROW_LENGTH,
  TRACTOR_ROW_MAX,
  isStraightRow,
  ownedStackAcresEquipment,
  tilesAhead,
  workableRun,
} from "./tractor";

describe("tilesAhead", () => {
  it("starts on the front bed and runs the way the tractor faces", () => {
    expect(tilesAhead({ tx: 3, ty: 4 }, "right", 3)).toEqual([
      { tx: 3, ty: 4 },
      { tx: 4, ty: 4 },
      { tx: 5, ty: 4 },
    ]);
    expect(tilesAhead({ tx: 3, ty: 4 }, "up", 2)).toEqual([
      { tx: 3, ty: 4 },
      { tx: 3, ty: 3 },
    ]);
    expect(tilesAhead({ tx: 0, ty: 0 }, "left", 2)).toEqual([
      { tx: 0, ty: 0 },
      { tx: -1, ty: 0 },
    ]);
    expect(tilesAhead({ tx: 0, ty: 0 }, "down", 2)).toEqual([
      { tx: 0, ty: 0 },
      { tx: 0, ty: 1 },
    ]);
  });

  it("works six beds by default", () => {
    expect(tilesAhead({ tx: 0, ty: 0 }, "down")).toHaveLength(TRACTOR_ROW_LENGTH);
    expect(TRACTOR_ROW_LENGTH).toBe(6);
  });
});

describe("workableRun", () => {
  it("stops at the first bed that cannot be worked, so the row stays unbroken", () => {
    const row = tilesAhead({ tx: 0, ty: 0 }, "right", 6);
    expect(workableRun(row, (tile) => tile.tx !== 3)).toEqual(row.slice(0, 3));
  });

  it("is empty when the front bed cannot be worked", () => {
    expect(workableRun(tilesAhead({ tx: 0, ty: 0 }, "right", 6), (tile) => tile.tx !== 0)).toEqual([]);
  });
});

describe("isStraightRow", () => {
  it("takes an unbroken row along either axis, in any order", () => {
    expect(isStraightRow(tilesAhead({ tx: 2, ty: 2 }, "right", 4))).toBe(true);
    expect(isStraightRow(tilesAhead({ tx: 2, ty: 2 }, "up", 6))).toBe(true);
    expect(isStraightRow([{ tx: 5, ty: 1 }, { tx: 3, ty: 1 }, { tx: 4, ty: 1 }])).toBe(true);
  });

  it("refuses beds off the line", () => {
    expect(isStraightRow([{ tx: 0, ty: 0 }, { tx: 1, ty: 1 }])).toBe(false);
    expect(isStraightRow([{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, { tx: 2, ty: 1 }])).toBe(false);
  });

  it("refuses a gap or a bed named twice", () => {
    expect(isStraightRow([{ tx: 0, ty: 0 }, { tx: 2, ty: 0 }])).toBe(false);
    expect(isStraightRow([{ tx: 0, ty: 0 }, { tx: 0, ty: 0 }])).toBe(false);
    expect(isStraightRow([{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, { tx: 1, ty: 0 }])).toBe(false);
  });

  it("refuses one bed and anything past the longest row", () => {
    expect(isStraightRow([{ tx: 0, ty: 0 }])).toBe(false);
    expect(isStraightRow(tilesAhead({ tx: 0, ty: 0 }, "right", TRACTOR_ROW_MAX))).toBe(true);
    expect(isStraightRow(tilesAhead({ tx: 0, ty: 0 }, "right", TRACTOR_ROW_MAX + 1))).toBe(false);
  });
});

describe("ownedStackAcresEquipment", () => {
  it("keeps known machines in catalogue order and drops the rest", () => {
    expect(ownedStackAcresEquipment(["combine", "plough", "tractor", "tractor"])).toEqual(["tractor", "combine"]);
    expect(ownedStackAcresEquipment([])).toEqual([]);
  });
});

it("prices the tractor at 12,000 Gold and 8 Metal", () => {
  expect(STACKACRES_EQUIPMENT_DEFS.tractor).toMatchObject({ gold: 12_000, metal: 8 });
});
