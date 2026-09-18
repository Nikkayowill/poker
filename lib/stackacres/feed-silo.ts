/**
 * The Feed Silo: a hen or cattle that went hungry is fed from the barn as of
 * the moment it went hungry, so its clock loses no time and its batch pays
 * as if it had been fed on time.
 *
 * Nothing here is simulated tick by tick. Given a unit's stored
 * `lastFedAt`/`readyAt` and `now`, the servings it would have needed are
 * worked out from elapsed time. The server runs this only inside a write
 * (`workStackAcres` and a harvest), never on a read.
 *
 * Two caps keep it from printing produce. It spends real servings from the
 * feed order, so an empty barn stops it. And it feeds at most
 * `FEED_SILO_DAILY_FEEDS` servings per farm per UTC day.
 *
 * It works off the stored row, not `effectiveStackAcresCycle`: a hen the
 * Silo fed on time never spoiled, so the spoil fast-forward does not apply.
 */

import { STACKACRES_CATALOGUE, type StackAcresStock } from "./catalogue";
import {
  servingBonusEggs,
  shelfFeedLeft,
  shelfFeedOrder,
  type ServingSource,
  type ShelfFeedItem,
} from "./feeding";
import type { StackAcresInventory } from "./inventory";

/** Servings the Silo may hand out per farm per UTC day. Kept in step by hand
 *  with the `homestead_machines_auto_feeds_check` constraint. */
export const FEED_SILO_DAILY_FEEDS = 48;

export interface SiloCounter {
  /** The UTC day `autoFeeds` counts, or null before the Silo's first feed. */
  autoFeedDay: string | null;
  autoFeeds: number;
}

/** Servings already handed out on `day`. A counter from an earlier day is 0. */
export function siloFeedsUsed(counter: SiloCounter, day: string): number {
  return counter.autoFeedDay === day ? counter.autoFeeds : 0;
}

/** Servings the Silo can still hand out on `day`. */
export function siloFeedsLeft(counter: SiloCounter, day: string): number {
  return Math.max(0, FEED_SILO_DAILY_FEEDS - siloFeedsUsed(counter, day));
}

/** What the Silo feeds `stock` off the shelf, before the Feed Sack. It skips
 *  anything that earns a bonus (Spinach's extra egg), so that bonus stays a
 *  reward for feeding by hand. */
export function siloFeedOrder(stock: StackAcresStock): readonly ShelfFeedItem[] {
  return shelfFeedOrder(stock).filter((item) => servingBonusEggs(item) === 0);
}

export interface SiloUnit {
  id: string;
  stock: StackAcresStock;
  status: string;
  lastFedAt: string | null;
  readyAt: string;
}

export interface SiloFeeding {
  unitId: string;
  /** Where each serving came from, in order. */
  sources: ServingSource[];
  /** The moment each serving counts as eaten, same order as `sources`. The
   *  last one is the unit's new `lastFedAt`. */
  fedAts: string[];
}

export interface SiloPlan {
  feedings: SiloFeeding[];
  servings: number;
  shelfUsed: Partial<Record<ShelfFeedItem, number>>;
  feedUsed: number;
}

/**
 * When a unit last fed at `lastFedMs` next needs a serving, or null if it is
 * not hungry by `nowMs`.
 *
 * A hunger that lands mid-batch is fed at that exact moment. A hunger that
 * lands once the batch is already done gains no produce by being fed on
 * schedule, so it takes one serving at its latest hunger moment, just enough
 * to leave the animal collectable now.
 */
function nextServingMs(lastFedMs: number, hungerMs: number, readyMs: number, nowMs: number): number | null {
  const hungryMs = lastFedMs + hungerMs;
  if (hungryMs > nowMs) return null;
  if (hungryMs < readyMs) return hungryMs;
  return hungryMs + Math.floor((nowMs - hungryMs) / hungerMs) * hungerMs;
}

interface PlanState {
  unit: SiloUnit;
  hungerMs: number;
  readyMs: number;
  lastFedMs: number;
  sources: ServingSource[];
  fedAts: string[];
  stopped: boolean;
}

/**
 * Plans every serving the Silo hands out, earliest hunger first across the
 * whole farm, until the barn runs out for an animal, `budget` is spent, or
 * nobody is hungry before `now`. An animal nothing is left for stays hungry,
 * as it would without a Silo.
 */
export function planSiloFeeding(
  units: readonly SiloUnit[],
  inventory: StackAcresInventory,
  feed: number,
  budget: number,
  now: Date,
): SiloPlan {
  const nowMs = now.getTime();
  const left = shelfFeedLeft(inventory);
  let feedLeft = Math.max(0, feed);
  let budgetLeft = Math.max(0, budget);
  const shelfUsed: Partial<Record<ShelfFeedItem, number>> = {};

  const states: PlanState[] = [];
  for (const unit of units) {
    const hungerMs = STACKACRES_CATALOGUE[unit.stock].hungerMs;
    if (unit.status !== "working" || hungerMs === null || hungerMs <= 0 || !unit.lastFedAt) continue;
    const lastFedMs = Date.parse(unit.lastFedAt);
    const readyMs = Date.parse(unit.readyAt);
    if (!Number.isFinite(lastFedMs) || !Number.isFinite(readyMs)) continue;
    states.push({ unit, hungerMs, readyMs, lastFedMs, sources: [], fedAts: [], stopped: false });
  }

  let servings = 0;
  while (budgetLeft > 0) {
    let next: PlanState | null = null;
    let nextMs = Infinity;
    for (const state of states) {
      if (state.stopped) continue;
      const at = nextServingMs(state.lastFedMs, state.hungerMs, state.readyMs, nowMs);
      if (at === null) {
        state.stopped = true;
      } else if (at < nextMs) {
        next = state;
        nextMs = at;
      }
    }
    if (!next) break;

    const shelfItem = siloFeedOrder(next.unit.stock).find((item) => left[item] > 0);
    let source: ServingSource;
    if (shelfItem) {
      left[shelfItem] -= 1;
      shelfUsed[shelfItem] = (shelfUsed[shelfItem] ?? 0) + 1;
      source = shelfItem;
    } else if (feedLeft > 0) {
      feedLeft -= 1;
      source = "feed";
    } else {
      next.stopped = true;
      continue;
    }
    next.sources.push(source);
    next.fedAts.push(new Date(nextMs).toISOString());
    next.lastFedMs = nextMs;
    budgetLeft -= 1;
    servings += 1;
  }

  return {
    feedings: states
      .filter((state) => state.sources.length > 0)
      .map((state) => ({ unitId: state.unit.id, sources: state.sources, fedAts: state.fedAts })),
    servings,
    shelfUsed,
    feedUsed: Math.max(0, feed) - feedLeft,
  };
}
