/**
 * StackAcres's whole economy in one file: what you can put on a
 * plot, what it costs to keep, the caps, and the plot ladder.
 *
 * EVERY NUMBER HERE IS IN BUSHELS, the farm's own currency, with exactly one
 * exception: `stackacresPlotPrice`, which is Gold. That split is the feature's
 * whole safety story and is worth stating plainly.
 *
 * - Bushels never leave the StackAcres. Seed, stock, feed and muck are all
 *   priced in them, harvests are sold for them, and phase 4's swinging market
 *   will move them. Because none of it is Gold, none of it is a money bug.
 * - Gold enters in one place, buying acreage, and leaves in one place, the
 *   daily exchange window phase 3 builds. The farm's maximum Gold output is a
 *   flat daily constant -- not a percentage, not scaled by land owned, not
 *   scaled by how well you traded. That single invariant is what keeps this
 *   out of the category Ante Up was in when it printed money.
 *
 * Because these are no longer real money, the tuning is deliberately looser
 * than the Gold version it replaces: a cycle is meant to feel worth doing.
 * What survives from that version is the shape -- separate caps per track, and
 * an upkeep cost sized as a fraction of what the plot actually earned rather
 * than a flat fee that bankrupts the cheapest tier.
 *
 * Seed cost and yield are snapshotted onto the plot row at stocking and never
 * re-read here at collection -- the same rule StoredWordStackRound.wagerLadder
 * states: a retune must not change what an already-planted plot returns.
 */

export const STACKACRES_CROPS = ["sprout", "cash_crop"] as const;
export const STACKACRES_LIVESTOCK = ["hen", "pig", "cattle"] as const;

export type StackAcresCrop = (typeof STACKACRES_CROPS)[number];
export type StackAcresLivestock = (typeof STACKACRES_LIVESTOCK)[number];
export type StackAcresStock = StackAcresCrop | StackAcresLivestock;

export const STACKACRES_STOCK: readonly StackAcresStock[] = [
  ...STACKACRES_CROPS,
  ...STACKACRES_LIVESTOCK,
];

export function isStackAcresStock(value: string): value is StackAcresStock {
  return (STACKACRES_STOCK as readonly string[]).includes(value);
}

export function isLivestock(stock: StackAcresStock): stock is StackAcresLivestock {
  return (STACKACRES_LIVESTOCK as readonly string[]).includes(stock);
}

export interface StackAcresStockDef {
  /** What the player calls it. */
  label: string;
  /** Bushels debited when the plot is stocked. */
  seedCost: number;
  /** Working time until it can be collected, excluding any time spent hungry. */
  durationMs: number;
  /**
   * How long after its last feed an animal goes hungry. Null for crops, which
   * do not eat -- that is the whole difference between the two tracks. A crop
   * is set-and-forget and yields little; an animal yields more and wants
   * tending.
   */
  hungerMs: number | null;
  /**
   * What clearing this plot costs after a muck, in Bushels. Scaled to the tier
   * on purpose: a single flat fee across tiers an order of magnitude apart
   * makes the cheapest one permanently negative. Twice the tier's net keeps
   * the expected cost at 40% of what the plot earned, on every tier -- there
   * is a test asserting exactly that.
   */
  muckFee: number;
}

/**
 * Seed cost, time and hunger. What a plot YIELDS is in ./items.ts, because a
 * harvest is now produce rather than a number: the value of a cycle is the
 * yield times whatever the store is paying, not a payout baked in here.
 */
export const STACKACRES_CATALOGUE: Readonly<Record<StackAcresStock, StackAcresStockDef>> = {
  sprout: {
    label: "Sprout Row",
    seedCost: 10,
    durationMs: 15 * 60 * 1000,
    hungerMs: null,
    muckFee: 16,
  },
  cash_crop: {
    label: "Cash Crop",
    seedCost: 60,
    durationMs: 4 * 60 * 60 * 1000,
    hungerMs: null,
    muckFee: 100,
  },
  hen: {
    label: "Hen Coop",
    seedCost: 25,
    durationMs: 15 * 60 * 1000,
    // Longer than its own cycle, so a Hen never goes hungry. The cheapest
    // animal is deliberately fire-and-forget; tending is what you take on when
    // you move up to the tiers that yield.
    hungerMs: 45 * 60 * 1000,
    muckFee: 22,
  },
  pig: {
    // Labelled a sheep, keyed as a pig. The tile pack has no pig and a pink
    // palette-swapped sheep reads as a pink sheep, so the words moved to meet
    // the art. The `pig` id stays exactly as it is -- it is the stored value on
    // every plot row, and renaming it would be a data migration to fix a
    // caption. Draw a pig and this one line goes back.
    label: "Sheep Pen",
    seedCost: 150,
    durationMs: 4 * 60 * 60 * 1000,
    hungerMs: 2 * 60 * 60 * 1000,
    muckFee: 156,
  },
  cattle: {
    label: "Cattle Pen",
    seedCost: 600,
    durationMs: 24 * 60 * 60 * 1000,
    hungerMs: 8 * 60 * 60 * 1000,
    muckFee: 560,
  },
};

/**
 * Feed, sold in shipments and priced in Bushels. Priced per serving against
 * the tiers that actually eat: a Sheep Pen wants one serving a cycle and a
 * Cattle Pen two or three, so a serving has to cost well under a tenth of
 * those tiers' net or feeding costs more than the animal earns.
 */
export interface StackAcresFeedDef {
  label: string;
  cost: number;
  servings: number;
}

export const STACKACRES_FEED: Readonly<Record<string, StackAcresFeedDef>> = {
  feed_sack: { label: "Feed Sack", cost: 48, servings: 6 },
  bulk_shipment: { label: "Bulk Shipment", cost: 140, servings: 20 },
};

export const STACKACRES_FEED_IDS = Object.keys(STACKACRES_FEED);

export function isStackAcresFeed(value: string): boolean {
  return Object.hasOwn(STACKACRES_FEED, value);
}

/**
 * Separate caps, not one shared budget. Crops and livestock are two tracks
 * rather than two prices for the same slot, and keeping livestock at three
 * leaves the tier that was signed off exactly where it was.
 *
 * Both are mirrored by a BEFORE trigger in the migration (advisory-locked, so
 * two racing stockings cannot squeeze past them).
 */
export const STACKACRES_PEN_CAP = 3;
export const STACKACRES_FIELD_CAP = 3;

export function capFor(stock: StackAcresStock): number {
  return isLivestock(stock) ? STACKACRES_PEN_CAP : STACKACRES_FIELD_CAP;
}

/**
 * The chance a plot needs maintenance after a collection. Rolled ONCE on the
 * server inside the guarded settlement write and stored, never derived on
 * read: every other piece of this feature is a pure function of timestamps,
 * which is why it needs no background jobs, but a dice roll evaluated on read
 * would re-roll on every refetch and let a player reroll muck by pulling to
 * refresh.
 */
export const STACKACRES_MUCK_CHANCE = 0.2;

/** The grid is 4x4; plot indexes are 1-based to match plot_index's CHECK. */
export const STACKACRES_GRID_PLOTS = 16;

/** The first four plots are free; the rest are a pure Gold sink. */
export const STACKACRES_FREE_PLOTS = 4;

/**
 * What unlocking a plot costs, in GOLD -- the one number in this file that is
 * not Bushels, and the farm's only Gold inlet. Kayo's call: keeping the ladder
 * on Gold preserves a sink the wider economy already leans on, and gives Gold
 * a reason to enter the StackAcres at all rather than only ever leaving it
 * through phase 3's exchange window.
 *
 * Doubles per tile from 2,500, so the last tile is aspirational (5.12M) the
 * way the top of the character ladder is. Sunk Gold, never returned: plots are
 * progression, not principal. Note this buys LAND ONLY -- more acreage is more
 * room, never more income, because the two caps bound how much can run at once.
 */
export function stackacresPlotPrice(plotIndex: number): number | null {
  if (!Number.isInteger(plotIndex)) return null;
  if (plotIndex <= STACKACRES_FREE_PLOTS || plotIndex > STACKACRES_GRID_PLOTS) return null;
  return 2_500 * 2 ** (plotIndex - STACKACRES_FREE_PLOTS - 1);
}
