/**
 * What lives in the Oak's brush, what a photographed sighting logs, and
 * which gear is in hand.
 *
 * NON-VIOLENT BY DESIGN. This loop was reskinned from a hunting frame to a
 * wildlife-photography one: the player is documenting the treeline's animals,
 * not taking them. Internal identifiers ("bow"/"rifle", `meat`/`pelt`) are
 * left exactly as they were -- they are not shown to a player, and `pelt`'s
 * item_id is already written into production `homestead_inventory` rows for
 * anyone who logged a sighting before this reskin, so renaming the id itself
 * would orphan those rows. Only the words a player actually reads --
 * `HUNTING_WEAPON_DEFS`' labels/hints and ./machine-items.ts's own catalogue
 * entries -- changed.
 *
 * Pure, and split from ./hunt-proximity.ts the same way ./fishing.ts is split
 * from ./fishing-gauge.ts: this file is the catalogue and the odds, that one
 * is the skill check. Which quarry a completed stalk actually gives is the
 * server's roll (`bagStackAcresQuarry` calls `pickQuarry`), never the
 * client's -- the scanner only decides that the player earned one.
 *
 * WHY THIS EXISTS AT ALL. ./wildlife.ts's predators used to walk onto the
 * farm at night and chew a fence down. The top-down world never drew any of
 * that (every one of its defense methods is a named no-op in
 * components/arcade/stackacres-td/topdown-world.tsx), so the animals were a
 * system nobody could see. Hunting turns the same population the other way
 * round: the player goes to the treeline instead of the treeline coming to
 * the player. ./wildlife.ts is left exactly as it is -- still the source of
 * the fence tiers the districts are priced against -- and nothing here
 * reads or writes it.
 *
 * The Ancestral Oak is where this happens (art/stackacres-td/AREAS.md
 * already calls its forest edge "the natural source of bears"), which puts
 * the whole loop behind that area's own Level 3 gate without this file
 * needing a gate of its own.
 */

import { levelUnlock, storyLevel, type StoryUnlock } from "./story/unlocks";
import type { StackAcresShopProgress } from "./shop-locks";

/* ------------------------------------------------------------------ */
/* Quarry                                                              */
/* ------------------------------------------------------------------ */

export const QUARRY_SPECIES = ["rabbit", "deer", "boar"] as const;

export type QuarrySpecies = (typeof QUARRY_SPECIES)[number];

export function isQuarrySpecies(value: string): value is QuarrySpecies {
  return (QUARRY_SPECIES as readonly string[]).includes(value);
}

/** Out of 100, the same common/uncommon/rare shape ./fishing.ts's own
 *  `FISH_WEIGHTS` uses -- a player who has learned what a Catfish means
 *  already knows what a Boar means. */
const QUARRY_WEIGHTS: Readonly<Record<QuarrySpecies, number>> = {
  rabbit: 55,
  deer: 32,
  boar: 13,
};

export interface QuarryDef {
  readonly label: string;
  /** Field Notes and Trail Photos a logged sighting yields -- see
   *  ./machine-items.ts's `meat`/`pelt` catalogue entries, whose item_id
   *  stays `meat`/`pelt` (see this file's header) even though the label a
   *  player reads is neither. Both always at least 1, so no completed stalk
   *  ever ends in an empty shelf. */
  readonly meat: number;
  readonly pelt: number;
}

/**
 * Priced through ./machine-items.ts's own Field Notes/Trail Photo sell
 * prices rather than here, so one stalk is worth roughly what one cast is: a
 * Rabbit lands around a Bluegill, a Deer around a Trout, a Boar a little
 * under a Catfish. The ladder is deliberately flatter than fishing's -- a
 * Boar is 13% of stalks against a Catfish's 10%, and the stalk itself is the
 * harder game.
 */
export const QUARRY_CATALOGUE: Readonly<Record<QuarrySpecies, QuarryDef>> = {
  rabbit: { label: "Rabbit", meat: 1, pelt: 1 },
  deer: { label: "Deer", meat: 3, pelt: 2 },
  boar: { label: "Boar", meat: 5, pelt: 3 },
};

/** Which quarry a completed stalk gives, weighted by `QUARRY_WEIGHTS`. Takes
 *  the RNG as a parameter for the same reason `pickCaughtFish` does: a test
 *  hands it a fixed sequence instead of patching `Math.random`. */
export function pickQuarry(random: () => number = Math.random): QuarrySpecies {
  const roll = random() * 100;
  let acc = 0;
  for (const species of QUARRY_SPECIES) {
    acc += QUARRY_WEIGHTS[species];
    if (roll < acc) return species;
  }
  return QUARRY_SPECIES[QUARRY_SPECIES.length - 1];
}

/* ------------------------------------------------------------------ */
/* Gear                                                                */
/* ------------------------------------------------------------------ */

// Internal ids stay "bow"/"rifle" -- see this file's header on why the
// reskin only ever touches the words a player reads.
export const HUNTING_WEAPONS = ["bow", "rifle"] as const;

export type HuntingWeapon = (typeof HUNTING_WEAPONS)[number];

export function isHuntingWeapon(value: string): value is HuntingWeapon {
  return (HUNTING_WEAPONS as readonly string[]).includes(value);
}

export interface HuntingWeaponDef {
  readonly label: string;
  /** One line for the slot's title, same shape as `BeltToolDef.hint`. */
  readonly hint: string;
  /** A painter in components/arcade/stackacres/stackacres-art.ts, kept a
   *  plain string so this file stays free of a components/ import -- the
   *  same posture ./toolbelt.ts and ./items.ts both take. */
  readonly icon: string;
}

/** A Handheld Camera first, a Telephoto Lens Scanner at Level 4 (see
 *  `TELEPHOTO_LEVEL`). Both are photography gear, never weapons -- what a
 *  player carries into the brush documents a sighting, and what a stalk
 *  actually ends in is `attemptCatch` in ./hunt-proximity.ts triggering a
 *  camera shutter flash, never a discharge of any kind. */
export const HUNTING_WEAPON_DEFS: Readonly<Record<HuntingWeapon, HuntingWeaponDef>> = {
  bow: {
    label: "Handheld Camera",
    hint: "Track something in the brush and frame your shot.",
    icon: "ico-camera",
  },
  rifle: {
    label: "Telephoto Lens Scanner",
    hint: "A longer, steadier lens -- it frames a clear shot from farther back.",
    icon: "ico-telephoto",
  },
};

/**
 * The Telephoto Lens Scanner's gate. DERIVED, NEVER STORED, the same rule
 * ./shop-locks.ts sets for Ray's shelf and ./story/unlocks.ts for the
 * travelers: this is `levelUnlock(4)`, which is the very same milestone
 * count the Mine already opens on, so a player reading "Requires: three
 * milestones" in two places is being told the same thing by the same code.
 *
 * A stored `owns_telephoto` column was the alternative and was not taken: it
 * would be a migration, and a second source of truth for a fact the farm
 * already knows.
 */
export const RIFLE_LEVEL = 4;

export const RIFLE_UNLOCK: StoryUnlock = levelUnlock(RIFLE_LEVEL);

/** Whether this farm has earned the Telephoto Lens Scanner yet. */
export function rifleUnlocked(progress: StackAcresShopProgress): boolean {
  return storyLevel(progress) >= RIFLE_LEVEL;
}

/** The best gear this farm may carry: the Telephoto Lens Scanner once it is
 *  earned, the Handheld Camera before that. There is never an empty-handed
 *  state -- the camera is the floor, the way `hand` is the belt's resting
 *  slot. */
export function bestWeapon(progress: StackAcresShopProgress): HuntingWeapon {
  return rifleUnlocked(progress) ? "rifle" : "bow";
}

/** What the locked Telephoto Lens Scanner slot says it is waiting for. */
export function rifleLockHint(): string {
  return `Reaches you at Level ${RIFLE_LEVEL}.`;
}
