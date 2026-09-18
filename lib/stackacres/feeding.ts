/**
 * Where one animal's serving comes from. Hens eat greens and grain from
 * inventory first, in `HEN_FEED_ORDER`, one item per serving, and fall back
 * to the bought Feed Sack, so a hen is always feedable. Every other animal
 * eats from the Feed Sack.
 *
 * A serving of Spinach also adds an egg to that hen's current batch
 * (`HEN_FEED_BONUS_EGGS`).
 *
 * The server (`spendServing` in lib/server/stackacres-service.ts) decides
 * for real; `planServings` is the same rule run over the client's own
 * counts so the optimistic prediction matches it.
 */

import type { StackAcresStock } from "./catalogue";
import type { StackAcresInventory } from "./inventory";

/** What a hen eats off the shelf, best first. */
export const HEN_FEED_ORDER = ["spinach", "wheat", "lettuce", "cabbage"] as const;

export type HenFeedItem = (typeof HEN_FEED_ORDER)[number];

export type ServingSource = HenFeedItem | "feed";

/** Extra eggs one serving of each shelf item adds to the hen's batch. */
export const HEN_FEED_BONUS_EGGS: Readonly<Record<HenFeedItem, number>> = {
  spinach: 1,
  wheat: 0,
  lettuce: 0,
  cabbage: 0,
};

export function isHenFeedItem(item: string): item is HenFeedItem {
  return (HEN_FEED_ORDER as readonly string[]).includes(item);
}

/** Whether `stock` eats off the shelf before touching the Feed Sack. */
export function eatsShelfFeed(stock: StackAcresStock): boolean {
  return stock === "hen";
}

/** Extra eggs a serving from `source` adds. The Feed Sack adds none. */
export function servingBonusEggs(source: ServingSource): number {
  return source === "feed" ? 0 : HEN_FEED_BONUS_EGGS[source];
}

/** How many hen servings the shelf holds, across every hen feed item. */
export function henFeedOnShelf(inventory: StackAcresInventory): number {
  return HEN_FEED_ORDER.reduce((total, item) => total + Math.max(0, inventory[item] ?? 0), 0);
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
  shelfUsed: Partial<Record<HenFeedItem, number>>;
  feedUsed: number;
  bonusEggs: number;
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
  const left: Record<HenFeedItem, number> = {
    spinach: Math.max(0, inventory.spinach ?? 0),
    wheat: Math.max(0, inventory.wheat ?? 0),
    lettuce: Math.max(0, inventory.lettuce ?? 0),
    cabbage: Math.max(0, inventory.cabbage ?? 0),
  };
  let feedLeft = Math.max(0, feed);
  const sources: ServingSource[] = [];
  const shelfUsed: Partial<Record<HenFeedItem, number>> = {};
  for (const stock of stocks) {
    const shelfItem = eatsShelfFeed(stock) ? HEN_FEED_ORDER.find((item) => left[item] > 0) : undefined;
    if (shelfItem) {
      left[shelfItem] -= 1;
      shelfUsed[shelfItem] = (shelfUsed[shelfItem] ?? 0) + 1;
      sources.push(shelfItem);
    } else if (feedLeft > 0) {
      feedLeft -= 1;
      sources.push("feed");
    } else {
      break;
    }
  }
  return {
    fed: sources.length,
    sources,
    shelfUsed,
    feedUsed: Math.max(0, feed) - feedLeft,
    bonusEggs: sources.reduce((total, source) => total + servingBonusEggs(source), 0),
  };
}
