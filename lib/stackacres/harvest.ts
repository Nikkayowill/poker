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
 *   3. **The Prestige Reset Valve's permanent multiplier rides alongside the
 *      synergy**, applied to the ALREADY-synergized amount, still before
 *      upkeep. See lib/stackacres/prestige.ts's own header for why this
 *      ordering is load-bearing rather than cosmetic: applying it after
 *      upkeep would let a permanent, ever-growing account-wide multiplier
 *      bypass the one sink every other Gold path here is subject to.
 *   4. **Upkeep comes out last**, clamped at what the harvest is worth, so a
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
 *
 * `lines`/`gross` are DELIBERATELY left unmultiplied by either the synergy or
 * the prestige multiplier -- see the doc comment on `HarvestLine.gold` --
 * because `homestead_harvests.payout` is written from exactly those numbers,
 * and lib/stackacres/prestige.ts's own eligibility math reads that ledger
 * back as the input to ITS multiplier. Multiplying the ledger by the
 * multiplier that ledger feeds would compound the prestige curve against
 * itself instead of measuring genuine farm activity.
 */

import { STACKACRES_YIELDS, itemGoldValue, type StackAcresItem } from "./items";
import { applyBountifulHarvest, bountifulHarvest, type BountifulHarvest } from "./bounty";
import { stackacresUpkeepCharge } from "./upkeep";
import { STACKACRES_PRESTIGE_BASE_MULTIPLIER } from "./prestige";
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
  /** The prestige multiplier this sweep was priced under. 1 for a profile that has never reset. */
  prestigeMultiplier: number;
  /** Gold the Prestige Reset Valve's multiplier added, on top of the synergy. Zero at the base multiplier. */
  prestigeBonus: number;
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
 *
 * `prestigeMultiplier` is the caller's own already-loaded value (see
 * `getPrestigeMultiplier` in lib/server/stackacres-service.ts) -- this
 * function stays synchronous and free of the store for the same reason
 * `upkeepDue` is a parameter rather than a profile id: it is what keeps the
 * arithmetic testable without a database. Defaults to
 * STACKACRES_PRESTIGE_BASE_MULTIPLIER (1), i.e. no effect, for every existing
 * call site and test that predates the valve.
 */
export function settleHarvest(
  units: readonly HarvestCandidate[],
  upkeepDue = 0,
  prestigeMultiplier: number = STACKACRES_PRESTIGE_BASE_MULTIPLIER,
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
  // FLOORED, same posture applyBountifulHarvest already takes: a multiplier
  // may not invent a Gold piece out of a rounding rule. Guarded at the base
  // multiplier rather than trusting the caller: a multiplier below 1 would
  // be a nerf wearing a reward's name, and settleHarvest has no way to know
  // whether a caller passed a corrupt read, so it refuses to ever pay out
  // less than the unboosted amount.
  const effectiveMultiplier = Math.max(STACKACRES_PRESTIGE_BASE_MULTIPLIER, prestigeMultiplier);
  const boosted = Math.floor(bonused * effectiveMultiplier);
  const upkeepCharged = stackacresUpkeepCharge(boosted, upkeepDue);

  return {
    lines,
    gross,
    bounty,
    bonus: bonused - gross,
    prestigeMultiplier: effectiveMultiplier,
    prestigeBonus: boosted - bonused,
    upkeepCharged,
    net: boosted - upkeepCharged,
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
