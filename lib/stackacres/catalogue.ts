/**
 * StackAcres's whole economy in one file: what you can own, what it costs to
 * keep, and the capacity ladder that bounds how much of it you can run.
 *
 * EVERY NUMBER HERE IS IN BUSHELS, the farm's own currency, with exactly one
 * exception: `stackacresCapacityPrice`, which is Gold. That split is the
 * feature's whole safety story and is worth stating plainly.
 *
 * - Bushels never leave the StackAcres. Seed, stock, feed and muck are all
 *   priced in them, harvests are sold for them, and phase 4's swinging market
 *   will move them. Because none of it is Gold, none of it is a money bug.
 * - Gold enters in two places (buying capacity, buying stock outright) and
 *   leaves in one, the daily exchange window. The farm's maximum Gold output
 *   is a flat daily constant -- not a percentage, not scaled by stock owned,
 *   not scaled by how well you traded. That single invariant is what keeps
 *   this out of the category Ante Up was in when it printed money.
 *
 * Because these are no longer real money, the tuning is deliberately looser
 * than the Gold version it replaces: a cycle is meant to feel worth doing.
 * What survives from that version is the shape -- separate caps per kind, and
 * an upkeep cost sized as a fraction of what the unit actually earned rather
 * than a flat fee that bankrupts the cheapest tier.
 *
 * Seed cost and yield are snapshotted onto the unit row at stocking and never
 * re-read here at collection -- the same rule StoredWordStackRound.wagerLadder
 * states: a retune must not change what an already-stocked unit returns.
 *
 * THERE IS NO PLOT GRID ANY MORE (see 2026-09-03's CLAUDE.md entry). A unit
 * you own is just a row -- see ./units.ts -- standing in whichever district
 * ./world.ts's `stockZone` says its kind lives in. What used to be "buy a
 * plot, then stock it" is now one step: buy the animal or crop directly.
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
   * yields little and an animal yields more, and each is tended its own way:
   * an animal is fed, a crop is watered (see `thirstMs`).
   */
  hungerMs: number | null;
  /**
   * How long after its last watering a crop's soil dries out. Null for
   * livestock, which drink from their own trough and are tended by feeding
   * instead -- exactly the mirror of `hungerMs`, and deliberately the same
   * shape so the two freeze-the-clock paths read alike.
   *
   * A dry crop stops growing outright: `isStackAcresUnitReady` refuses it,
   * and watering pushes `readyAt` forward by however long it stood dry, so
   * the neglected time is never silently credited as work. Same rule feeding
   * already follows -- neglect costs time, never yield.
   *
   * Both numbers sit UNDER their kind's own `durationMs` on purpose, unlike
   * the Hen Coop's deliberately-unreachable hunger window: watering is the
   * crop track's whole tending loop, so a crop that could finish a cycle
   * without ever needing a drink would have no loop at all.
   */
  thirstMs: number | null;
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
    // Half its own 15m cycle: one drink mid-row, so the cheapest crop teaches
    // the watering loop without being a chore.
    thirstMs: 8 * 60 * 1000,
    muckFee: 16,
  },
  cash_crop: {
    label: "Cash Crop",
    seedCost: 60,
    durationMs: 4 * 60 * 60 * 1000,
    hungerMs: null,
    // Roughly two drinks across a 4h cycle, the same tending weight a Sheep
    // Pen carries on the livestock track at the same duration.
    thirstMs: 90 * 60 * 1000,
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
    thirstMs: null,
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
    thirstMs: null,
    muckFee: 156,
  },
  cattle: {
    label: "Cattle Pen",
    seedCost: 600,
    durationMs: 24 * 60 * 60 * 1000,
    hungerMs: 8 * 60 * 60 * 1000,
    thirstMs: null,
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
 * The cap is per KIND now, not per track. It used to be one shared budget of
 * 3 across all three livestock kinds -- an artifact of the single-grid era,
 * when a Hen Coop and a Cattle Pen competed for the same handful of plots.
 * Since the pen-zoning pass put each kind in its own district, and now that
 * there is no plot ladder to physically bound them at all, a shared cap makes
 * no sense: three cattle at Ox Fields no longer has anything to do with
 * whether a Hen Coop is buyable at the Farmstead. Every kind gets its own
 * free base of 3, same number as the old shared cap, extendable by Gold.
 *
 * Mirrored by a BEFORE INSERT trigger on homestead_units (advisory-locked, so
 * two racing stockings cannot squeeze past it), reading the purchased slots
 * from homestead_capacity.
 */
export const STACKACRES_BASE_CAP = 3;

/** How many extra slots Gold can buy for one kind, on top of the free base. */
export const STACKACRES_MAX_EXTRA_CAP = 3;

export function capFor(extraSlots: number): number {
  return STACKACRES_BASE_CAP + Math.max(0, Math.min(STACKACRES_MAX_EXTRA_CAP, extraSlots));
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

/**
 * What buying one extra capacity slot costs, in GOLD -- the only number in
 * this file that is not Bushels. Replaces the old flat plot price
 * (STACKACRES_PLOT_PRICE, 10,000 for any of plots 5-16): there is no land to
 * unlock any more, so Gold buys room the same way it always did, just
 * attached to a kind instead of a tile.
 *
 * Flat per kind, same "buy any slot, no forced order" reasoning that
 * flattened the old plot ladder -- a player buying the fourth Cattle Pen slot
 * without first buying a fourth Hen Coop slot is the point, not a gap to
 * guard against. Scaled BY kind, not flat across all four: a Cattle Pen slot
 * and a Hen Coop slot are not the same purchase, the same way land itself was
 * never priced against what a Cattle Pen alone was worth.
 *
 * Lives here rather than in market.ts because market.ts reads this module and
 * the reverse would be a cycle. market.ts re-exports it, so the Gold prices
 * can still all be read in one place. Still sunk, never returned: capacity is
 * progression, not principal, and it buys ROOM rather than income -- the cap
 * itself bounds how much can run at once.
 */
export const STACKACRES_CAPACITY_PRICE: Readonly<Record<StackAcresStock, number>> = {
  sprout: 5_000,
  cash_crop: 5_000,
  hen: 2_000,
  pig: 15_000,
  cattle: 40_000,
};

export function stackacresCapacityPrice(stock: StackAcresStock): number {
  return STACKACRES_CAPACITY_PRICE[stock];
}
