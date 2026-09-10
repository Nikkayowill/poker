import { describe, expect, it } from "vitest";
import { harvestTally, settleHarvest, type HarvestCandidate } from "./harvest";
import { STACKACRES_YIELDS, itemSellPrice, yieldValue } from "./items";
import type { StackAcresStock } from "./catalogue";

let seq = 0;
function unit(stock: StackAcresStock, yieldQuantity?: number): HarvestCandidate {
  seq += 1;
  return {
    unitId: `u${seq}`,
    stock,
    yieldQuantity: yieldQuantity ?? STACKACRES_YIELDS[stock].quantity,
  };
}

/**
 * The harvest tally. A harvest credits inventory now and pays no Gold, so
 * this only has to get the per-line produce right plus the nominal gross
 * the ledger and Prestige eligibility read.
 */
describe("settleHarvest", () => {
  it("values a single unit at its snapshotted yield times today's sell price", () => {
    const settled = settleHarvest([unit("cattle")]);
    expect(settled.gross).toBe(yieldValue("cattle"));
    expect(settled.lines).toHaveLength(1);
    expect(settled.lines[0]).toMatchObject({ item: "milk", quantity: STACKACRES_YIELDS.cattle.quantity });
  });

  // Rule 3: the quantity comes off the row, only the per-item price is live.
  it("uses the row's snapshotted quantity, not the catalogue's current one", () => {
    const stale = unit("hen", 99);
    const settled = settleHarvest([stale]);
    expect(settled.gross).toBe(itemSellPrice("eggs") * 99);
    expect(settled.lines[0].quantity).toBe(99);
  });

  it("sums a sweep line by line", () => {
    const settled = settleHarvest([unit("carrot"), unit("cattle")]);
    expect(settled.gross).toBe(yieldValue("carrot") + yieldValue("cattle"));
    expect(settled.lines).toHaveLength(2);
    expect(settled.lines.map((line) => line.item)).toEqual(["carrot", "milk"]);
  });

  it("applies no sweep bonus any more, so three of a kind is just three times one", () => {
    const settled = settleHarvest([unit("hen"), unit("hen"), unit("hen")]);
    expect(settled.gross).toBe(yieldValue("hen") * 3);
    expect(settled).toEqual({ lines: settled.lines, gross: settled.gross });
  });

  it("settles an empty sweep at nothing rather than throwing", () => {
    const settled = settleHarvest([]);
    expect(settled).toEqual({ lines: [], gross: 0 });
  });

  it("keeps each line's gold equal to its own nominal value, which is what the ledger records", () => {
    const settled = settleHarvest([unit("cattle"), unit("hen")]);
    for (const line of settled.lines) {
      expect(line.gold).toBe(itemSellPrice(line.item) * line.quantity);
    }
    expect(settled.lines.reduce((sum, line) => sum + line.gold, 0)).toBe(settled.gross);
  });
});

describe("harvestTally", () => {
  it("sums a sweep per item, so five hen coops read as one line", () => {
    const settled = settleHarvest([unit("hen"), unit("hen"), unit("carrot")]);
    expect(harvestTally(settled)).toEqual([
      { item: "eggs", quantity: STACKACRES_YIELDS.hen.quantity * 2 },
      { item: "carrot", quantity: STACKACRES_YIELDS.carrot.quantity },
    ]);
  });
});
