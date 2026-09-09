/**
 * StackAcres's whole economy in one file: what you can own, what it costs to
 * keep, and the capacity ladder that bounds how much of it you can run.
 *
 * EVERY NUMBER HERE IS IN GOLD. It used to be Bushels, the farm's own
 * currency, with `stackacresCapacityPrice` as the one Gold exception. Bushels
 * are gone -- a harvest is valued and paid in one step now, so a second
 * currency had nothing left to denominate.
 *
 * THE SAFETY ARGUMENT DID NOT MOVE, and it is worth restating because the
 * currency that carried it did. What kept this out of the category Ante Up was
 * in when it printed money was never the Bushel firewall; it was the ceiling
 * behind it: **the farm's maximum Gold OUTPUT is a flat daily constant per
 * player** -- not a percentage, not scaled by stock owned, not scaled by how
 * well anybody played. That ceiling is still here, still mirrored as a hard
 * limit in SQL, and it is now applied to the harvest itself rather than to an
 * exchange window downstream of it. See ./exchange.ts.
 *
 * THE CONVERSION: every Bushel price below was multiplied by 2, the exact rate
 * the exchange window paid. That preserves the internal balance the numbers
 * were tuned for -- seed against yield, muck at 40% of a tier's net, a serving
 * of feed under a tenth of what the animals that eat it earn -- and it leaves
 * the daily ceiling calibrated, since 15,000 Gold a day was sized against
 * exactly this rate.
 *
 * Seed cost and yield are snapshotted onto the unit row at stocking and never
 * re-read here at collection -- the same rule StoredWordStackRound.wagerLadder
 * states: a retune must not change what an already-stocked unit returns.
 *
 * THERE IS NO PLOT GRID ANY MORE (see 2026-09-03's CLAUDE.md entry). A unit
 * you own is just a row -- see ./units.ts -- standing in whichever district
 * ./world.ts's `stockZone` says its kind lives in. What used to be "buy a
 * plot, then stock it" is now one step: buy the animal or crop directly.
 *
 * WHAT HOLDING IT COSTS is not here: Land Maintenance scales with the whole
 * estate rather than attaching to a tier, so it lives in ./upkeep.ts.
 *
 * CROP ROSTER (2026-09-07): the original two hand-vector crops (`sprout`,
 * `cash_crop`) are gone -- replaced outright, not extended, by all 22 CraftPix
 * crop sprites, `carrot`/`corn` included at the same sprite filenames those
 * two ids used to occupy. There is no more sprout->carrot / cash_crop->corn
 * indirection anywhere in the stock system; every id below is both the stock
 * kind and its own art id. Three tiers by seed cost/duration/yield -- see each
 * tier's own comment below. `carrot` and `corn` land on tier 1 and tier 3
 * respectively at the exact numbers `sprout`/`cash_crop` used to carry, on
 * purpose -- that continuity is why those two rungs read like restatements.
 */

import type { StackAcresShopLock } from "./shop-locks";

export const STACKACRES_CROPS = [
  // Tier 1 (fast/cheap): 20 seed / 15m / 8m thirst / 32 muck.
  "garlic",
  "onion",
  "beet",
  "poppy",
  "potato",
  "carrot",
  "cabbage",
  // Tier 2 (medium): 55 seed / 90m / 40m thirst / 90 muck.
  "cucumber",
  "pepper",
  "brokoly",
  "sunflower",
  "sunflowe_broken",
  "wheat1",
  "tomato",
  // Tier 3 (slow/valuable): 120 seed / 4h / 90m thirst / 200 muck.
  "corn",
  "corn2",
  "eggplant",
  "grap",
  "grap2",
  "pumpkin",
  "wheat2",
  "artichoke",
] as const;
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

export function isStackAcresCrop(value: string): value is StackAcresCrop {
  return (STACKACRES_CROPS as readonly string[]).includes(value);
}

/**
 * Seeds of each crop bought from Ray's shop but not yet planted, keyed by
 * crop id. A missing key and an explicit 0 mean the same thing everywhere
 * this is read -- the same convention SoilStock (./soil-tiers.ts) already
 * carries for bags of soil.
 *
 * LIVESTOCK IS NOT HERE. A Hen Coop/Sheep Pen/Cattle Pen is still stocked
 * straight for Gold via `stockStackAcres`'s unchanged path -- there is no
 * "hen seed" to buy ahead of time, only a crop has this two-step shape.
 */
export type SeedStock = Partial<Record<StackAcresCrop, number>>;

/** The most seed bags one purchase may buy -- same ceiling-on-a-single-request
 *  reasoning as SOIL_BAGS_PER_PURCHASE (see that constant's own comment):
 *  every money-moving route needs an upper bound on a body-supplied quantity
 *  that isn't just the player's own balance. */
export const STACKACRES_SEED_BAGS_PER_PURCHASE = 20;

export interface StackAcresStockDef {
  /** What the player calls it. */
  label: string;
  /** Gold debited when the unit is stocked for one cycle. */
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
   * What clearing this plot costs after a muck, in Gold. Scaled to the tier
   * on purpose: a single flat fee across tiers an order of magnitude apart
   * makes the cheapest one permanently negative. Twice the tier's net keeps
   * the expected cost at 40% of what the plot earned, on every tier -- there
   * is a test asserting exactly that.
   */
  muckFee: number;
}

const TIER1 = { seedCost: 20, durationMs: 15 * 60 * 1000, hungerMs: null, thirstMs: 8 * 60 * 1000, muckFee: 32 } as const;
const TIER2 = { seedCost: 55, durationMs: 90 * 60 * 1000, hungerMs: null, thirstMs: 40 * 60 * 1000, muckFee: 90 } as const;
const TIER3 = { seedCost: 120, durationMs: 4 * 60 * 60 * 1000, hungerMs: null, thirstMs: 90 * 60 * 1000, muckFee: 200 } as const;

/**
 * Seed cost, time and hunger. What a unit YIELDS is in ./items.ts: the value
 * of a cycle is the snapshotted yield times what that produce is worth today,
 * not a payout baked in here.
 */
export const STACKACRES_CATALOGUE: Readonly<Record<StackAcresStock, StackAcresStockDef>> = {
  // ---- Tier 1 (fast/cheap): sprout's own old numbers, restated per crop. ----
  garlic: { label: "Garlic", ...TIER1 },
  onion: { label: "Onion", ...TIER1 },
  beet: { label: "Beet", ...TIER1 },
  poppy: { label: "Poppy", ...TIER1 },
  potato: { label: "Potato", ...TIER1 },
  // Same numbers `sprout` used to carry -- deliberate continuity, not a
  // coincidence. See the file header.
  carrot: { label: "Carrot", ...TIER1 },
  cabbage: { label: "Cabbage", ...TIER1 },

  // ---- Tier 2 (medium). ----
  cucumber: { label: "Cucumber", ...TIER2 },
  pepper: { label: "Pepper", ...TIER2 },
  brokoly: {
    // Labelled Broccoli, keyed as brokoly -- same "id and label diverge"
    // pattern `pig` uses below for Sheep Pen. The id stays exactly as it is
    // once stored on a unit row; only the caption moved.
    label: "Broccoli",
    ...TIER2,
  },
  sunflower: { label: "Sunflower", ...TIER2 },
  sunflowe_broken: { label: "Wild Sunflower", ...TIER2 },
  wheat1: { label: "Wheat", ...TIER2 },
  tomato: { label: "Tomato", ...TIER2 },

  // ---- Tier 3 (slow/valuable): cash_crop's own old numbers, restated per
  // crop (corn below carries them exactly -- see the file header). ----
  corn: { label: "Corn", ...TIER3 },
  corn2: { label: "Field Corn", ...TIER3 },
  eggplant: { label: "Eggplant", ...TIER3 },
  grap: {
    // Labelled Grapes, keyed as grap -- same divergence pattern as `brokoly`
    // above and `pig` below.
    label: "Grapes",
    ...TIER3,
  },
  grap2: { label: "Muscat Grapes", ...TIER3 },
  pumpkin: { label: "Pumpkin", ...TIER3 },
  wheat2: { label: "Winter Wheat", ...TIER3 },
  artichoke: { label: "Artichoke", ...TIER3 },

  hen: {
    label: "Hen Coop",
    seedCost: 50,
    durationMs: 15 * 60 * 1000,
    // Longer than its own cycle, so a Hen never goes hungry. The cheapest
    // animal is deliberately fire-and-forget; tending is what you take on when
    // you move up to the tiers that yield.
    hungerMs: 45 * 60 * 1000,
    thirstMs: null,
    muckFee: 44,
  },
  pig: {
    // Labelled a sheep, keyed as a pig. The tile pack has no pig and a pink
    // palette-swapped sheep reads as a pink sheep, so the words moved to meet
    // the art. The `pig` id stays exactly as it is -- it is the stored value on
    // every plot row, and renaming it would be a data migration to fix a
    // caption. Draw a pig and this one line goes back.
    label: "Sheep Pen",
    seedCost: 300,
    durationMs: 4 * 60 * 60 * 1000,
    hungerMs: 2 * 60 * 60 * 1000,
    thirstMs: null,
    muckFee: 312,
  },
  cattle: {
    label: "Cattle Pen",
    seedCost: 1_200,
    durationMs: 24 * 60 * 60 * 1000,
    hungerMs: 8 * 60 * 60 * 1000,
    thirstMs: null,
    muckFee: 1_120,
  },
};

/**
 * Feed, sold in shipments and priced in Gold. Priced per serving against
 * the tiers that actually eat: a Sheep Pen wants one serving a cycle and a
 * Cattle Pen two or three, so a serving has to cost well under a tenth of
 * those tiers' net or feeding costs more than the animal earns.
 */
export interface StackAcresFeedDef extends StackAcresShopLock {
  label: string;
  cost: number;
  servings: number;
}

/**
 * A shipment is gated on the land, not on the purse.
 *
 * The Feed Sack carries no lock and never will: it is the shelf's floor, and
 * an animal that has gone hungry has to be feedable by whoever is standing
 * there. The Bulk Shipment is the volume rung, and it asks for the Fold --
 * which is exactly where feeding stops being optional. Nothing at the
 * Farmstead needs it: a Hen Coop's `hungerMs` is longer than its own cycle
 * (see STACKACRES_CATALOGUE above), so a farm that only keeps hens has never
 * fed anything and would be buying twenty servings of nothing.
 *
 * No live farm is stranded by this. `sectors` is derived, so anybody already
 * keeping sheep reads as holding the Fold whether or not they ever paid to
 * clear it -- see lib/stackacres/shop-locks.ts's header.
 */
export const STACKACRES_FEED: Readonly<Record<string, StackAcresFeedDef>> = {
  feed_sack: { label: "Feed Sack", cost: 96, servings: 6 },
  bulk_shipment: {
    label: "Bulk Shipment",
    cost: 280,
    servings: 20,
    requiredQuestFlag: "cleared_wallow",
  },
};

export const STACKACRES_FEED_IDS = Object.keys(STACKACRES_FEED);

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
 * What buying one extra capacity slot costs, in Gold. Untouched by the
 * single-currency change: it was always Gold. Replaces the old flat plot price
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
  // All 22 crops: flat 5,000 across every tier -- capacity is priced by
  // track, not by tier.
  garlic: 5_000,
  onion: 5_000,
  beet: 5_000,
  poppy: 5_000,
  potato: 5_000,
  carrot: 5_000,
  cabbage: 5_000,
  cucumber: 5_000,
  pepper: 5_000,
  brokoly: 5_000,
  sunflower: 5_000,
  sunflowe_broken: 5_000,
  wheat1: 5_000,
  tomato: 5_000,
  corn: 5_000,
  corn2: 5_000,
  eggplant: 5_000,
  grap: 5_000,
  grap2: 5_000,
  pumpkin: 5_000,
  wheat2: 5_000,
  artichoke: 5_000,
  hen: 2_000,
  pig: 15_000,
  cattle: 40_000,
};

export function stackacresCapacityPrice(stock: StackAcresStock): number {
  return STACKACRES_CAPACITY_PRICE[stock];
}
