/**
 * Where one animal's serving comes from. Hens, cattle, hogs and steers eat
 * off the shelf, each from its own list (`HEN_FEED_ORDER` and the rest), one
 * item per serving, with the bought Feed Sack in its place in the line
 * (`servingOrder`), so they are always feedable. Every other animal eats from
 * the Feed Sack.
 *
 * Feed made for the animals comes before the sack: a hen's Spinach, Cattle
 * Feed, and a hog's corn. A hen's Wheat, Lettuce and Cabbage come after it.
 * The farm grows those for the mill and the kitchen, so a hen only eats them
 * once the sack is empty.
 *
 * A serving of Spinach also adds an egg to that hen's current batch
 * (`HEN_FEED_BONUS_EGGS`).
 *
 * The server (`spendServing` in lib/server/stackacres-service.ts) decides
 * for real; `planServings` is the same rule run over the client's own
 * counts so the optimistic prediction matches it.
 */

import { STACKACRES_MARKET_ANIMALS, isMarketLivestock, type StackAcresStock } from "./catalogue";
import type { StackAcresInventory } from "./inventory";

/** What a hen eats off the shelf, best first. */
export const HEN_FEED_ORDER = ["spinach", "wheat", "lettuce", "cabbage"] as const;

/** What cattle eat off the shelf. Cattle Feed is milled from corn. */
export const CATTLE_FEED_ORDER = ["cattle_feed"] as const;

/** What a hog eats off the shelf: milled feed first, since one corn grinds
 *  into four servings of it, then whole corn. Each serving puts on weight
 *  (STACKACRES_MARKET_ANIMALS in ./catalogue.ts). */
export const HOG_FEED_ORDER = ["cattle_feed", "corn"] as const;

/** What a steer eats off the shelf. */
export const STEER_FEED_ORDER = ["cattle_feed"] as const;

export type HenFeedItem = (typeof HEN_FEED_ORDER)[number];
export type CattleFeedItem = (typeof CATTLE_FEED_ORDER)[number];
export type HogFeedItem = (typeof HOG_FEED_ORDER)[number];
export type ShelfFeedItem = HenFeedItem | CattleFeedItem | HogFeedItem;

export type ServingSource = ShelfFeedItem | "feed";

/** Every item any animal eats off the shelf. */
export const SHELF_FEED_ITEMS: readonly ShelfFeedItem[] = [...HEN_FEED_ORDER, ...CATTLE_FEED_ORDER, "corn"];

/** The animals that eat off the shelf, and what the seed card calls their feed. */
export const SHELF_FEED_ORDERS = {
  hen: { order: HEN_FEED_ORDER, noun: "Hen" },
  cattle: { order: CATTLE_FEED_ORDER, noun: "Cattle" },
  hog: { order: HOG_FEED_ORDER, noun: "Hog" },
  steer: { order: STEER_FEED_ORDER, noun: "Steer" },
} as const satisfies Partial<Record<StackAcresStock, { order: readonly ShelfFeedItem[]; noun: string }>>;

type ShelfFedStock = keyof typeof SHELF_FEED_ORDERS;

/** Extra eggs one serving of each hen shelf item adds to the hen's batch. */
export const HEN_FEED_BONUS_EGGS: Readonly<Record<HenFeedItem, number>> = {
  spinach: 1,
  wheat: 0,
  lettuce: 0,
  cabbage: 0,
};

export function isHenFeedItem(item: string): item is HenFeedItem {
  return (HEN_FEED_ORDER as readonly string[]).includes(item);
}

function isShelfFedStock(stock: StackAcresStock): stock is ShelfFedStock {
  return stock in SHELF_FEED_ORDERS;
}

/** What `stock` eats off the shelf, best first. Empty for Feed-Sack-only animals. */
export function shelfFeedOrder(stock: StackAcresStock): readonly ShelfFeedItem[] {
  return isShelfFedStock(stock) ? SHELF_FEED_ORDERS[stock].order : [];
}

/** The hen's shelf items that wait until the Feed Sack is empty. */
const HEN_FEED_AFTER_SACK: readonly ShelfFeedItem[] = ["wheat", "lettuce", "cabbage"];

/** Where `stock`'s servings come from, first to last, with the Feed Sack
 *  ("feed") in its place. */
export function servingOrder(stock: StackAcresStock): readonly ServingSource[] {
  const shelf = shelfFeedOrder(stock);
  const after = shelf.filter((item) => HEN_FEED_AFTER_SACK.includes(item));
  return [...shelf.filter((item) => !after.includes(item)), "feed", ...after];
}

/** Extra eggs a serving from `source` adds. Only hen greens add any. */
export function servingBonusEggs(source: ServingSource): number {
  return isHenFeedItem(source) ? HEN_FEED_BONUS_EGGS[source] : 0;
}

/** Weight one serving from `source` puts on a hog or steer: 1 for what it
 *  fattens on, 0 for the Feed Sack or anything else. Before the cap. */
export function servingBonusWeight(stock: StackAcresStock, source: ServingSource): number {
  if (!isMarketLivestock(stock) || source === "feed") return 0;
  return (STACKACRES_MARKET_ANIMALS[stock].fattensOn as readonly string[]).includes(source) ? 1 : 0;
}

/**
 * What one serving adds to this animal's current batch (`feed_bonus`): extra
 * eggs for a hen, extra weight for a hog or steer, never past the market
 * animal's cap. `currentBonus` is what the batch already carries.
 */
export function servingBonus(stock: StackAcresStock, source: ServingSource, currentBonus: number): number {
  if (isMarketLivestock(stock)) {
    const room = Math.max(0, STACKACRES_MARKET_ANIMALS[stock].maxFeedWeight - Math.max(0, currentBonus));
    return Math.min(room, servingBonusWeight(stock, source));
  }
  return servingBonusEggs(source);
}

/** How many shelf servings `inventory` holds for `stock`. */
export function shelfFeedFor(stock: StackAcresStock, inventory: StackAcresInventory): number {
  return shelfFeedOrder(stock).reduce((total, item) => total + Math.max(0, inventory[item] ?? 0), 0);
}

/** The toast for a feeding that earned extra eggs, e.g. "Fed spinach: +1 egg!".
 *  Null when no serving earned any, so a plain feeding stays quiet. */
export function feedingToast(sources: readonly ServingSource[]): string | null {
  const bonusSources = HEN_FEED_ORDER.filter((item) => HEN_FEED_BONUS_EGGS[item] > 0 && sources.includes(item));
  const eggs = sources.reduce((total, source) => total + servingBonusEggs(source), 0);
  if (eggs === 0) return null;
  return `Fed ${bonusSources.join(" and ")}: +${eggs} egg${eggs === 1 ? "" : "s"}!`;
}

export interface ServingPlan {
  /** How many of the animals, in the order given, get fed. */
  fed: number;
  /** Where each fed animal's serving came from, in the same order. */
  sources: ServingSource[];
  /** Shelf items eaten, by item. Only items actually used appear. */
  shelfUsed: Partial<Record<ShelfFeedItem, number>>;
  feedUsed: number;
  bonusEggs: number;
}

/** The shelf counts a plan draws down, one per shelf feed item. */
export function shelfFeedLeft(inventory: StackAcresInventory): Record<ShelfFeedItem, number> {
  const left = {} as Record<ShelfFeedItem, number>;
  for (const item of SHELF_FEED_ITEMS) left[item] = Math.max(0, inventory[item] ?? 0);
  return left;
}

/**
 * Feeds `stocks` in order, one serving each, stopping at the first animal
 * nothing is left for. That stop matches the server's pen loop, which breaks
 * the moment a serving cannot be spent.
 */
export function planServings(
  stocks: readonly StackAcresStock[],
  inventory: StackAcresInventory,
  feed: number,
): ServingPlan {
  const left = shelfFeedLeft(inventory);
  let feedLeft = Math.max(0, feed);
  const sources: ServingSource[] = [];
  const shelfUsed: Partial<Record<ShelfFeedItem, number>> = {};
  for (const stock of stocks) {
    const source = servingOrder(stock).find((item) => (item === "feed" ? feedLeft > 0 : left[item] > 0));
    if (source === undefined) break;
    if (source === "feed") {
      feedLeft -= 1;
    } else {
      left[source] -= 1;
      shelfUsed[source] = (shelfUsed[source] ?? 0) + 1;
    }
    sources.push(source);
  }
  return {
    fed: sources.length,
    sources,
    shelfUsed,
    feedUsed: Math.max(0, feed) - feedLeft,
    bonusEggs: sources.reduce((total, source) => total + servingBonusEggs(source), 0),
  };
}
