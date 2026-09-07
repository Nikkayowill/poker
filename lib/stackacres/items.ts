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
 * earn -- and it leaves the daily ceiling calibrated, because 15,000 Gold a
 * day was tuned against this exact rate.
 *
 * The values below are the FLOOR a future market would swing around, so they
 * are the numbers a retune has to keep honest.
 *
 * CROP ROSTER (2026-09-07): `sprout`/`cash_crop` and their old carrot/corn
 * item definitions are gone -- replaced outright by all 22 CraftPix crop
 * ids, item id == crop id (StackAcresCrop in ./catalogue.ts) == icon suffix
 * == sprite file prefix, all identical on purpose. `carrot`/`corn` are still
 * here, but as ordinary tier-1/tier-3 crop entries now rather than a
 * separately-named item a sprout/cash_crop yield pointed at. "wheat1" here is
 * a DIFFERENT item from machine-items.ts's own "wheat" (MACHINE_RAW_ITEMS) --
 * that one comes off the wheat-plot side table, not a stocked unit, and the
 * two never mix in one inventory.
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
  /** What one is worth at harvest, in Gold. */
  goldValue: number;
}

export const STACKACRES_ITEM_CATALOGUE: Readonly<Record<StackAcresItem, StackAcresItemDef>> = {
  eggs: { label: "Egg", plural: "Eggs", icon: "ico-egg", goldValue: 18 },
  wool: { label: "Fleece", plural: "Fleeces", icon: "ico-fleece", goldValue: 76 },
  milk: { label: "Milk", plural: "Milk", icon: "ico-milk", goldValue: 220 },

  /* ---- Tier 1 (fast/cheap): goldValue 12, yield quantity 3. ---- */
  garlic: { label: "Garlic", plural: "Garlic", icon: "ico-garlic", goldValue: 12 },
  onion: { label: "Onion", plural: "Onions", icon: "ico-onion", goldValue: 12 },
  beet: { label: "Beet", plural: "Beets", icon: "ico-beet", goldValue: 12 },
  poppy: { label: "Poppy", plural: "Poppies", icon: "ico-poppy", goldValue: 12 },
  potato: { label: "Potato", plural: "Potatoes", icon: "ico-potato", goldValue: 12 },
  // Same numbers `sprout`'s old "carrot" item used to carry -- see
  // catalogue.ts's file header.
  carrot: { label: "Carrot", plural: "Carrots", icon: "ico-carrot", goldValue: 12 },
  cabbage: { label: "Cabbage", plural: "Cabbages", icon: "ico-cabbage", goldValue: 12 },

  /* ---- Tier 2 (medium): goldValue 25, yield quantity 4. ---- */
  cucumber: { label: "Cucumber", plural: "Cucumbers", icon: "ico-cucumber", goldValue: 25 },
  pepper: { label: "Pepper", plural: "Peppers", icon: "ico-pepper", goldValue: 25 },
  brokoly: { label: "Broccoli", plural: "Broccoli", icon: "ico-brokoly", goldValue: 25 },
  sunflower: { label: "Sunflower", plural: "Sunflowers", icon: "ico-sunflower", goldValue: 25 },
  sunflowe_broken: {
    label: "Wild Sunflower",
    plural: "Wild Sunflowers",
    icon: "ico-sunflowe_broken",
    goldValue: 25,
  },
  // Reuses the existing "ico-wheat" painter (machine-items.ts's wheat sheaf
  // glyph) rather than a second painter of the same name -- see this file's
  // own header on why the two "wheat"-named ids never collide.
  wheat1: { label: "Wheat", plural: "Wheat", icon: "ico-wheat", goldValue: 25 },
  tomato: { label: "Tomato", plural: "Tomatoes", icon: "ico-tomato", goldValue: 25 },

  /* ---- Tier 3 (slow/valuable): goldValue 44, yield quantity 5. ---- */
  // Same numbers `cash_crop`'s old "corn" item used to carry -- see
  // catalogue.ts's file header.
  corn: { label: "Corn", plural: "Corn", icon: "ico-corn", goldValue: 44 },
  corn2: { label: "Field Corn", plural: "Field Corn", icon: "ico-corn2", goldValue: 44 },
  eggplant: { label: "Eggplant", plural: "Eggplants", icon: "ico-eggplant", goldValue: 44 },
  // "Grapes"/"Muscat Grapes" are already plural-shaped nouns (sold by the
  // bunch, never "a grape" at this scale) -- plural equals the label, the
  // same uncountable shape Wheat/Winter Wheat use.
  grap: { label: "Grapes", plural: "Grapes", icon: "ico-grap", goldValue: 44 },
  grap2: { label: "Muscat Grapes", plural: "Muscat Grapes", icon: "ico-grap2", goldValue: 44 },
  pumpkin: { label: "Pumpkin", plural: "Pumpkins", icon: "ico-pumpkin", goldValue: 44 },
  wheat2: { label: "Winter Wheat", plural: "Winter Wheat", icon: "ico-wheat2", goldValue: 44 },
  artichoke: { label: "Artichoke", plural: "Artichokes", icon: "ico-artichoke", goldValue: 44 },
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
