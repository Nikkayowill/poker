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
 * CROP ROSTER (2026-09-07): `sprout`/`cash_crop` and their old carrot/corn
 * item definitions are gone -- replaced outright by all 22 CraftPix crop
 * ids, item id == crop id (StackAcresCrop in ./catalogue.ts) == icon suffix
 * == sprite file prefix, all identical on purpose. `carrot`/`corn` are still
 * here, but as ordinary tier-1/tier-3 crop entries now rather than a
 * separately-named item a sprout/cash_crop yield pointed at. "wheat1" here is
 * a DIFFERENT item from machine-items.ts's own "wheat" (the Wheat Plot's raw
 * material) -- that one comes off the wheat-plot side table, not a stocked
 * unit, and the two never mix in one inventory row despite the shared name.
 */

import { STACKACRES_STOCK, type StackAcresStock } from "./catalogue";

export const STACKACRES_ITEMS = [
  "eggs",
  "wool",
  "milk",
  // All 22 crops, tier order matching ./catalogue.ts's STACKACRES_CROPS.
  "garlic",
  "onion",
  "beet",
  "poppy",
  "potato",
  "carrot",
  "cabbage",
  "cucumber",
  "pepper",
  "brokoly",
  "sunflower",
  "sunflowe_broken",
  "wheat1",
  "tomato",
  "corn",
  "corn2",
  "eggplant",
  "grap",
  "grap2",
  "pumpkin",
  "wheat2",
  "artichoke",
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

  /* ---- Tier 1 (fast/cheap): sellPrice 12, yield quantity 3. ---- */
  garlic: { label: "Garlic", plural: "Garlic", icon: "ico-garlic", sellPrice: 12 },
  onion: { label: "Onion", plural: "Onions", icon: "ico-onion", sellPrice: 12 },
  beet: { label: "Beet", plural: "Beets", icon: "ico-beet", sellPrice: 12 },
  poppy: { label: "Poppy", plural: "Poppies", icon: "ico-poppy", sellPrice: 12 },
  potato: { label: "Potato", plural: "Potatoes", icon: "ico-potato", sellPrice: 12 },
  // Same numbers `sprout`'s old "carrot" item used to carry -- see
  // catalogue.ts's file header.
  carrot: { label: "Carrot", plural: "Carrots", icon: "ico-carrot", sellPrice: 12 },
  cabbage: { label: "Cabbage", plural: "Cabbages", icon: "ico-cabbage", sellPrice: 12 },

  /* ---- Tier 2 (medium): sellPrice 25, yield quantity 4. ---- */
  cucumber: { label: "Cucumber", plural: "Cucumbers", icon: "ico-cucumber", sellPrice: 25 },
  pepper: { label: "Pepper", plural: "Peppers", icon: "ico-pepper", sellPrice: 25 },
  brokoly: { label: "Broccoli", plural: "Broccoli", icon: "ico-brokoly", sellPrice: 25 },
  sunflower: { label: "Sunflower", plural: "Sunflowers", icon: "ico-sunflower", sellPrice: 25 },
  sunflowe_broken: {
    label: "Wild Sunflower",
    plural: "Wild Sunflowers",
    icon: "ico-sunflowe_broken",
    sellPrice: 25,
  },
  // Reuses the existing "ico-wheat" painter (machine-items.ts's wheat sheaf
  // glyph) rather than a second painter of the same name -- see this file's
  // own header on why the two "wheat"-named ids never collide.
  wheat1: { label: "Wheat", plural: "Wheat", icon: "ico-wheat", sellPrice: 25 },
  tomato: { label: "Tomato", plural: "Tomatoes", icon: "ico-tomato", sellPrice: 25 },

  /* ---- Tier 3 (slow/valuable): sellPrice 44, yield quantity 5. ---- */
  // Same numbers `cash_crop`'s old "corn" item used to carry -- see
  // catalogue.ts's file header.
  corn: { label: "Corn", plural: "Corn", icon: "ico-corn", sellPrice: 44 },
  corn2: { label: "Field Corn", plural: "Field Corn", icon: "ico-corn2", sellPrice: 44 },
  eggplant: { label: "Eggplant", plural: "Eggplants", icon: "ico-eggplant", sellPrice: 44 },
  // "Grapes"/"Muscat Grapes" are already plural-shaped nouns (sold by the
  // bunch, never "a grape" at this scale) -- plural equals the label, the
  // same uncountable shape Wheat/Winter Wheat use.
  grap: { label: "Grapes", plural: "Grapes", icon: "ico-grap", sellPrice: 44 },
  grap2: { label: "Muscat Grapes", plural: "Muscat Grapes", icon: "ico-grap2", sellPrice: 44 },
  pumpkin: { label: "Pumpkin", plural: "Pumpkins", icon: "ico-pumpkin", sellPrice: 44 },
  wheat2: { label: "Winter Wheat", plural: "Winter Wheat", icon: "ico-wheat2", sellPrice: 44 },
  artichoke: { label: "Artichoke", plural: "Artichokes", icon: "ico-artichoke", sellPrice: 44 },
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

  /* ---- All 22 crops: item id == stock id, always. ---- */
  garlic: { item: "garlic", quantity: 3 },
  onion: { item: "onion", quantity: 3 },
  beet: { item: "beet", quantity: 3 },
  poppy: { item: "poppy", quantity: 3 },
  potato: { item: "potato", quantity: 3 },
  carrot: { item: "carrot", quantity: 3 },
  cabbage: { item: "cabbage", quantity: 3 },
  cucumber: { item: "cucumber", quantity: 4 },
  pepper: { item: "pepper", quantity: 4 },
  brokoly: { item: "brokoly", quantity: 4 },
  sunflower: { item: "sunflower", quantity: 4 },
  sunflowe_broken: { item: "sunflowe_broken", quantity: 4 },
  wheat1: { item: "wheat1", quantity: 4 },
  tomato: { item: "tomato", quantity: 4 },
  corn: { item: "corn", quantity: 5 },
  corn2: { item: "corn2", quantity: 5 },
  eggplant: { item: "eggplant", quantity: 5 },
  grap: { item: "grap", quantity: 5 },
  grap2: { item: "grap2", quantity: 5 },
  pumpkin: { item: "pumpkin", quantity: 5 },
  wheat2: { item: "wheat2", quantity: 5 },
  artichoke: { item: "artichoke", quantity: 5 },
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
