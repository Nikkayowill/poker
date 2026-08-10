/**
 * The cosmetic catalog. Like the avatar options, it lives in TypeScript
 * rather than the database: a new item is an entry here plus artwork, with
 * no migration and no admin CMS, and the compiler catches every reference.
 * Only *ownership* is dynamic enough to belong in Postgres.
 *
 * Card backs come first deliberately. They have the highest visibility score
 * in the product -- a large surface, shown on every hidden hand, seen by the
 * whole table -- so they are the item most worth owning and the fairest test
 * of whether anyone wants to spend Gold at all.
 */

import { CHARACTERS_3D } from "@/lib/game3d/characters";

export type Rarity = "standard" | "premium" | "rare" | "signature";

export const rarityLabels: Record<Rarity, string> = {
  standard: "Standard",
  premium: "Premium",
  rare: "Rare",
  signature: "Signature",
};

export type CosmeticSlot = "cardBack" | "avatar";

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  description: string;
  rarity: Rarity;
  /** Gold price. Null means it cannot be bought at any price -- see below. */
  price: number | null;
  /**
   * Card backs are drawn from two colours and a pattern; avatars are supplied
   * artwork. Exactly one of these is set per item, which is what lets a single
   * ownership and purchase path serve both.
   */
  art?: { base: string; ink: string; pattern: "lattice" | "chevron" | "rings" | "pinstripe" | "crest" };
  /**
   * Avatar-only progress unlock, checked against lifetime PlayerStats after
   * every hand (lib/server/avatar-unlocks.ts) instead of a Gold purchase.
   * Exactly one of the two is set per unlockable item -- never both, so a
   * player is never stuck needing two separate kinds of progress to earn one
   * avatar. price stays null on these: they are earned, not for sale, same
   * rule as the signature tier below just gated on a lower bar.
   */
  unlock?: { handsWon: number } | { chipsWon: number };
  /** Avatar renderer used by the Collection and the 3D room. */
  renderMode?: "2d" | "3d";
}

/**
 * Where an avatar's artwork lives, by convention from its id rather than a
 * field on the entry. Adding a character is then one catalog entry and two
 * files with matching names -- there is no third place to update and no path
 * to typo, and a half-added avatar cannot render someone else's face.
 *
 * scripts/prepare-avatars.sh writes both from a single source image.
 */
/**
 * The whole figure, for the store card and the seat at the table.
 *
 * No cache-busting version on these paths, deliberately. Ids are stable so
 * ownership survives an art change, which leaves the URL stable too -- but
 * both the raw file and the optimised one are served `max-age=0,
 * must-revalidate`, so a browser asks every time and replaced artwork appears
 * immediately. The only cache that does hold the old file is Next's own
 * server-side optimiser cache, which a deploy rebuilds. A `?v=` query was
 * tried and reverted: next/image rejects query strings on local sources
 * unless they are enumerated in images.localPatterns.
 */
export function avatarFigure(id: string): string {
  return `/avatars/${id}.webp`;
}

/**
 * A square crop of the head, for anywhere the avatar is a small circle. The
 * full figure is mostly jacket and hands; at 40px it reads as a smudge.
 */
export function avatarFace(id: string): string {
  return `/avatars/${id}-face.webp`;
}

/** Browser-captured thumbnail of a rigged character for the Collection grid. */
export function characterThumbnail(id: string): string {
  return `/avatars3d/collection/${id}.png`;
}

/**
 * Signature items are deliberately unpriced. Nothing about the most
 * impressive thing at the table should be purchasable -- that rule is what
 * keeps status meaningful and is the main defence against the product
 * reading as pay-to-flex. They are granted by achievement instead.
 */
const cardBackCosmetics: Cosmetic[] = [
  {
    id: "back-house",
    slot: "cardBack",
    name: "House",
    description: "The room's own deck. Every table starts here.",
    rarity: "standard",
    price: 0,
    art: { base: "#1d4636", ink: "#8fbfa6", pattern: "lattice" },
  },
  {
    id: "back-oxblood",
    slot: "cardBack",
    name: "Oxblood",
    description: "Deep red stock with a tight chevron weave.",
    rarity: "standard",
    price: 25000,
    art: { base: "#5a1f22", ink: "#d9a2a0", pattern: "chevron" },
  },
  {
    id: "back-slate",
    slot: "cardBack",
    name: "Slate",
    description: "Cool grey, pinstriped like a good suit.",
    rarity: "standard",
    price: 25000,
    art: { base: "#2b3138", ink: "#9aa7b2", pattern: "pinstripe" },
  },
  {
    id: "back-brass",
    slot: "cardBack",
    name: "Brass",
    description: "Warm metal rings under the lamp.",
    rarity: "premium",
    price: 250000,
    art: { base: "#4a3a1c", ink: "#d9b85d", pattern: "rings" },
  },
  {
    id: "back-midnight",
    slot: "cardBack",
    name: "Midnight",
    description: "Near-black with a quiet lattice you only catch up close.",
    rarity: "premium",
    price: 250000,
    art: { base: "#141a22", ink: "#6f7f96", pattern: "lattice" },
  },
  {
    id: "back-ivory",
    slot: "cardBack",
    name: "Ivory Crest",
    description: "Bone stock, engraved crest. Rare enough to notice.",
    rarity: "rare",
    price: 400000,
    art: { base: "#ded6c2", ink: "#8a6a22", pattern: "crest" },
  },
  {
    id: "back-riverwood",
    slot: "cardBack",
    name: "Riverwood",
    description: "Awarded for playing a thousand hands in this room.",
    rarity: "signature",
    price: null,
    art: { base: "#23301f", ink: "#c9a25e", pattern: "crest" },
  },
];

/**
 * Avatars. Supplied artwork rather than composed layers -- one image per
 * character, sold through exactly the same ownership and purchase path as
 * card backs, which is what makes this a single system instead of two.
 *
 * Artwork is matched by id -- see avatarFigure/avatarFace above. Until the
 * files exist an entry still lists and sells; it renders the player's monogram
 * in the meantime, so a character and its artwork can land apart.
 *
 * Adding one is a matter of appending here and dropping a source image named
 * <id>.png through the prepare script. Nothing counts the roster.
 *
 * Four tiers, in order:
 *  - standard (5): the starter roster. Free from the moment a profile
 *    exists -- a new player picks whichever one looks like them, not just
 *    whichever came first.
 *  - premium (7): earned by playing, not bought. price stays null and
 *    unlock carries a lifetime hands-won or chips-won threshold, checked by
 *    lib/server/avatar-unlocks.ts after every hand. The two conditions
 *    alternate so grinding either style of game makes progress.
 *  - rare (5): the limited tier -- purchasable, deliberately expensive, the
 *    thing a signature avatar is not. Priced in lib/server/stripe.ts's
 *    Gold-pack economy, not arbitrarily.
 *  - signature (3): unchanged -- earned via a specific one-off achievement,
 *    never for sale, no relation to the hands/chips-won unlock ladder.
 */
const illustratedAvatarCosmetics: Cosmetic[] = [
  {
    id: "avatar-regular",
    slot: "avatar",
    name: "The Regular",
    description: "Knows the room, knows the rake. Yours from the start.",
    rarity: "standard",
    price: 0,
  },
  {
    id: "avatar-grinder",
    slot: "avatar",
    name: "The Grinder",
    description: "Plays the long session. Counts profit by the month, not the hand.",
    rarity: "standard",
    price: 0,
  },
  {
    id: "avatar-shark",
    slot: "avatar",
    name: "The Shark",
    description: "Quiet until the river.",
    rarity: "standard",
    price: 0,
  },
  {
    id: "avatar-prospect",
    slot: "avatar",
    name: "The Prospect",
    description: "New to the room and already hard to read.",
    rarity: "standard",
    price: 0,
  },
  {
    id: "avatar-rock",
    slot: "avatar",
    name: "The Rock",
    description: "Folds for an hour, then takes your stack.",
    rarity: "standard",
    price: 0,
  },
  {
    id: "avatar-rounder",
    slot: "avatar",
    name: "The Rounder",
    description: "Makes a living in rooms like this one.",
    rarity: "premium",
    price: null,
    unlock: { handsWon: 25 },
  },
  {
    id: "avatar-closer",
    slot: "avatar",
    name: "The Closer",
    description: "Never leaves a pot on the table.",
    rarity: "premium",
    price: null,
    unlock: { chipsWon: 50000 },
  },
  {
    id: "avatar-host",
    slot: "avatar",
    name: "The Host",
    description: "Runs the room, and remembers every hand you've played in it.",
    rarity: "premium",
    price: null,
    unlock: { handsWon: 75 },
  },
  {
    id: "avatar-veteran",
    slot: "avatar",
    name: "The Veteran",
    description: "Has folded better hands than you've shown.",
    rarity: "premium",
    price: null,
    unlock: { chipsWon: 250000 },
  },
  {
    id: "avatar-maniac",
    slot: "avatar",
    name: "The Maniac",
    description: "Raises. You will find out why later.",
    rarity: "premium",
    price: null,
    unlock: { handsWon: 200 },
  },
  {
    id: "avatar-crusher",
    slot: "avatar",
    name: "The Crusher",
    description: "Table changes when they sit down.",
    rarity: "premium",
    price: null,
    unlock: { chipsWon: 1000000 },
  },
  {
    id: "avatar-latereg",
    slot: "avatar",
    name: "The Late Reg",
    description: "Arrives on the second break and still finishes ahead.",
    rarity: "premium",
    price: null,
    unlock: { handsWon: 500 },
  },
  {
    id: "avatar-nightowl",
    slot: "avatar",
    name: "The Night Owl",
    description: "Plays best after everyone sensible has gone home.",
    rarity: "rare",
    price: 750000,
  },
  {
    id: "avatar-highroller",
    slot: "avatar",
    name: "The High Roller",
    description: "Buys in for the maximum. Every time, without asking the price.",
    rarity: "rare",
    price: 1500000,
  },
  {
    id: "avatar-chipleader",
    slot: "avatar",
    name: "The Chip Leader",
    description: "Counts it in towers because it no longer fits in stacks.",
    rarity: "rare",
    price: 2500000,
  },
  {
    id: "avatar-nosebleed",
    slot: "avatar",
    name: "The Nosebleed",
    description: "Plays stakes the rest of the room comes to watch.",
    rarity: "rare",
    price: 4000000,
  },
  {
    id: "avatar-ambassador",
    slot: "avatar",
    name: "The Ambassador",
    description: "The face the room puts on its poster.",
    rarity: "rare",
    price: 6000000,
  },
  {
    id: "avatar-housename",
    slot: "avatar",
    name: "House Name",
    description: "Awarded for taking a High-stakes pot. Not for sale.",
    rarity: "signature",
    price: null,
  },
  {
    id: "avatar-finaltable",
    slot: "avatar",
    name: "Final Table",
    description: "Awarded for being the last player with chips. Not for sale.",
    rarity: "signature",
    price: null,
  },
  {
    id: "avatar-ace",
    slot: "avatar",
    name: "The Ace",
    description: "The room's own. Earned, never bought.",
    rarity: "signature",
    price: null,
  },
];

/**
 * Rigged characters share the avatar ownership/equip slot with illustrated
 * characters, but remain a separate Collection state so the two art systems
 * do not get mixed into one grid. They are free while the 3D selection is
 * being introduced; ownership still flows through the same server path.
 */
export const character3DCosmetics: Cosmetic[] = CHARACTERS_3D.map((character) => ({
  id: character.id,
  slot: "avatar",
  name: character.name,
  description: "A fully rigged table character, ready for motion in the 3D room.",
  rarity: character.tier === "premium" ? "premium" : "standard",
  price: 0,
  renderMode: "3d",
}));

export const avatarCosmetics: Cosmetic[] = [
  ...illustratedAvatarCosmetics,
  ...character3DCosmetics,
];

/** What a brand-new profile has, and falls back to if anything goes missing. */
export const DEFAULT_CARD_BACK = "back-house";
export const DEFAULT_AVATAR_COSMETIC = "avatar-regular";

export const cosmetics: Cosmetic[] = [...cardBackCosmetics, ...avatarCosmetics];

export function cosmeticById(id: string): Cosmetic | null {
  return cosmetics.find((item) => item.id === id) ?? null;
}

export type CardBackArtwork = NonNullable<Cosmetic["art"]>;

/**
 * The three values a card back is drawn from, for any id.
 *
 * Total rather than nullable, and that is the point: this is called for every
 * face-down card on the table, several times per seat per hand. A seat
 * carrying an id from a since-renamed item, a table dealt before card backs
 * reached the felt, a bot with nothing equipped -- each resolves to the house
 * deck instead of putting `undefined` into a fill attribute and blanking the
 * card. The store's own preview goes through here too, so what a player is
 * shown before buying is drawn by the same code as what they get.
 */
export function cardBackArt(id: string | null | undefined): CardBackArtwork {
  const item = typeof id === "string" ? cosmeticById(id) : null;
  if (item?.slot === "cardBack" && item.art) return item.art;
  return cosmeticById(DEFAULT_CARD_BACK)!.art!;
}

/**
 * The backs a bot may be dealt, by seat position.
 *
 * Standard tier only. Bots cycle the *whole* avatar roster (botAvatarFor)
 * because a face is just a face, but a card back is something a player is
 * asked to spend 400,000 Gold on, and a table where the bots are holding the
 * rare items devalues the only thing this catalog sells. Restricting them to
 * the free and cheap tier keeps a real player's back the most interesting one
 * at the table, while still showing the feature exists to someone playing
 * their first hand against five bots -- who would otherwise see six identical
 * house decks and no reason to visit the store.
 */
const botCardBacks = cardBackCosmetics.filter((item) => item.rarity === "standard");

export function botCardBackFor(position: number): string {
  if (botCardBacks.length === 0) return DEFAULT_CARD_BACK;
  return botCardBacks[position % botCardBacks.length].id;
}

/** Items granted to everyone -- free, so never held in the ownership table. */
export function isFreeCosmetic(item: Cosmetic): boolean {
  return item.price === 0;
}

export function isPurchasable(item: Cosmetic): boolean {
  return typeof item.price === "number" && item.price > 0;
}

/** A player's equipped choices, with independent 2D and 3D avatar slots. */
export interface EquippedCosmetics {
  cardBack: string;
  avatar2d: string;
  avatar3d: string;
}

export const DEFAULT_3D_AVATAR = CHARACTERS_3D[0]?.id ?? "gloria";

export const defaultEquipped: EquippedCosmetics = {
  cardBack: DEFAULT_CARD_BACK,
  avatar2d: DEFAULT_AVATAR_COSMETIC,
  avatar3d: DEFAULT_3D_AVATAR,
};

/**
 * Coerces stored or client-sent equipment into something renderable, and
 * refuses to equip anything that isn't a real item in the right slot.
 */
export function normalizeEquipped(raw: unknown): EquippedCosmetics {
  const input = (raw ?? {}) as Record<string, unknown>;
  const pick = (value: unknown, renderMode: "2d" | "3d", fallback: string) => {
    const item = typeof value === "string" ? cosmeticById(value) : null;
    return item && item.slot === "avatar" && (item.renderMode ?? "2d") === renderMode
      ? item.id
      : fallback;
  };
  const legacyAvatar = input.avatar;
  return {
    cardBack: cosmeticById(String(input.cardBack ?? ""))?.slot === "cardBack"
      ? String(input.cardBack)
      : DEFAULT_CARD_BACK,
    avatar2d: pick(input.avatar2d ?? (typeof legacyAvatar === "string" && (cosmeticById(legacyAvatar)?.renderMode ?? "2d") === "2d" ? legacyAvatar : undefined), "2d", DEFAULT_AVATAR_COSMETIC),
    avatar3d: pick(input.avatar3d ?? (typeof legacyAvatar === "string" && cosmeticById(legacyAvatar)?.renderMode === "3d" ? legacyAvatar : undefined), "3d", DEFAULT_3D_AVATAR),
  };
}
