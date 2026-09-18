/**
 * Where one animal's serving comes from. Hens eat Wheat from inventory
 * first, one Wheat per serving, and fall back to the bought Feed Sack, so a
 * hen is always feedable. Every other animal eats from the Feed Sack.
 *
 * The server (`spendServing` in lib/server/stackacres-service.ts) decides
 * for real; `planServings` is the same rule run over the client's own
 * counts so the optimistic prediction matches it.
 */

import type { StackAcresStock } from "./catalogue";

export type ServingSource = "wheat" | "feed";

/** Whether `stock` eats Wheat before touching the Feed Sack. */
export function eatsWheat(stock: StackAcresStock): boolean {
  return stock === "hen";
}

export interface ServingPlan {
  /** How many of the animals, in the order given, get fed. */
  fed: number;
  wheatUsed: number;
  feedUsed: number;
}

/**
 * Feeds `stocks` in order, one serving each, stopping at the first animal
 * nothing is left for. That stop matches the server's pen loop, which breaks
 * the moment a serving cannot be spent.
 */
export function planServings(stocks: readonly StackAcresStock[], wheat: number, feed: number): ServingPlan {
  let wheatLeft = Math.max(0, wheat);
  let feedLeft = Math.max(0, feed);
  let fed = 0;
  for (const stock of stocks) {
    if (eatsWheat(stock) && wheatLeft > 0) {
      wheatLeft -= 1;
    } else if (feedLeft > 0) {
      feedLeft -= 1;
    } else {
      break;
    }
    fed += 1;
  }
  return { fed, wheatUsed: Math.max(0, wheat) - wheatLeft, feedUsed: Math.max(0, feed) - feedLeft };
}
