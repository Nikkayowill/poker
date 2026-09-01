/**
 * The StackChips Homestead's whole economy in one file: what you can put on a
 * plot, what it costs to keep, the caps, and the plot ladder. Everything
 * staked or paid by the Homestead traces back to a number here, the same
 * single-source rule STAKES_TIERS enforces for the tables.
 *
 * Three shapes, all anti-money-printer. The Homestead is a guaranteed win --
 * nothing here can lose your stake -- so the Ante Up lesson applies with no
 * variance to soften it:
 *
 * - Payouts are flat net bonuses, not multipliers. Income cannot compound with
 *   bankroll size; a whale's Cattle Pen earns the same +2,500 a just-solvent
 *   player's does.
 * - The two caps bound how much can be working at once, so maximum daily
 *   income is a small constant rather than a function of how much land you
 *   own. Owning more plots is progression and layout, never more income.
 * - Upkeep (feed, and the maintenance fee after a muck) is a Gold sink sized
 *   as a fraction of what the plot just earned, so it bites without ever
 *   turning a cycle negative.
 *
 * Payouts are snapshotted onto the plot row at stocking and never re-read here
 * at collection -- the same rule StoredWordStackRound.wagerLadder states: a
 * retune must not change what an already-stocked plot pays.
 */

export const HOMESTEAD_CROPS = ["sprout", "cash_crop"] as const;
export const HOMESTEAD_LIVESTOCK = ["hen", "pig", "cattle"] as const;

export type HomesteadCrop = (typeof HOMESTEAD_CROPS)[number];
export type HomesteadLivestock = (typeof HOMESTEAD_LIVESTOCK)[number];
export type HomesteadStock = HomesteadCrop | HomesteadLivestock;

export const HOMESTEAD_STOCK: readonly HomesteadStock[] = [
  ...HOMESTEAD_CROPS,
  ...HOMESTEAD_LIVESTOCK,
];

export function isHomesteadStock(value: string): value is HomesteadStock {
  return (HOMESTEAD_STOCK as readonly string[]).includes(value);
}

export function isLivestock(stock: HomesteadStock): stock is HomesteadLivestock {
  return (HOMESTEAD_LIVESTOCK as readonly string[]).includes(stock);
}

export interface HomesteadStockDef {
  /** What the player calls it. */
  label: string;
  /** Gold debited when the plot is stocked. */
  stake: number;
  /** Working time until it can be collected, excluding any time spent hungry. */
  durationMs: number;
  /** Gold credited at collection: the stake back plus a flat net bonus. */
  payout: number;
  /**
   * How long after its last feed an animal goes hungry. Null for crops, which
   * do not eat -- that is the whole difference between the two tracks. A crop
   * is set-and-forget and pays little; an animal pays more and wants tending.
   */
  hungerMs: number | null;
  /**
   * What clearing this plot costs after a muck. Scaled to the tier on purpose.
   * A single flat fee across tiers spanning 500 to 50,000 Gold makes the
   * cheapest tier permanently negative: at a 20% muck chance, a flat 1,500
   * costs 300 a cycle against a Hen Coop's +50. Twice the net bonus keeps the
   * expected cost at 40% of what the plot earned, on every tier.
   */
  muckFee: number;
}

export const HOMESTEAD_CATALOGUE: Readonly<Record<HomesteadStock, HomesteadStockDef>> = {
  sprout: {
    label: "Sprout Row",
    stake: 500,
    durationMs: 15 * 60 * 1000,
    payout: 525,
    hungerMs: null,
    muckFee: 50,
  },
  cash_crop: {
    label: "Cash Crop",
    stake: 4_000,
    durationMs: 4 * 60 * 60 * 1000,
    payout: 4_240,
    hungerMs: null,
    muckFee: 480,
  },
  hen: {
    label: "Hen Coop",
    stake: 1_000,
    durationMs: 15 * 60 * 1000,
    payout: 1_050,
    // Longer than its own cycle, so a Hen never goes hungry. The cheapest
    // animal is deliberately fire-and-forget; tending is what you take on when
    // you move up to the tiers that pay.
    hungerMs: 45 * 60 * 1000,
    muckFee: 100,
  },
  pig: {
    label: "Pig Pen",
    stake: 10_000,
    durationMs: 4 * 60 * 60 * 1000,
    payout: 10_600,
    hungerMs: 2 * 60 * 60 * 1000,
    muckFee: 1_200,
  },
  cattle: {
    label: "Cattle Pen",
    stake: 50_000,
    durationMs: 24 * 60 * 60 * 1000,
    payout: 52_500,
    hungerMs: 8 * 60 * 60 * 1000,
    muckFee: 5_000,
  },
};

/**
 * Feed, sold in shipments. Priced per serving against the tiers that actually
 * eat: a Pig Pen wants one serving a cycle and a Cattle Pen two or three, so a
 * serving has to cost well under a tenth of those tiers' net bonus or feeding
 * costs more than the animal earns.
 */
export interface HomesteadFeedDef {
  label: string;
  cost: number;
  servings: number;
}

export const HOMESTEAD_FEED: Readonly<Record<string, HomesteadFeedDef>> = {
  feed_sack: { label: "Feed Sack", cost: 900, servings: 6 },
  bulk_shipment: { label: "Bulk Shipment", cost: 2_400, servings: 20 },
};

export const HOMESTEAD_FEED_IDS = Object.keys(HOMESTEAD_FEED);

export function isHomesteadFeed(value: string): boolean {
  return Object.hasOwn(HOMESTEAD_FEED, value);
}

/**
 * Separate caps, not one shared budget. Crops and livestock are two tracks
 * rather than two prices for the same slot, and keeping livestock at three
 * leaves the tier that was signed off exactly where it was.
 *
 * Both are mirrored by a BEFORE trigger in the migration (advisory-locked, so
 * two racing stockings cannot squeeze past them).
 */
export const HOMESTEAD_PEN_CAP = 3;
export const HOMESTEAD_FIELD_CAP = 3;

export function capFor(stock: HomesteadStock): number {
  return isLivestock(stock) ? HOMESTEAD_PEN_CAP : HOMESTEAD_FIELD_CAP;
}

/**
 * The chance a plot needs maintenance after a collection. Rolled ONCE on the
 * server inside the guarded settlement write and stored, never derived on
 * read: every other piece of this feature is a pure function of timestamps,
 * which is why it needs no background jobs, but a dice roll evaluated on read
 * would re-roll on every refetch and let a player reroll muck by pulling to
 * refresh.
 */
export const HOMESTEAD_MUCK_CHANCE = 0.2;

/** The grid is 4x4; plot indexes are 1-based to match plot_index's CHECK. */
export const HOMESTEAD_GRID_PLOTS = 16;

/** The first four plots are free; the rest are a pure Gold sink. */
export const HOMESTEAD_FREE_PLOTS = 4;

/**
 * What unlocking a plot costs. Doubles per tile from 2,500, so the last tile
 * is aspirational (5.12M) the way the top of the character ladder is. Sunk
 * Gold, never returned: plots are progression, not principal.
 */
export function homesteadPlotPrice(plotIndex: number): number | null {
  if (!Number.isInteger(plotIndex)) return null;
  if (plotIndex <= HOMESTEAD_FREE_PLOTS || plotIndex > HOMESTEAD_GRID_PLOTS) return null;
  return 2_500 * 2 ** (plotIndex - HOMESTEAD_FREE_PLOTS - 1);
}
