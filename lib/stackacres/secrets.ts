/**
 * Hidden secrets: a handful of tap-to-discover spots around the yard, and the
 * one collectible they can turn up.
 *
 * A SEPARATE ITEM SPACE FROM ./items.ts, deliberately, the same reasoning
 * ./machine-items.ts already states for wheat/flour: `StackAcresItem` is
 * total over the museum's own exhibits (museum.test.ts holds every item to
 * exactly one exhibit), and a secret item is not produce a unit yields, so it
 * has no exhibit to sit in and must not be added to that enum. It rides the
 * SAME generic ledger table wheat/flour do not use, though -- see
 * lib/server/stackacres-store.ts's `adjustStackAcresSecretLedger`, backed by
 * this feature's own `homestead_secret_ledger` table: a free-form item-id/
 * quantity row per player, which is exactly what a secret item (and the
 * marker keys below) need and nothing already wired up provided. NOT the
 * barn-era `homestead_inventory` table, which fits the same shape but is
 * dead on purpose -- see stackacres-store.ts's own header on the ledger.
 *
 * Nothing here ever calls creditGoldByProfile, directly or indirectly. A
 * discovery, a donation, a crit-boost arm/disarm and an upkeep trade all move
 * an item count or reshape a probability/target that an EXISTING payer
 * (harvestStackAcres, raiseStackAcresUpkeep) already reserves against the
 * flat daily ceiling -- see lib/server/stackacres-service.ts's header for why
 * a fourth Gold-crediting call site in that file would be the bug to stop
 * over.
 */

import type { WorldRect } from "./world";

/* ------------------------------------------------------------------ */
/* The one secret item                                                 */
/* ------------------------------------------------------------------ */

export const SECRET_ITEM_IDS = ["lucky_poker_dice"] as const;

export type SecretItemId = (typeof SECRET_ITEM_IDS)[number];

/** Whether a string off the wire names a real secret item -- the route's own
 *  zod enum is built from `SECRET_ITEM_IDS` directly, so this is for a
 *  server-side caller that already has a bare string (a stored ledger key,
 *  say) rather than a parsed request. */
export function isSecretItemId(value: string): value is SecretItemId {
  return (SECRET_ITEM_IDS as readonly string[]).includes(value);
}

export interface SecretItemDef {
  id: SecretItemId;
  label: string;
  /** A plain emoji, not a stackacres-art.ts painter name -- this is a rare,
   *  small piece of chrome (an inventory row, a museum wing), not part of the
   *  farm's own vector world. */
  icon: string;
  rarity: "legendary";
  blurb: string;
}

export const SECRET_ITEM_CATALOGUE: Readonly<Record<SecretItemId, SecretItemDef>> = {
  lucky_poker_dice: {
    id: "lucky_poker_dice",
    label: "Lucky Poker Dice",
    icon: "🎲",
    rarity: "legendary",
    blurb: "Worn smooth by a hundred all-in calls. Somebody buried their luck out here.",
  },
};

/* ------------------------------------------------------------------ */
/* Hidden zones                                                        */
/* ------------------------------------------------------------------ */

export const HIDDEN_ZONE_IDS = ["wishing-well", "loose-board", "windmill-gear"] as const;

export type HiddenZoneId = (typeof HIDDEN_ZONE_IDS)[number];

/** Whether a string off the wire names a real hidden zone. Same reasoning as
 *  `isSecretItemId`: the route's zod enum is built from `HIDDEN_ZONE_IDS`
 *  directly, this is for a caller that already has a bare string. */
export function isHiddenZoneId(value: string): value is HiddenZoneId {
  return (HIDDEN_ZONE_IDS as readonly string[]).includes(value);
}

export interface HiddenZoneDef {
  id: HiddenZoneId;
  label: string;
  /** The flavour line the tap surfaces, win or lose. */
  hint: string;
  bounds: WorldRect;
  /**
   * Odds a tap here turns up a secret item, rolled AT MOST ONCE PER ZONE PER
   * UTC DAY PER PLAYER -- see `secretZoneAttemptKey` below, which is the real
   * throttle. 8% is deliberately generous against that gate: three zones,
   * once a day each, at 8% is a low-key, patient hunt rather than a slot
   * machine, and the daily gate is doing the work a stingier per-tap number
   * would otherwise have to.
   */
  discoveryChance: number;
}

const HIDDEN_ZONE_DISCOVERY_CHANCE = 0.08;

/**
 * Three small boxes (~22 units square) anchored beside real yard props --
 * see lib/stackacres/props.ts's own `YARD_PROPS`/`PROP_SIZE` for the props
 * these sit next to (the well at (238, 30), Grandfather Ray's post at
 * (178, 20), the windmill at (330, 28)) -- and clear of both `GROW_AREA` and
 * `BARN_FOOTPRINT` in ./world.ts. secrets.test.ts holds that disjointness
 * directly, the same invariant world.test.ts already holds the four
 * districts' own grow areas to.
 *
 * The brief's "small decor fountain" has no matching art asset in this
 * codebase; the well is the real existing water feature nearest Grandfather
 * Ray's post, so the wishing-well zone uses it rather than inventing new art.
 */
export const HIDDEN_ZONES: readonly HiddenZoneDef[] = [
  {
    id: "wishing-well",
    label: "The Well",
    hint: "Something glints at the bottom of the well.",
    bounds: { x: 227, y: 8, width: 22, height: 22 },
    discoveryChance: HIDDEN_ZONE_DISCOVERY_CHANCE,
  },
  {
    id: "loose-board",
    label: "Loose Board",
    hint: "A loose board behind the shop.",
    bounds: { x: 156, y: -2, width: 22, height: 22 },
    discoveryChance: HIDDEN_ZONE_DISCOVERY_CHANCE,
  },
  {
    id: "windmill-gear",
    label: "Jammed Gear",
    hint: "A jammed gear on the old windmill.",
    bounds: { x: 319, y: 6, width: 22, height: 22 },
    discoveryChance: HIDDEN_ZONE_DISCOVERY_CHANCE,
  },
];

/** Which hidden zone a tapped ground point lands on, or null anywhere else.
 *  Same plain AABB-loop pattern as `growAreaAt`/`barnHitAt` in ./world.ts. */
export function hiddenZoneAt(x: number, y: number): HiddenZoneDef | null {
  for (const zone of HIDDEN_ZONES) {
    const b = zone.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return zone;
  }
  return null;
}

/**
 * Rolls one zone's daily attempt. Pure, with an injected RNG -- the same
 * convention `rollHarvestCrit` in ./equipment.ts holds, and for the same
 * reason: the one call site is inside a guarded server write, and threading
 * the source makes it visible there that the roll happens exactly once.
 *
 * Every zone drops the same single item today, so this is a direct return
 * rather than a weighted table. If a second secret item is ever added, that
 * table (item id -> weight) belongs HERE, chosen only once `random()` has
 * already cleared `zone.discoveryChance` -- keep the chance as "any discovery
 * at all" and let the table decide which one, rather than folding a second
 * threshold into this same roll.
 */
export function rollSecretDiscovery(zone: HiddenZoneDef, random: () => number): SecretItemId | null {
  return random() < zone.discoveryChance ? "lucky_poker_dice" : null;
}

/* ------------------------------------------------------------------ */
/* What holding an armed dice does                                     */
/* ------------------------------------------------------------------ */

/** How much an armed crit boost adds to a harvest's crit chance. Additive on
 *  top of whatever the held tool already gives, the same way the tool ladder
 *  itself is one flat number per rung -- see ./equipment.ts. */
export const STACKACRES_DICE_CRIT_BONUS = 0.1;

/** The crit chance a harvest actually rolls at, given the tool's own base
 *  chance and whether a dice boost is armed. Pure; `harvestStackAcres` reads
 *  the armed flag from the ledger and calls this once, before `rollHarvestCrit`. */
export function effectiveCritChance(baseCritChance: number, boostArmed: boolean): number {
  return boostArmed ? Math.min(1, baseCritChance + STACKACRES_DICE_CRIT_BONUS) : baseCritChance;
}

/** How much trading a dice to Ray wipes off today's Land Maintenance bill. */
export const STACKACRES_DICE_UPKEEP_WIPE = 5_000;

/**
 * What today's paid-toward-upkeep total becomes after trading one dice to
 * Ray. RAISE-TO, clamped at `fee`, matching the exact contract
 * `raiseStackAcresUpkeep` already enforces server-side: paying more than the
 * day owes is never a credit, and a trade can never make `paidToday` go
 * backwards (`Math.max(0, currentPaidToday)` guards a stray negative input).
 */
export function nextUpkeepPaidAfterDiceTrade(currentPaidToday: number, fee: number): number {
  return Math.min(fee, Math.max(0, currentPaidToday) + STACKACRES_DICE_UPKEEP_WIPE);
}

/* ------------------------------------------------------------------ */
/* Ledger keys: markers riding the same generic item-id table           */
/* ------------------------------------------------------------------ */

/**
 * Quantity 1 means an armed-but-unused crit boost is live; consumed back to 0
 * the moment a harvest rolls with it armed, whether or not that roll actually
 * crit. Not a `SecretItemId` -- it is not a collectible, it is a ledger flag
 * -- but it lives in the exact same generic `homestead_secret_ledger` table
 * (free-form `item_id` text at the DB level) rather than a bespoke column.
 */
export const STACKACRES_DICE_BOOST_ARMED_KEY = "lucky_poker_dice_boost_armed";

/**
 * One zone's attempt marker for one UTC day: quantity >=1 means this player
 * has already rolled this zone today, win or lose. `utcDay` reuses the app's
 * existing `YYYY-MM-DD` UTC stamp (see ./exchange.ts's `stackacresExchangeDay`,
 * which Land Maintenance also reuses rather than defining a second one) --
 * this function does not stamp the day itself, only shapes the key, so a
 * caller always passes that same helper's output in.
 */
export function secretZoneAttemptKey(zoneId: HiddenZoneId, utcDay: string): string {
  return `secret-attempt:${zoneId}:${utcDay}`;
}
