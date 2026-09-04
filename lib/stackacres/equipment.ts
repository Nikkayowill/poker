/**
 * The equipment ladder: what the player is holding, and what holding it is
 * worth.
 *
 * Three rungs, bought once each and kept forever. A rung is not consumable,
 * not equippable-and-unequippable, and never sold back -- owning the Golden
 * Spade is a fact about the account, so the store row's only two states are
 * "buy" and "owned", and there is no inventory of tools anywhere.
 *
 * TWO EFFECTS PER RUNG, and the split matters because only one of them is
 * server-authoritative:
 *
 *   `reach` is COSMETIC-ADJACENT and lives entirely on the client. It widens
 *   the swathe one drag of the scythe cuts, so clearing an overgrown Long
 *   Meadow takes fewer strokes -- see `strokesToClearWidth` for that measured
 *   as taps rather than as world units. Nothing is at stake in it: the meadow
 *   is client-side scenery (`stackacres-scene.ts` holds the cut tiles in its
 *   own map and they are never persisted), so a tampered reach cuts imaginary
 *   grass faster and pays nothing.
 *
 *   `critChance`/`critBonus` DO pay, so they are rolled on the server, once,
 *   inside the guarded harvest write -- the same discipline `rollMuck` is
 *   held to in stackacres-service.ts, and for the same reason: anything
 *   reachable from a read can be re-rolled by pulling to refresh.
 *
 * HOW THE CRIT STAYS SAFE WHILE PAYING GOLD. The farm has one currency now
 * (the 2026-09-04 single-currency pass) and exactly one path that pays Gold
 * out: `harvestStackAcres`, under a flat per-player daily ceiling. A crit is
 * a genuine Gold payout, so the thing to protect is that count of one.
 *
 * It is protected by construction rather than by discipline: the crit is paid
 * BY the harvest, out of the SAME reservation the harvest already took
 * against the ceiling. `harvestStackAcres` reserves optimistically -- the
 * sweep's net plus the most `critGoldFor` could add at the held rung -- and
 * hands back whatever the roll did not use. So there is still one faucet,
 * still one ceiling, and a lucky player reaches the same daily wall as an
 * unlucky one, just sooner.
 *
 * An earlier draft of this file paid the crit in Bushels to avoid adding a
 * second faucet. That was the right call against the two-currency farm it was
 * written for and is simply obsolete now: there are no Bushels, and riding
 * inside the harvest's own reservation solves the same problem without
 * inventing a currency to launder through.
 *
 * The sprites are FLUX-generated (see the 2026-09-04 CLAUDE.md entry), keyed
 * by `sprite` here and loaded by `stackacres-sprites.ts` like every other
 * generated asset; `icon` is the vector painter that draws in their place
 * before they load and if they never do.
 */

import { SCYTHE_REACH } from "./zones";

export const STACKACRES_TOOL_TIERS = ["trowel", "iron-shovel", "golden-spade"] as const;

export type StackAcresToolTier = (typeof STACKACRES_TOOL_TIERS)[number];

/** What everyone starts with. Never purchasable, never lost. */
export const STACKACRES_STARTING_TIER: StackAcresToolTier = "trowel";

export interface StackAcresToolTierDef {
  /** What the shelf row says, and what a screen reader announces. */
  label: string;
  /** One line under the row saying what buying it changes. */
  blurb: string;
  /**
   * Gold, or null for the rung nobody buys. A SINK -- see this file's header
   * and market.ts's: every Gold price in StackAcres goes one way.
   */
  price: number | null;
  /** Public path of the generated sprite, under public/. */
  sprite: string;
  /**
   * Name of a vector painter in components/arcade/stackacres/stackacres-art.ts
   * (its `PainterName` union), drawn until `sprite` loads. Kept a plain
   * string for the same reason StackAcresToolDef.icon is: this file stays
   * free of a components/ import.
   */
  icon: string;
  /** How far either side of the drag line one scythe stroke cuts, world units. */
  reach: number;
  /** Odds a settled harvest pays a critical bonus, 0..1. */
  critChance: number;
  /**
   * What a critical harvest pays on top, as a multiple of what the sweep was
   * already worth. 1 is "a crit doubles the harvest".
   */
  critBonus: number;
}

/**
 * The ladder.
 *
 * The Trowel's `reach` is exactly `SCYTHE_REACH` on purpose, imported rather
 * than retyped: the starting rung must be the game as it already plays, or
 * shipping this ladder would be a nerf to every player who never buys
 * anything. The two paid rungs are the only behaviour change.
 *
 * The two paid reaches are written as MULTIPLES of the starting one rather
 * than as their own numbers, because the shelf copy quotes them: the Iron
 * Shovel's row says "half again the swathe" and the Golden Spade's says
 * "half the passes", and both are only true at exactly 1.5x and 2x.
 * equipment.test.ts holds the copy to the arithmetic, so a retune that moves
 * one has to move the other.
 *
 * Prices: the Iron Shovel sits above the dearest capacity slot (a cattle slot
 * is 40,000) and below a permanent Cattle Pen (60,000) -- a bigger commitment
 * than one more pen and a smaller one than an animal that pays forever. The
 * Golden Spade is deliberately dearer than anything else in StackAcres,
 * because it is the thing there is left to want once the farm is running.
 */
export const STACKACRES_TOOL_TIER_DEFS: Readonly<
  Record<StackAcresToolTier, StackAcresToolTierDef>
> = {
  trowel: {
    label: "Trowel",
    blurb: "The one in your back pocket. Cuts a narrow swathe, and never gets lucky.",
    price: null,
    sprite: "/stackacres/sprites/tool-trowel.png",
    icon: "ico-scythe",
    reach: SCYTHE_REACH,
    // ZERO, and deliberately so. The free rung is the game as it already
    // plays: a player who never buys anything must see no behaviour change at
    // all from this feature shipping -- the same invariant `reach` holds by
    // importing SCYTHE_REACH rather than retyping it. A lucky harvest is a
    // thing the ladder INTRODUCES, which also makes the first purchase legible
    // ("harvests can come up rich now") instead of a rate nudge nobody can
    // perceive. It has a practical half too: a non-zero chance here would make
    // every harvest in the app non-deterministic, and the service's own tests
    // assert exact payouts.
    critChance: 0,
    critBonus: 0.5,
  },
  "iron-shovel": {
    label: "Iron Shovel",
    blurb: "Half again the swathe, and harvests start coming up rich.",
    price: 45_000,
    sprite: "/stackacres/sprites/tool-iron-shovel.png",
    icon: "ico-scythe",
    reach: SCYTHE_REACH * 1.5,
    critChance: 0.12,
    critBonus: 0.75,
  },
  "golden-spade": {
    label: "Golden Spade",
    blurb: "Clears the meadow in half the passes. A quarter of harvests pay double.",
    price: 250_000,
    sprite: "/stackacres/sprites/tool-golden-spade.png",
    icon: "ico-scythe",
    reach: SCYTHE_REACH * 2,
    critChance: 0.25,
    critBonus: 1,
  },
};

export function stackacresToolTierDef(tier: StackAcresToolTier): StackAcresToolTierDef {
  return STACKACRES_TOOL_TIER_DEFS[tier];
}

/** Whether a string off the wire (or out of an old stored row) names a rung. */
export function isStackAcresToolTier(value: unknown): value is StackAcresToolTier {
  return typeof value === "string" && (STACKACRES_TOOL_TIERS as readonly string[]).includes(value);
}

/**
 * A stored value read back as a rung, falling back to the starting one.
 *
 * Every read of the persisted tier goes through here rather than casting: a
 * row written before this feature existed has no tier at all, and a row
 * written by a future rung this build does not know about must degrade to
 * something playable rather than throwing on the farm's own load.
 */
export function toStackAcresToolTier(value: unknown): StackAcresToolTier {
  return isStackAcresToolTier(value) ? value : STACKACRES_STARTING_TIER;
}

/** How far up the ladder a rung sits. 0 is the starting one. */
export function toolTierRank(tier: StackAcresToolTier): number {
  return STACKACRES_TOOL_TIERS.indexOf(tier);
}

/** The rung after this one, or null at the top of the ladder. */
export function nextToolTier(tier: StackAcresToolTier): StackAcresToolTier | null {
  return STACKACRES_TOOL_TIERS[toolTierRank(tier) + 1] ?? null;
}

/**
 * What upgrading from `tier` costs in Gold, or null when there is nothing
 * left to buy.
 *
 * Flat, not a difference: each rung is bought at its own listed price and
 * they are bought in order, so a player who has the Iron Shovel pays the
 * Golden Spade's own number and nothing is discounted for what they already
 * hold. Same "a price you can work out in your head" rule market.ts states.
 */
export function toolUpgradePrice(tier: StackAcresToolTier): number | null {
  const next = nextToolTier(tier);
  return next ? (STACKACRES_TOOL_TIER_DEFS[next].price ?? null) : null;
}

/** How far one scythe stroke reaches while holding `tier`, world units. */
export function scytheReachFor(tier: StackAcresToolTier): number {
  return STACKACRES_TOOL_TIER_DEFS[tier].reach;
}

/**
 * How many straight passes it takes to clear a band of overgrown ground
 * `widthWorld` wide -- the ladder's first effect stated as TAPS, which is
 * what the player actually experiences and what a test can assert against.
 *
 * One pass cuts `reach` either side of the line, so a pass is `reach * 2`
 * wide. Ceiling, not round: a band two and a half passes wide takes three.
 */
export function strokesToClearWidth(widthWorld: number, tier: StackAcresToolTier): number {
  if (!Number.isFinite(widthWorld) || widthWorld <= 0) return 0;
  return Math.ceil(widthWorld / (scytheReachFor(tier) * 2));
}

/**
 * Whether this harvest crits.
 *
 * Takes its own random source rather than reaching for Math.random, the same
 * posture the rest of this module's siblings take -- and here it is not only
 * about testability: the ONE call site is inside the server's guarded
 * settlement write, and threading the source makes it obvious at that call
 * site that the roll happens exactly once, where it can neither be re-rolled
 * by a refetch nor read before the write it belongs to has landed.
 */
export function rollHarvestCrit(tier: StackAcresToolTier, random: () => number): boolean {
  return random() < STACKACRES_TOOL_TIER_DEFS[tier].critChance;
}

/**
 * What a critical harvest pays on top, in Gold, given what the sweep was
 * already worth net of Land Maintenance.
 *
 * Floored rather than rounded, and never negative: a bonus is a bonus, and
 * Gold is counted in whole units everywhere else in the app. Called TWICE per
 * harvest with different arguments -- once on the planned net to size the
 * reservation, once on what actually settled to pay it -- so it has to be a
 * pure function of its input and nothing else.
 *
 * A harvest worth nothing (fully eaten by maintenance) crits for nothing.
 * That is deliberate: the crit multiplies a harvest, and there is no sensible
 * reading in which doubling zero is a reward.
 */
export function critGoldFor(harvestNet: number, tier: StackAcresToolTier): number {
  if (!Number.isFinite(harvestNet) || harvestNet <= 0) return 0;
  return Math.max(0, Math.floor(harvestNet * STACKACRES_TOOL_TIER_DEFS[tier].critBonus));
}
