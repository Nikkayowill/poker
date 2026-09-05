/**
 * Ray's Museum, secret wing: a hidden loot layer riding on top of the regular
 * exhibits in ./museum.ts.
 *
 * Every produce item is a GUARANTEED first-time donation -- collect it once
 * and it is on the shelf. This wing is the opposite: a rare, optional roll
 * that only fires off the back of a critical harvest (see ./equipment.ts's
 * `rollHarvestCrit`), so finding one is genuinely a moment, not a checklist
 * item. Nothing here pays Gold -- see lib/server/stackacres-service.ts's own
 * "ONE PAYS" header; a secret find is a collectible flag, never a second
 * faucet. The one payout a completed set unlocks (a small achievement
 * reward) runs through the achievements system's own independently-audited
 * funnel, not this one -- see lib/achievements/events.ts.
 *
 * Pure and closed-form, same posture as every other StackAcres rules module:
 * nothing here reads a clock, a database, or Math.random directly. The one
 * function that rolls dice takes its own random source, the same discipline
 * `rollHarvestCrit` is held to and for the identical reason -- its one real
 * call site is inside the server's guarded harvest write, where the roll
 * happens exactly once and can never be re-rolled by a refetch.
 */

import type { StackAcresToolTier } from "./equipment";

/**
 * The core hidden set: three exhibit pieces, one theme apiece, that
 * `checkHiddenSetCompletion` requires ALL of before the wing's own unlock
 * fires. Named literally rather than styled like the produce catalogue's
 * items, on purpose -- these are curiosities Ray dug up, not another crop.
 */
export const SECRET_ARTIFACTS = ["fossil_chip", "cosmic_seed", "golden_ray_statue"] as const;

export type SecretArtifactId = (typeof SECRET_ARTIFACTS)[number];

/**
 * A second, smaller pool: pure flavor, poker-themed, and never required for
 * `checkHiddenSetCompletion`. A roll that lands here is a wink at the felt
 * table one district over, not progress toward anything -- so it can drop
 * before or after the core set is complete without changing what "complete"
 * means.
 */
export const SECRET_JOKE_ARTIFACTS = ["bad_beat_horseshoe", "the_river_rock", "all_in_anvil"] as const;

export type SecretJokeArtifactId = (typeof SECRET_JOKE_ARTIFACTS)[number];

export type SecretMuseumItemId = SecretArtifactId | SecretJokeArtifactId;

export function isSecretArtifact(value: string): value is SecretArtifactId {
  return (SECRET_ARTIFACTS as readonly string[]).includes(value);
}

export function isSecretJokeArtifact(value: string): value is SecretJokeArtifactId {
  return (SECRET_JOKE_ARTIFACTS as readonly string[]).includes(value);
}

export interface SecretMuseumItemDef {
  label: string;
  /** The one-line curiosity-shop caption, read only after it's found -- the
   *  same "???" until discovered treatment museum.ts's regular exhibits get. */
  blurb: string;
}

export const SECRET_MUSEUM_ITEM_CATALOGUE: Readonly<Record<SecretMuseumItemId, SecretMuseumItemDef>> = {
  fossil_chip: { label: "Fossil Chip", blurb: "A clay poker chip, petrified. Nobody remembers whose game it was." },
  cosmic_seed: { label: "Cosmic Seed", blurb: "It fell out of the sky, not out of the ground. Ray won't say more." },
  golden_ray_statue: { label: "Golden Ray Statue", blurb: "A little idol of the man himself. He's flattered and won't admit it." },
  bad_beat_horseshoe: { label: "Bad Beat Horseshoe", blurb: "Bent clean in half. Ray swears it was lucky right up until it wasn't." },
  the_river_rock: { label: "The River Rock", blurb: "Sits at the bottom of the pond. Turns over the exact card you didn't want." },
  all_in_anvil: { label: "All-In Anvil", blurb: "Too heavy to bluff with. Somebody shoved it anyway." },
};

/** Every donation flag for a player's secret wing, keyed by item -- same
 *  boolean shape ./museum.ts's `MuseumRegistry` uses, for the same reason: a
 *  find has no quantity worth tracking, only a first time. */
export type SecretMuseumRegistry = Readonly<Record<SecretMuseumItemId, boolean>>;

export function emptySecretMuseumRegistry(): SecretMuseumRegistry {
  const out = {} as Record<SecretMuseumItemId, boolean>;
  for (const item of SECRET_ARTIFACTS) out[item] = false;
  for (const item of SECRET_JOKE_ARTIFACTS) out[item] = false;
  return out;
}

/** Whether every core exhibit piece has been found -- the joke pool is
 *  deliberately excluded, see this module's own header. Total over
 *  `SECRET_ARTIFACTS`, so a registry missing a key (an old row, a partial
 *  read) reads as "not found" rather than throwing. */
export function secretHiddenSetComplete(registry: SecretMuseumRegistry): boolean {
  return SECRET_ARTIFACTS.every((item) => registry[item] === true);
}

export function secretsFoundCount(registry: SecretMuseumRegistry): number {
  return SECRET_ARTIFACTS.filter((item) => registry[item] === true).length;
}

/* ------------------------------------------------------------------ */
/* The drop matrix                                                     */
/* ------------------------------------------------------------------ */

/**
 * Fractional drop rate per tool tier, base rate vs. the rate on a critical
 * harvest. The brief this shipped against quotes two of these six numbers
 * directly: 0.1% at the base tiers, 1.5% at the top of the ladder on a crit
 * -- the Golden Spade's own crit row, since that IS "a maximum Gold tool
 * ladder crit landing." The five numbers between were interpolated to keep
 * both axes monotonic: a better tool never finds less, and a crit never
 * finds less than the same tier's own base roll.
 */
const SECRET_DROP_RATE: Readonly<Record<StackAcresToolTier, { base: number; crit: number }>> = {
  trowel: { base: 0.001, crit: 0.003 },
  "iron-shovel": { base: 0.002, crit: 0.006 },
  "golden-spade": { base: 0.004, crit: 0.015 },
};

/**
 * Of a successful roll, how often it lands in the joke pool rather than the
 * core set. Low and fixed across every tier -- the joke items are a flavor
 * bonus, not a second ladder to farm, so nothing about a better tool or a
 * crit should make them relatively more likely.
 */
const JOKE_POOL_SHARE = 0.15;

/**
 * One roll for a secret museum find, or null on the overwhelming majority of
 * harvests. Pure given an injected random source -- see this module's own
 * header for why that matters at its one real call site.
 *
 * Deliberately does NOT take a registry and does NOT bias toward whatever
 * the player is still missing: every item in both pools is an equally likely
 * pick on every successful roll, core and joke pool alike (weighted only by
 * `JOKE_POOL_SHARE`). A completionist bias would need to read the registry
 * inside the same guarded write the roll happens in, which is a real option
 * for later but not what this pass builds -- a rare find staying rare, even
 * a repeat of one already on the shelf, is the simpler and safer contract.
 */
export function rollSecretArtifact(
  currentToolTier: StackAcresToolTier,
  isCrit: boolean,
  random: () => number = Math.random,
): SecretMuseumItemId | null {
  const rate = SECRET_DROP_RATE[currentToolTier][isCrit ? "crit" : "base"];
  if (random() >= rate) return null;
  const pool: readonly SecretMuseumItemId[] =
    random() < JOKE_POOL_SHARE ? SECRET_JOKE_ARTIFACTS : SECRET_ARTIFACTS;
  return pool[Math.floor(random() * pool.length)];
}

/* ------------------------------------------------------------------ */
/* The barn glow                                                       */
/* ------------------------------------------------------------------ */

export type MuseumGlowTier = "none" | "ambient" | "progression";

/**
 * Which of the barn's two glow states should be showing right now, if
 * either. Pure so stackacres-scene.ts's tween setup can be driven off a
 * plain value and museum-secrets.test.ts can hold every branch to a table,
 * rather than the scene itself deciding.
 *
 * PROGRESSION (the rapid golden tint-shift) is the harder of the two to
 * earn, and reads as one: it requires the Golden Spade, the ladder's own
 * "hard progression upgrade" (a 250,000 Gold purchase -- see equipment.ts's
 * own header on why it is priced as the thing left to want once the farm is
 * running), AND an incomplete secret wing to point at. It goes quiet the
 * moment the core set is finished; there is nothing left to shift gold
 * about.
 *
 * AMBIENT (the slow breathing pulse) is the everyday "there's more here"
 * nudge: either the regular exhibits (./museum.ts) still have an unfound
 * shelf, or the secret wing has SOME progress but not all of it. It never
 * competes with `progression` -- a player who qualifies for both sees only
 * the rarer one, the same "the bigger state wins" rule a mission's own
 * progress ring follows.
 */
export function museumGlowTier(input: {
  regularUndonatedCount: number;
  secretsFound: number;
  secretsTotal: number;
  hasGoldenSpade: boolean;
}): MuseumGlowTier {
  const secretIncomplete = input.secretsFound < input.secretsTotal;
  if (input.hasGoldenSpade && secretIncomplete) return "progression";
  if (input.regularUndonatedCount > 0 || (input.secretsFound > 0 && secretIncomplete)) return "ambient";
  return "none";
}
