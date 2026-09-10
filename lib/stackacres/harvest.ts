/**
 * One harvest, tallied in one step.
 *
 * A harvest no longer prices anything in Gold at all -- it settles into
 * inventory. What this module still owns is the arithmetic every gather-craft-
 * sell design needs to agree on: which item and how much each settled unit
 * contributed, summed per item for the credit and per line for bonus
 * quantity (crit, museum discovery) to apply against. Keeping it pure is what
 * lets that arithmetic be tested without a database.
 *
 * THIS USED TO ALSO CARRY BOUNTIFUL HARVEST, THE PRESTIGE MULTIPLIER AND LAND
 * MAINTENANCE, all multiplying or netting a Gold payout that no longer
 * exists. Bountiful Harvest is retired outright (see the deleted
 * lib/stackacres/bounty.ts) -- a sweep-composition bonus has no clean meaning
 * against "sum the produce," and re-deriving one was explicitly out of scope
 * for this pass. The Prestige Reset Valve's multiplier moved to the Sell
 * action (lib/server/stackacres-service.ts's `sellStackAcresItem`), since
 * that is StackAcres' only Gold-paying step now. Land Maintenance moved to a
 * standalone daily wallet debit (`assessStackAcresUpkeep`), since it can no
 * longer be netted out of a payout this function does not produce.
 *
 * `lines`/`gross` still exist because `homestead_harvests.payout` is written
 * from exactly these numbers -- see the write site in stackacres-service.ts.
 * That ledger is now a pure PRODUCTION record (what was grown, valued at
 * today's sell price) rather than "what was paid", and Prestige's own
 * eligibility math (lib/stackacres/prestige.ts) still reads it as gross
 * lifetime production, unaffected by that reframing.
 */

import { STACKACRES_YIELDS, itemSellPrice, type StackAcresItem } from "./items";
import type { StackAcresStock } from "./catalogue";

/** A ready unit, as much of it as tallying needs. */
export interface HarvestCandidate {
  unitId: string;
  stock: StackAcresStock;
  /** Units of produce, snapshotted at stocking. Never re-read from the catalogue. */
  yieldQuantity: number;
}

/** What one unit contributed. */
export interface HarvestLine {
  unitId: string;
  stock: StackAcresStock;
  item: StackAcresItem;
  quantity: number;
  /** This line's nominal value at today's sell price -- a production figure
   *  for the ledger and for Prestige eligibility, not Gold actually paid. */
  gold: number;
}

export interface HarvestSettlement {
  lines: HarvestLine[];
  /** Every unit's yield valued at today's sell price. A production figure,
   *  written to `homestead_harvests.payout` for Prestige eligibility -- see
   *  this module's own header. */
  gross: number;
}

/** Tallies a sweep: what each unit contributed, and the sweep's total
 *  nominal value. */
export function settleHarvest(units: readonly HarvestCandidate[]): HarvestSettlement {
  const lines: HarvestLine[] = units.map((unit) => {
    const item = STACKACRES_YIELDS[unit.stock].item;
    return {
      unitId: unit.unitId,
      stock: unit.stock,
      item,
      quantity: unit.yieldQuantity,
      gold: itemSellPrice(item) * unit.yieldQuantity,
    };
  });

  const gross = lines.reduce((total, line) => total + line.gold, 0);

  return { lines, gross };
}

/** Every distinct item a sweep brought in, in catalogue order, for the toast. */
export function harvestTally(settlement: HarvestSettlement): { item: StackAcresItem; quantity: number }[] {
  const tally = new Map<StackAcresItem, number>();
  for (const line of settlement.lines) {
    tally.set(line.item, (tally.get(line.item) ?? 0) + line.quantity);
  }
  return [...tally].map(([item, quantity]) => ({ item, quantity }));
}
