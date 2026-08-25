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
import { SEAT_ART_CHARACTERS, seatArtSrc } from "@/lib/scene/seat-art";

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
   * Card backs are drawn from two colours -- a stock and an ink -- through
   * one shared ornate template (see components/card-back-art.tsx); avatars
   * are supplied artwork. Exactly one of these is set per item, which is
   * what lets a single ownership and purchase path serve both.
   */
  art?: { base: string; ink: string };
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
 * An avatar's artwork is the seat-art roster's own 0deg plate
 * (`art/seats/<id>/0.png`, built by `scripts/prepare-seat-art.py` -- see
 * `lib/scene/seat-art.ts`). One character-shaped id space now serves the
 * store card, the small circular avatar, and the character actually drawn
 * at that player's own racetrack seat, which is what makes "buy a
 * character" and "that's who you are at the table" the same claim.
 *
 * `avatarFigure`/`avatarFace` used to be two different derivative images (a
 * full figure and a separate head crop) off a retired `art/avatars/`
 * convention. A seat-art plate is already framed head-to-hands -- the same
 * shot works at both sizes -- so both functions resolve to the same file
 * now; they stay separate functions because their call sites (store card vs.
 * small circle) are conceptually different and may want to diverge again.
 *
 * No cache-busting version on this path, deliberately. Ids are stable so
 * ownership survives an art change, which leaves the URL stable too -- but
 * both the raw file and the optimised one are served `max-age=0,
 * must-revalidate`, so a browser asks every time and replaced artwork appears
 * immediately. The only cache that does hold the old file is Next's own
 * server-side optimiser cache, which a deploy rebuilds. A `?v=` query was
 * tried and reverted: next/image rejects query strings on local sources
 * unless they are enumerated in images.localPatterns.
 */
export function avatarFigure(id: string): string {
  return seatArtSrc(id, 0);
}

/** Same file as `avatarFigure` -- see that function's own comment for why. */
export function avatarFace(id: string): string {
  return seatArtSrc(id, 0);
}

/** Browser-captured thumbnail of a rigged character for the Collection grid. */
export function characterThumbnail(id: string): string {
  return `/collection/${id}.png`;
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
    art: { base: "#1d4636", ink: "#8fbfa6" },
  },
  {
    id: "back-oxblood",
    slot: "cardBack",
    name: "Oxblood",
    description: "Deep red stock, engraved.",
    rarity: "standard",
    price: 25000,
    art: { base: "#5a1f22", ink: "#d9a2a0" },
  },
  {
    id: "back-slate",
    slot: "cardBack",
    name: "Slate",
    description: "Cool grey stock, engraved.",
    rarity: "standard",
    price: 25000,
    art: { base: "#2b3138", ink: "#9aa7b2" },
  },
  {
    id: "back-brass",
    slot: "cardBack",
    name: "Brass",
    description: "Warm metal ink under the lamp.",
    rarity: "premium",
    price: 250000,
    art: { base: "#4a3a1c", ink: "#d9b85d" },
  },
  {
    id: "back-midnight",
    slot: "cardBack",
    name: "Midnight",
    description: "Near-black stock, the engraving only catches up close.",
    rarity: "premium",
    price: 250000,
    art: { base: "#141a22", ink: "#6f7f96" },
  },
  {
    id: "back-ivory",
    slot: "cardBack",
    name: "Ivory Crest",
    description: "Bone stock, engraved in bronze. Rare enough to notice.",
    rarity: "rare",
    price: 400000,
    art: { base: "#ded6c2", ink: "#8a6a22" },
  },
  {
    id: "back-riverwood",
    slot: "cardBack",
    name: "Riverwood",
    description: "Awarded for playing a thousand hands in this room.",
    rarity: "signature",
    price: null,
    art: { base: "#23301f", ink: "#c9a25e" },
  },
];

/**
 * Avatars. The same 25-character roster the racetrack table draws opponent
 * seats from (`lib/scene/seat-art.ts`'s `SEAT_ART_CHARACTERS`) is what's for
 * sale here -- one id space, so "buy a character" and "that's who's drawn at
 * my seat" are the same claim instead of two systems that happen to agree.
 *
 * Every roster entry needs an offer below; a character added to the seat-art
 * bucket with no matching entry here throws rather than silently landing on
 * the free-starter default (see `characterAvatarCosmetics`).
 *
 * Names are plain character names, not gamer tags -- that convention was
 * tried first (2026-08-21) and reversed the same week: a seated opponent
 * should read as a real player's own handle, which is what
 * `lib/game/engine.ts`'s SEPARATE bot-tag pool is for, while a store card
 * names the character on it the way a normal person is named. Nothing maps a
 * character to a bot; a player wearing character7 still shows their own name.
 *
 * Three tiers, in order:
 *  - standard (character4, character9): the starter roster. Free from the
 *    moment a profile exists -- one man, one woman.
 *  - rare (character5-8, character10-25): Gold-purchasable, one ascending
 *    ladder, 80,000 up to 2,550,000, decelerating from ~50% a rung down to
 *    ~9% by the top.
 *  - signature (character1-3): earned only, on a lifetime hands-won ladder
 *    (250/750/1,500 hands) checked by `lib/server/avatar-unlocks.ts` after
 *    every hand. `price` is null on these and must stay null -- Gold buying
 *    a shortcut past the threshold is exactly what would make the tier mean
 *    nothing, the same rule `back-riverwood` and the 3D roster's earned
 *    characters follow.
 *
 * RENUMBERED 2026-08-25 (Kayo's explicit call, having accepted the one real
 * cost: a player's equipped avatar is stored by this exact id string, so
 * anyone who had already bought/equipped one of the old ids would fall back
 * to the default -- judged low-risk this soon after the ids in question went
 * live). The roster had accumulated gaps from several same-day deletions
 * (character29, 31-34 removed, leaving 13-28/30/35-41) and read as a mess of
 * arbitrary numbers; ids are now a clean character1-24, tier boundaries
 * preserved exactly, plus a new character25. The Gold ladder was repriced in
 * the same pass to close a discontinuity the deletions had left in it
 * (removing four mid-ladder characters without repricing the survivors above
 * them had produced an ~86% jump between two adjacent rungs) -- it's now one
 * smooth decelerating sequence start to finish. Old gamer-tag-style names on
 * the earlier characters (`amaraa_04`, `ttv_danpark`, `nico_noscope`, ...)
 * were fixed to real names in the same pass, closing out the one convention
 * left over from before the 2026-08-21 reversal above.
 *
 * Full narrative history of how each individual character's art arrived
 * (sheet quirks, facing fixes, slicer changes) has been pruned along with
 * the old ids it was anchored to -- recover it from `git log` on this file
 * if needed; what's kept here is the standing rules, not the play-by-play.
 */
const characterAvatarOffers: Record<
  string,
  { name: string; description: string; price: number | null; unlock?: Cosmetic["unlock"] }
> = {
  character1: {
    name: "Amara Cole",
    description: "Young. Fearless. Winning. Earned by winning 250 hands.",
    price: null,
    unlock: { handsWon: 250 },
  },
  character2: {
    name: "Jesse West",
    description: "Laid-back till the blinds hit. Earned by winning 750 hands.",
    price: null,
    unlock: { handsWon: 750 },
  },
  character3: {
    name: "Wyatt Morgan",
    description: "Rode in with a plan. Hasn't folded it yet. Earned by winning 1,500 hands.",
    price: null,
    unlock: { handsWon: 1_500 },
  },
  character4: { name: "Dan Park", description: "Self-taught. Self-made. Dangerous.", price: 0 },
  character5: { name: "Zay Brooks", description: "Half your age, twice your stack.", price: 80_000 },
  character6: { name: "Nico Nolan", description: "Reading chips like code. Sees what you don't.", price: 120_000 },
  character7: { name: "Kohl Davis", description: "Numbers never lie. Neither does she.", price: 170_000 },
  character8: { name: "Omar Salem", description: "Blank. Calculated. Unreadable.", price: 230_000 },
  character9: { name: "Ella Bennett", description: "Sweet as honey. Sharp as a blade.", price: 0 },
  character10: { name: "Marcus Vale", description: "All-in on his own game. Every hand.", price: 300_000 },
  character11: { name: "Milo Winters", description: "Collects tells like cards. Knows your every move.", price: 380_000 },
  character12: { name: "Zoraq", description: "No expression. No tells. No mercy.", price: 470_000 },
  character13: { name: "Ari Locke", description: "Broke the algorithm once. Keeps doing it.", price: 570_000 },
  character14: { name: "Adelaide Sinclair", description: "Old money plays tighter. She proves it every hand.", price: 680_000 },
  character15: { name: "Kira Voss", description: "Speaks in folds. Listens in calls.", price: 800_000 },
  character16: { name: "Danny Marsh", description: "Each hand like it's for everything. Because it is.", price: 930_000 },
  character17: { name: "Gunner Zane", description: "Streamed his way to the top. Chat's his co-pilot.", price: 1_070_000 },
  character18: { name: "Malik Devon", description: "Too young to doubt himself. Too good to care.", price: 1_220_000 },
  character19: { name: "Andre Boone", description: "Hidden behind shades. Never lets you in.", price: 1_380_000 },
  character20: { name: "Simone Hart", description: "Folds slowly. Wins fast.", price: 1_550_000 },
  character21: { name: "Rory Quinn", description: "Silent predator. Then the river hits.", price: 1_730_000 },
  character22: { name: "Kenji Sato", description: "Taught by legends. Teaches the table humility.", price: 1_920_000 },
  character23: { name: "Roy Castellan", description: "No cards, no problem. Makes every hand work.", price: 2_120_000 },
  character24: { name: "Declan Byrne", description: "Smiling bluff or genuine crush? Exactly the confusion he wants.", price: 2_330_000 },
  character25: { name: "Bodie Ferris", description: "Cap backwards, confidence forward.", price: 2_550_000 },
};

export const characterAvatarCosmetics: Cosmetic[] = SEAT_ART_CHARACTERS.map((character) => {
  const offer = characterAvatarOffers[character.id];
  if (!offer) {
    throw new Error(`Seat-art character ${character.id} has no avatar catalog entry.`);
  }
  return {
    id: character.id,
    slot: "avatar",
    name: offer.name,
    description: offer.description,
    // An earned character reads as `signature`, not as a `standard` starter.
    // Deriving the tier from `price > 0` alone would put the whole earned
    // ladder in the free bucket, since both carry no Gold price.
    rarity: offer.unlock ? "signature" : offer.price ? "rare" : "standard",
    price: offer.price,
    ...(offer.unlock ? { unlock: offer.unlock } : {}),
  };
});

/**
 * Acquisition rules for the eight customer-pack characters. Keeping this
 * beside the cosmetic catalog makes the price and unlock threshold part of
 * the same server-owned record used by purchase/equip; the browser never gets
 * to decide whether one of these characters is free.
 *
 * The original six remain the starter roster. Three of the new characters are
 * lifetime hand-win rewards and five are deliberately expensive Gold items.
 * No customer-pack character may fall through to the starter `price: 0`
 * default below.
 */
const premiumCharacter3DOffers: Record<string, Pick<Cosmetic, "description" | "price" | "unlock">> = {
  claira: {
    description:
      "gf of owner. She is an AET and soon to be civil engineer, relatively new to poker but dont underestimate her",
    price: 7_000_000,
  },
  donni: {
    description: "A fully rigged table character. Earned by winning 50 hands.",
    price: null,
    unlock: { handsWon: 50 },
  },
  jimmy: {
    description: "A fully rigged table character. Earned by winning 150 hands.",
    price: null,
    unlock: { handsWon: 150 },
  },
  kenji: {
    description: "A fully rigged table character. Earned by winning 500 hands.",
    price: null,
    unlock: { handsWon: 500 },
  },
  derek: {
    description: "A premium fully rigged character for the 3D room.",
    price: 1_000_000,
  },
  oscar: {
    description: "A premium fully rigged character for the 3D room.",
    price: 2_000_000,
  },
  victor: {
    description: "A premium fully rigged character for the 3D room.",
    price: 4_000_000,
  },
  marcus: {
    description: "A premium fully rigged character for the 3D room.",
    price: 6_000_000,
  },
};

/**
 * Rigged characters share ownership infrastructure with illustrated avatars,
 * but keep an independent equipment slot and Collection grid. Starter entries
 * are implicitly owned; every premium roster entry must have an offer above.
 */
export const character3DCosmetics: Cosmetic[] = CHARACTERS_3D.map((character) => {
  const offer = premiumCharacter3DOffers[character.id];
  if (character.tier === "premium" && !offer) {
    throw new Error(`Premium 3D character ${character.id} has no acquisition rule.`);
  }
  return {
    id: character.id,
    slot: "avatar",
    name: character.name,
    description: offer?.description ?? "A starter character for the 3D room.",
    rarity: character.tier === "premium" ? "premium" : "standard",
    // `null` is meaningful: earned-only. Nullish coalescing would turn it
    // back into zero and silently grant every progress reward to everyone.
    price: offer ? offer.price : 0,
    ...(offer?.unlock ? { unlock: offer.unlock } : {}),
    renderMode: "3d",
  };
});

export const avatarCosmetics: Cosmetic[] = [
  ...characterAvatarCosmetics,
  ...character3DCosmetics,
];

/** What a brand-new profile has, and falls back to if anything goes missing. */
export const DEFAULT_CARD_BACK = "back-house";
export const DEFAULT_AVATAR_COSMETIC = "character4";

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
 * Standard tier only. Bots cycle the character avatar roster minus its
 * earned tier (botAvatarFor, `botAvatarCosmetics` below) because a face is
 * mostly just a face, but a card back is something a player is
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

/**
 * The faces a bot may wear. The whole character roster except the earned
 * tier -- for the same reason `botCardBacks` stops at standard, one step
 * further along. A bot showing up in a character a player is 1,500 won hands
 * away from is the avatar version of bots holding the rare card backs: it
 * says the threshold buys you nothing anyone can see. Gold-priced characters
 * stay in, deliberately -- a bot wearing one advertises the store, and it is
 * a thing a player can go and get today rather than a claim about their
 * history at this table.
 */
export const botAvatarCosmetics: Cosmetic[] = characterAvatarCosmetics.filter((item) => !item.unlock);

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
