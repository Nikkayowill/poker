/**
 * What StackAcres produces, and what it is worth -- in GOLD, directly.
 *
 * THIS FILE USED TO BE THE MIDDLE OF A THREE-STEP LOOP. Collecting put produce
 * in a barn, selling produce at the store earned Bushels (the farm's own
 * currency), and a separate daily exchange window turned Bushels into Gold.
 * Bushels are gone: a harvest is now valued and paid in one step, and every
 * price in StackAcres is Gold.
 *
 * WHAT THAT DID NOT CHANGE, because it is the part that was load-bearing:
 * **the farm's maximum Gold output is still a flat daily constant per
 * player.** The exchange window was never what made the feature safe -- the
 * ceiling behind it was -- and the ceiling is still there, still flat, still
 * enforced in SQL, now applied to a harvest instead of to an exchange. See
 * ./exchange.ts, which kept the valve and lost the shopfront.
 *
 * THE CONVERSION, so the retune is auditable rather than a fresh set of
 * guesses: every Bushel number in StackAcres was multiplied by 2, which is
 * exactly what the exchange window paid for a Bushel. That leaves the internal
 * balance of the economy untouched -- seed against yield, muck at 40% of a
 * tier's net, a serving of feed under a tenth of what the animals that eat it
 * earn -- and it leaves the daily ceiling calibrated, because 50,000 Gold a
 * day was tuned against this exact rate.
 *
 * The values below are the FLOOR a future market would swing around, so they
 * are the numbers a retune has to keep honest.
 */

import { STACKACRES_STOCK, type StackAcresStock } from "./catalogue";

export const STACKACRES_ITEMS = ["carrot", "corn", "eggs", "wool", "milk"] as const;

export type StackAcresItem = (typeof STACKACRES_ITEMS)[number];

export function isStackAcresItem(value: string): value is StackAcresItem {
  return (STACKACRES_ITEMS as readonly string[]).includes(value);
}

export interface StackAcresItemDef {
  /** Singular name. Quantities read "3 Carrots" via `itemLabel`. */
  label: string;
  plural: string;
  /**
   * Name of a vector painter in components/arcade/stackacres/stackacres-art.ts
   * (its `PainterName` union). Kept as a plain string, same reason as
   * StackAcresToolDef.icon in ./tools.ts: this file stays free of a
   * components/ import, and the caller casts the name back for
   * `<StackAcresIcon>`.
   */
  icon: string;
  /** What one is worth at harvest, in Gold. */
  goldValue: number;
}

export const STACKACRES_ITEM_CATALOGUE: Readonly<Record<StackAcresItem, StackAcresItemDef>> = {
  carrot: { label: "Carrot", plural: "Carrots", icon: "ico-carrot", goldValue: 12 },
  corn: { label: "Corn", plural: "Corn", icon: "ico-corn", goldValue: 44 },
  eggs: { label: "Egg", plural: "Eggs", icon: "ico-egg", goldValue: 18 },
  wool: { label: "Fleece", plural: "Fleeces", icon: "ico-fleece", goldValue: 76 },
  milk: { label: "Milk", plural: "Milk", icon: "ico-milk", goldValue: 220 },
};

/** What one finished unit brings in. */
export interface StackAcresYield {
  item: StackAcresItem;
  quantity: number;
}

export const STACKACRES_YIELDS: Readonly<Record<StackAcresStock, StackAcresYield>> = {
  sprout: { item: "carrot", quantity: 3 },
  cash_crop: { item: "corn", quantity: 5 },
  hen: { item: "eggs", quantity: 4 },
  pig: { item: "wool", quantity: 6 },
  cattle: { item: "milk", quantity: 8 },
};

/** What one of `item` is worth in Gold. */
export function itemGoldValue(item: StackAcresItem): number {
  return STACKACRES_ITEM_CATALOGUE[item].goldValue;
}

/** What a finished unit of `stock` is worth in Gold, before any synergy. */
export function yieldValue(stock: StackAcresStock): number {
  const produce = STACKACRES_YIELDS[stock];
  return itemGoldValue(produce.item) * produce.quantity;
}

/** "3 Carrots", "1 Fleece". */
export function itemLabel(item: StackAcresItem, quantity: number): string {
  const def = STACKACRES_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}

/**
 * Sanity net: every stock must earn more than its seed, or the farm is a sink.
 *
 * Note this is the net BEFORE Land Maintenance, which is charged per day
 * against the whole estate rather than per cycle against a unit -- see
 * ./upkeep.ts. A tier that fails this check is broken on its own terms; a
 * tier that only fails it once upkeep is counted is a large farm, which is
 * what upkeep is for.
 */
export function netPerCycle(stock: StackAcresStock, seedCost: number): number {
  return yieldValue(stock) - seedCost;
}

export { STACKACRES_STOCK };
