/**
 * One harvest, priced in one step.
 *
 * The whole of what a collection is worth is decided here, as a pure function
 * of the units being settled and what the day already took: gross, then the
 * Bountiful Harvest synergy, then Land Maintenance. Keeping it pure is what
 * lets the arithmetic be tested without a database, and keeping it in ONE
 * function is the point of the rewrite -- there is no longer a barn to fill, a
 * shelf to sell at and a window to queue at, each with its own rounding.
 *
 * ORDER MATTERS AND IS DELIBERATE:
 *
 *   1. **Gross** is the sum of each unit's snapshotted yield at today's value.
 *   2. **The synergy multiplies the gross**, not the net. A bonus is a reward
 *      for how the sweep was composed; letting upkeep land first would make
 *      the same three cattle worth different bonuses on different days.
 *   3. **Upkeep comes out last**, clamped at what the harvest is worth, so a
 *      collection is never negative. See ./upkeep.ts for why it is netted out
 *      rather than debited.
 *
 * WHAT IS SNAPSHOTTED AND WHAT IS NOT. `yieldQuantity` is snapshotted onto the
 * unit row at stocking and is read from there -- rule 3 in
 * stackacres-service.ts: a retune between stocking and harvest must not change
 * what the player agreed to. The per-item VALUE is read live, because that is
 * the price of produce at the moment it is sold and there was never an
 * agreement about it. That split is exactly what the three-step loop did
 * before this, and it is preserved rather than reinvented.
 */

import { STACKACRES_YIELDS, itemGoldValue, type StackAcresItem } from "./items";
import { applyBountifulHarvest, bountifulHarvest, type BountifulHarvest } from "./bounty";
import { stackacresUpkeepCharge } from "./upkeep";
import type { StackAcresStock } from "./catalogue";

/** A ready unit, as much of it as pricing needs. */
export interface HarvestCandidate {
  unitId: string;
  stock: StackAcresStock;
  /** Units of produce, snapshotted at stocking. Never re-read from the catalogue. */
  yieldQuantity: number;
}

/** What one unit contributed, before the sweep's synergy. */
export interface HarvestLine {
  unitId: string;
  stock: StackAcresStock;
  item: StackAcresItem;
  quantity: number;
  /** This line's share of the gross, in Gold. */
  gold: number;
}

export interface HarvestSettlement {
  lines: HarvestLine[];
  /** Every unit's yield at today's value, before any synergy. */
  gross: number;
  /** Which synergy applied, and what it multiplied by. */
  bounty: BountifulHarvest;
  /** Gold the synergy added. Zero when none applied. */
  bonus: number;
  /** Land Maintenance actually taken, never more than the harvest is worth. */
  upkeepCharged: number;
  /** What the player is paid, before the flat daily allowance is applied. */
  net: number;
}

/**
 * Prices a sweep.
 *
 * `upkeepDue` is what today still owes -- computed by the caller from the
 * estate's size and what previous harvests today already paid, so that this
 * function stays free of a clock and of the store.
 */
export function settleHarvest(
  units: readonly HarvestCandidate[],
  upkeepDue = 0,
): HarvestSettlement {
  const lines: HarvestLine[] = units.map((unit) => {
    const item = STACKACRES_YIELDS[unit.stock].item;
    return {
      unitId: unit.unitId,
      stock: unit.stock,
      item,
      quantity: unit.yieldQuantity,
      gold: itemGoldValue(item) * unit.yieldQuantity,
    };
  });

  const gross = lines.reduce((total, line) => total + line.gold, 0);
  const bounty = bountifulHarvest(units.map((unit) => unit.stock));
  const bonused = applyBountifulHarvest(gross, bounty);
  const upkeepCharged = stackacresUpkeepCharge(bonused, upkeepDue);

  return {
    lines,
    gross,
    bounty,
    bonus: bonused - gross,
    upkeepCharged,
    net: bonused - upkeepCharged,
  };
}

/** Every distinct item a sweep brought in, in catalogue order, for the toast. */
export function harvestTally(settlement: HarvestSettlement): { item: StackAcresItem; quantity: number }[] {
  const tally = new Map<StackAcresItem, number>();
  for (const line of settlement.lines) {
    tally.set(line.item, (tally.get(line.item) ?? 0) + line.quantity);
  }
  return [...tally].map(([item, quantity]) => ({ item, quantity }));
}
