/**
 * What StackAcres produces, and what one unit is worth if you sell it.
 *
 * THIS FILE USED TO PRICE AN AUTOMATIC HARVEST PAYOUT. A harvest no longer
 * pays Gold at all -- see lib/server/stackacres-service.ts's `harvestStackAcres`
 * and this file's own former header for that history. Collecting a unit now
 * always credits the shared processing inventory (./inventory.ts), the same
 * door wheat, flour, milk and wool already used. `sellPrice` below is what
 * the new Sell action (`sellStackAcresItem`) pays per unit on demand -- it is
 * a shelf price, not an automatic credit, and nothing here is paid until a
 * player actually sells.
 *
 * CROP ROSTER (2026-09-12): the 22 CraftPix crop ids are gone -- replaced
 * outright by the 16 Gr8FarmPack crop ids (see ./catalogue.ts's own header),
 * item id == crop id (StackAcresCrop in ./catalogue.ts) == icon suffix ==
 * sprite file prefix, all identical on purpose, same as before. "wheatsheaf"
 * here is a DIFFERENT item from machine-items.ts's own "wheat" (the Wheat
 * Plot's raw material) -- that one comes off the wheat-plot side table, not a
 * stocked unit, and the two never mix in one inventory row despite the
 * similar name (see catalogue.ts's header for why the ids had to differ).
 */

import { STACKACRES_STOCK, type StackAcresStock } from "./catalogue";

export const STACKACRES_ITEMS = [
  "eggs",
  "wool",
  "milk",
  // All 16 crops, tier order matching ./catalogue.ts's STACKACRES_CROPS.
  "lettuce",
  "spinach",
  "radish",
  "onion",
  "carrot",
  "potato",
  "cabbage",
  "broccoli",
  "pepper",
  "bell_pepper",
  "celery",
  "green_bean",
  "tomato",
  "corn",
  "eggplant",
  "wheatsheaf",
] as const;

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
  /** What one sells for, in Gold, through the Sell action. Not an automatic
   *  harvest payout any more -- see this file's own header. */
  sellPrice: number;
}

export const STACKACRES_ITEM_CATALOGUE: Readonly<Record<StackAcresItem, StackAcresItemDef>> = {
  eggs: { label: "Egg", plural: "Eggs", icon: "ico-egg", sellPrice: 18 },
  wool: { label: "Fleece", plural: "Fleeces", icon: "ico-fleece", sellPrice: 76 },
  milk: { label: "Milk", plural: "Milk", icon: "ico-milk", sellPrice: 220 },

  /* ---- Tier 1 (fast/cheap): sellPrice 2, yield quantity 1. Unchanged by the
   * 2026-09-12 crop-roster swap -- see catalogue.ts's TIER1 comment. ---- */
  lettuce: { label: "Lettuce", plural: "Lettuce", icon: "ico-lettuce", sellPrice: 2 },
  spinach: { label: "Spinach", plural: "Spinach", icon: "ico-spinach", sellPrice: 2 },
  radish: { label: "Radish", plural: "Radishes", icon: "ico-radish", sellPrice: 2 },
  onion: { label: "Onion", plural: "Onions", icon: "ico-onion", sellPrice: 2 },
  carrot: { label: "Carrot", plural: "Carrots", icon: "ico-carrot", sellPrice: 2 },
  potato: { label: "Potato", plural: "Potatoes", icon: "ico-potato", sellPrice: 2 },
  cabbage: { label: "Cabbage", plural: "Cabbages", icon: "ico-cabbage", sellPrice: 2 },

  /* ---- Tier 2 (medium): sellPrice 25, yield quantity 4. ---- */
  broccoli: { label: "Broccoli", plural: "Broccoli", icon: "ico-broccoli", sellPrice: 25 },
  pepper: { label: "Pepper", plural: "Peppers", icon: "ico-pepper", sellPrice: 25 },
  bell_pepper: { label: "Bell Pepper", plural: "Bell Peppers", icon: "ico-bell_pepper", sellPrice: 25 },
  celery: { label: "Celery", plural: "Celery", icon: "ico-celery", sellPrice: 25 },
  green_bean: { label: "Green Bean", plural: "Green Beans", icon: "ico-green_bean", sellPrice: 25 },
  tomato: { label: "Tomato", plural: "Tomatoes", icon: "ico-tomato", sellPrice: 25 },

  /* ---- Tier 3 (slow/valuable): sellPrice 44, yield quantity 5. ---- */
  corn: { label: "Corn", plural: "Corn", icon: "ico-corn", sellPrice: 44 },
  eggplant: { label: "Eggplant", plural: "Eggplants", icon: "ico-eggplant", sellPrice: 44 },
  // Own icon, "ico-wheatsheaf" -- NOT machine-items.ts's "ico-wheat" glyph,
  // which is a plain hand-drawn painter with no real sprite behind it. This
  // crop has real Gr8FarmPack art (wheatsheaf2.png) and gets the same
  // sprite-backed icon treatment every other crop here does.
  wheatsheaf: { label: "Wheat", plural: "Wheat", icon: "ico-wheatsheaf", sellPrice: 44 },
};

/** What one finished unit brings in. */
export interface StackAcresYield {
  item: StackAcresItem;
  quantity: number;
}

export const STACKACRES_YIELDS: Readonly<Record<StackAcresStock, StackAcresYield>> = {
  hen: { item: "eggs", quantity: 4 },
  pig: { item: "wool", quantity: 6 },
  cattle: { item: "milk", quantity: 8 },

  /* ---- All 16 crops: item id == stock id, always. Tier 1 quantity is 1,
   * tier 2 is 4, tier 3 is 5 -- see the tier comments in
   * STACKACRES_ITEM_CATALOGUE above. ---- */
  lettuce: { item: "lettuce", quantity: 1 },
  spinach: { item: "spinach", quantity: 1 },
  radish: { item: "radish", quantity: 1 },
  onion: { item: "onion", quantity: 1 },
  carrot: { item: "carrot", quantity: 1 },
  potato: { item: "potato", quantity: 1 },
  cabbage: { item: "cabbage", quantity: 1 },
  broccoli: { item: "broccoli", quantity: 4 },
  pepper: { item: "pepper", quantity: 4 },
  bell_pepper: { item: "bell_pepper", quantity: 4 },
  celery: { item: "celery", quantity: 4 },
  green_bean: { item: "green_bean", quantity: 4 },
  tomato: { item: "tomato", quantity: 4 },
  corn: { item: "corn", quantity: 5 },
  eggplant: { item: "eggplant", quantity: 5 },
  wheatsheaf: { item: "wheatsheaf", quantity: 5 },
};

/** What one of `item` sells for. */
export function itemSellPrice(item: StackAcresItem): number {
  return STACKACRES_ITEM_CATALOGUE[item].sellPrice;
}

/** What a finished unit of `stock` would sell for, before any synergy. */
export function yieldValue(stock: StackAcresStock): number {
  const produce = STACKACRES_YIELDS[stock];
  return itemSellPrice(produce.item) * produce.quantity;
}

/** "3 Carrots", "1 Fleece". */
export function itemLabel(item: StackAcresItem, quantity: number): string {
  const def = STACKACRES_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}

/**
 * Sanity net: every stock must sell for more than its seed, or the farm is a
 * sink.
 *
 * Note this is the net BEFORE Land Maintenance, which is now a standalone
 * daily wallet charge rather than something netted out of a per-unit sale --
 * see ./upkeep.ts.
 */
export function netPerCycle(stock: StackAcresStock, seedCost: number): number {
  return yieldValue(stock) - seedCost;
}

export { STACKACRES_STOCK };
