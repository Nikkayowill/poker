/**
 * What the Homestead produces, and what it is worth.
 *
 * Phase 2 breaks the old loop in half. Collecting a plot used to credit Gold
 * directly; now it yields ITEMS into a bag, and turning those into money is a
 * separate, deliberate act at the supply store. That is farmhand's shape, and
 * it is the shape phase 4 needs: a market can only swing a price if there is
 * something you are holding while it swings.
 *
 * Everything here is priced in BUSHELS, the farm's own currency, which never
 * leaves the Homestead. That is the whole safety argument for the rest of this
 * feature: prices can move, crafting can have margins and a bug here costs a
 * save state rather than money. Gold touches the farm in exactly one place --
 * buying acreage -- and leaves it in exactly one place, the daily exchange
 * window that phase 3 builds.
 *
 * The sale prices below are the FLOOR the market will later swing around, so
 * they are the numbers a retune has to keep honest. Until phase 4 they are
 * simply the price.
 */

import { HOMESTEAD_STOCK, type HomesteadStock } from "./catalogue";

export const HOMESTEAD_ITEMS = ["carrot", "corn", "eggs", "wool", "milk"] as const;

export type HomesteadItem = (typeof HOMESTEAD_ITEMS)[number];

/**
 * The currency's own key in the inventory store. It shares a table with the
 * items because it is the same primitive -- a non-negative per-player counter
 * behind one row-locking RPC -- and one RPC is one EXECUTE grant to get right.
 * That has been shipped wrong twice; see the revoke idiom in the migration.
 */
export const BUSHELS = "bushels";

/** Every key the inventory store accepts, so a typo cannot invent a currency. */
export const HOMESTEAD_INVENTORY_KEYS: readonly string[] = [BUSHELS, ...HOMESTEAD_ITEMS];

export function isHomesteadItem(value: string): value is HomesteadItem {
  return (HOMESTEAD_ITEMS as readonly string[]).includes(value);
}

export interface HomesteadItemDef {
  /** Singular name. Quantities read "3 Carrots" via `itemLabel`. */
  label: string;
  plural: string;
  /**
   * Name of a vector painter in components/arcade/homestead/homestead-art.ts
   * (its `PainterName` union). Kept as a plain string, same reason as
   * HomesteadToolDef.icon in ./tools.ts: this file stays free of a
   * components/ import, and the store casts the name back for
   * `<HomesteadIcon>`.
   */
  icon: string;
  /** What the store pays for one, in Bushels. */
  price: number;
}

export const HOMESTEAD_ITEM_CATALOGUE: Readonly<Record<HomesteadItem, HomesteadItemDef>> = {
  carrot: { label: "Carrot", plural: "Carrots", icon: "ico-carrot", price: 6 },
  corn: { label: "Corn", plural: "Corn", icon: "ico-corn", price: 22 },
  eggs: { label: "Egg", plural: "Eggs", icon: "ico-egg", price: 9 },
  wool: { label: "Fleece", plural: "Fleeces", icon: "ico-fleece", price: 38 },
  milk: { label: "Milk", plural: "Milk", icon: "ico-milk", price: 110 },
};

/** What one finished plot puts in the bag. */
export interface HomesteadYield {
  item: HomesteadItem;
  quantity: number;
}

export const HOMESTEAD_YIELDS: Readonly<Record<HomesteadStock, HomesteadYield>> = {
  sprout: { item: "carrot", quantity: 3 },
  cash_crop: { item: "corn", quantity: 5 },
  hen: { item: "eggs", quantity: 4 },
  pig: { item: "wool", quantity: 6 },
  cattle: { item: "milk", quantity: 8 },
};

/** What a finished plot is worth if sold at today's price, in Bushels. */
export function yieldValue(stock: HomesteadStock): number {
  const produce = HOMESTEAD_YIELDS[stock];
  return HOMESTEAD_ITEM_CATALOGUE[produce.item].price * produce.quantity;
}

/** "3 Carrots", "1 Fleece". */
export function itemLabel(item: HomesteadItem, quantity: number): string {
  const def = HOMESTEAD_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}

/**
 * What a brand-new farm is handed, once. Enough for a run at any of the two
 * cheapest tiers with room to make a mistake -- roughly fifteen Sprout Rows,
 * or six Hen Coops, or two Cash Crops.
 *
 * Granted by INSERT ... ON CONFLICT DO NOTHING on the inventory row, so the
 * primary key is the idempotency guard: a profile that already has a bushels
 * row is never topped up, even at zero. There is deliberately no second way to
 * receive this.
 */
export const HOMESTEAD_STARTING_BUSHELS = 150;

/** Sanity net: every stock must earn more than its seed, or the farm is a sink. */
export function netPerCycle(stock: HomesteadStock, seedCost: number): number {
  return yieldValue(stock) - seedCost;
}

export { HOMESTEAD_STOCK };
