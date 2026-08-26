/**
 * The cosmetic catalog. Like the avatar options, it lives in TypeScript
 * rather than the database: a new item is an entry here plus artwork, with
 * no migration and no admin CMS, and the compiler catches every reference.
 * Only *ownership* is dynamic enough to belong in Postgres.
 *
 * Card backs come first: they have the highest visibility in the product
 * (a large surface, shown on every hidden hand, seen by the whole table),
 * so they're the item most worth owning and the fairest test of whether
 * anyone wants to spend Gold at all.
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
  /** Gold price. Null means it cannot be bought at any price; see below. */
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
   * Exactly one of the two is set per unlockable item, never both, so a
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
 * (`art/seats/<id>/0.png`, built by `scripts/prepare-seat-art.py`; see
 * `lib/scene/seat-art.ts`). One character-shaped id space now serves the
 * store card, the small circular avatar, and the character actually drawn
 * at that player's own racetrack seat, which is what makes "buy a
 * character" and "that's who you are at the table" the same claim.
 *
 * `avatarFigure`/`avatarFace` used to resolve to two different derivative
 * images (a full figure and a separate head crop) off a retired
 * `art/avatars/` convention. A seat-art plate is already framed
 * head-to-hands, so the same shot works at both sizes and both functions
 * resolve to the same file now; they stay separate functions because their
 * call sites (store card vs. small circle) are conceptually different and
 * may want to diverge again.
 *
 * No cache-busting version on this path. Ids are stable so ownership
 * survives an art change, which leaves the URL stable too, but both the
 * raw file and the optimised one are served `max-age=0, must-revalidate`,
 * so a browser asks every time and replaced artwork appears immediately.
 * The only cache that does hold the old file is Next's own server-side
 * optimiser cache, which a deploy rebuilds. A `?v=` query was tried and
 * reverted: next/image rejects query strings on local sources unless they
 * are enumerated in images.localPatterns.
 */
export function avatarFigure(id: string): string {
  return seatArtSrc(id, 0);
}

/** Same file as `avatarFigure`; see that function's own comment for why. */
export function avatarFace(id: string): string {
  return seatArtSrc(id, 0);
}

/** Browser-captured thumbnail of a rigged character for the Collection grid. */
export function characterThumbnail(id: string): string {
  return `/collection/${id}.png`;
}

/**
 * Signature items are unpriced. Nothing about the most impressive thing at
 * the table should be purchasable: that rule is what keeps status
 * meaningful and is the main defence against the product reading as
 * pay-to-flex. They are granted by achievement instead.
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
 * Avatars. The same character roster the racetrack table draws opponent
 * seats from (`lib/scene/seat-art.ts`'s `SEAT_ART_CHARACTERS`) is what's for
 * sale here: one id space, so "buy a character" and "that's who's drawn at
 * my seat" are the same claim instead of two systems that happen to agree.
 *
 * Every roster entry needs an offer below; a character added to the
 * seat-art bucket with no matching entry here throws rather than silently
 * landing on the free-starter default (see `characterAvatarCosmetics`).
 *
 * Names are gamer tags: a character is a person somebody could be playing
 * against, and what a person at an online table has over their seat is a
 * handle they typed for themselves. So these are written the way real tags
 * are: lowercase, a nickname with something stuck to it, a number, an
 * underscore, occasionally a prefix carried over from another game. The
 * persona goes in the description; the name is just the handle.
 *
 * Same register as `lib/game/engine.ts`'s bot pool, but a separate list of
 * tags: nothing maps a character to a bot. These are the store's labels for
 * a face; the bot pool is who is sitting in the chair. A player wearing
 * character7 still shows their own name, never "terrelltilts".
 *
 * Three tiers, in order:
 *  - standard (character16, character21): the starter roster, free from
 *    the moment a profile exists. One man, one woman.
 *  - rare (character17-20, character22-41): Gold-purchasable, one
 *    ascending ladder from 80,000 up to 3,680,000, decelerating from
 *    ~50% a rung down to ~9-12% by the top.
 *  - signature (character13-15): earned only, on a lifetime hands-won
 *    ladder checked by `lib/server/avatar-unlocks.ts` after every hand.
 *    `price` is null on these and must stay null: Gold buying a shortcut
 *    past the threshold is exactly what would make the tier mean nothing,
 *    the same rule `back-riverwood` and the 3D roster's earned characters
 *    follow.
 *
 * Later batches (character22 onward) carry a character name rather than a
 * gamer tag, since the underscored handle register is reserved for the
 * in-game bot pool: a store card names the person, a bot's tag is how they
 * signed into the room.
 *
 * These characters arrive as Kayo-supplied turnaround sheets run through
 * `slice-seat-sheet.py`. There's no automated check that a sheet's figure
 * faces the right way, so eyeball the widest panel against a known-good
 * character (character16/17) before trusting a "no --mirror needed" call
 * on a new batch: a wrong call here has shipped characters facing away
 * from the pot before. A sheet whose panels touch with no gutter, or that
 * boxes caption text inside the figure band, needs the slicer's
 * manual-split path or a hand crop rather than the default column split.
 *
 * character36-41 are the first characters carrying only 0deg and 20deg
 * plates rather than the usual three: `pickSeatArt` already takes the two
 * flattest angles a character actually has, and `seatArtCharacterForSlot`
 * already keeps a character out of a seat whose override forces an angle
 * it lacks, so nothing needed to change for that.
 *
 * The original character1-12 (five standard-tier, seven rare) were deleted
 * outright, art and catalog both. `DEFAULT_AVATAR_COSMETIC` now points at
 * character16; `normalizeEquipped` already falls back to it for anyone
 * whose stored `avatar2d` no longer resolves (`cosmeticById` returns null
 * for a deleted id), so an existing profile that owned or had one of the
 * twelve equipped just lands on the new default next render. No migration
 * needed.
 */
const characterAvatarOffers: Record<
  string,
  { name: string; description: string; price: number | null; unlock?: Cosmetic["unlock"] }
> = {
  character13: {
    name: "amaraa_04",
    description: "Youngest at the table, last one out of the hand. Earned by winning 250 hands.",
    price: null,
    unlock: { handsWon: 250 },
  },
  character14: {
    name: "jesse_westside",
    description: "Sun-bleached and unbothered, right up until he raises. Earned by winning 750 hands.",
    price: null,
    unlock: { handsWon: 750 },
  },
  character15: {
    name: "wyatt_wanders",
    description: "Rolled in off the highway with a flannel and a plan. Earned by winning 1,500 hands.",
    price: null,
    unlock: { handsWon: 1_500 },
  },
  character16: { name: "ttv_danpark", description: "Nobody taught him this game. He just watched, and then he sat down.", price: 0 },
  character17: { name: "zay_brooks", description: "Half your age, twice your patience.", price: 80_000 },
  character18: { name: "nico_noscope", description: "Reads the whole table through a curtain of hair and misses nothing.", price: 120_000 },
  character19: { name: "kohl_codes", description: "Ran the numbers before the flop and hasn't stopped since.", price: 170_000 },
  character20: { name: "omar_theoracle", description: "You won't get a read. There's nothing there to read.", price: 230_000 },
  character21: { name: "ellie_bee", description: "Polite, patient, and holding the nuts more often than she lets on.", price: 0 },
  character22: { name: "Marcus Vale", description: "Wears the chip on his sleeve. Backs it up every time.", price: 300_000 },
  character23: { name: "Milo Winters", description: "Collects more than cards. Reads people the same way.", price: 380_000 },
  character24: { name: "Zoraq", description: "No tells, no eyelids, no chance you're getting a read.", price: 470_000 },
  character25: { name: "Ari Locke", description: "Cracked the seed once, just to see if she could. Doesn't need to now.", price: 570_000 },
  character26: { name: "Adelaide Sinclair", description: "Old money, older instincts. Never raises past what she already knows.", price: 680_000 },
  character27: { name: "Kira Voss", description: "Never says a word behind those glasses. Doesn't have to.", price: 800_000 },
  character28: { name: "Danny Marsh", description: "Plays every session like it's the last one that matters.", price: 930_000 },
  character29: { name: "Sadie Rowan", description: "Followed the game across three states. Never folds first.", price: 1_070_000 },
  character30: { name: "Gunner Zane", description: "Streams every session. Chat calls it a clinic.", price: 1_220_000 },
  character31: { name: "Walt Ironhand", description: "Been playing longer than most of the table's been alive.", price: 1_380_000 },
  character32: { name: "Margot Delaney", description: "Doesn't blink at a big bet. Barely blinks at all.", price: 1_550_000 },
  character33: { name: "Dahlia Cross", description: "Bluffs like it's a dare. Usually wins the dare.", price: 1_720_000 },
  character34: { name: "Vivienne Ashworth", description: "Dressed for a gala, playing like it's rent money.", price: 1_890_000 },
  character35: { name: "Malik Devon", description: "Too young to drink at this table. Never too young to win it.", price: 2_060_000 },
  character36: { name: "Andre Boone", description: "Reads the whole table through those shades. Never takes them off.", price: 2_270_000 },
  character37: { name: "Simone Hart", description: "Arms folded, cards down, waiting you out. It usually works.", price: 2_500_000 },
  character38: { name: "Rory Quinn", description: "Quiet through four streets, then loud on the river.", price: 2_750_000 },
  character39: { name: "Kenji Sato", description: "Learned this game from his uncle. Beats him at it now.", price: 3_030_000 },
  character40: { name: "Roy Castellan", description: "Card-dead for an hour and still hasn't folded a hand wrong.", price: 3_340_000 },
  character41: { name: "Declan Byrne", description: "Smiles when he's bluffing. Smiles the rest of the time too.", price: 3_680_000 },
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
 * the same server-owned record used by purchase/equip; the browser never
 * gets to decide whether one of these characters is free.
 *
 * The original six remain the starter roster. Three of the new characters
 * are lifetime hand-win rewards and five are expensive Gold items. No
 * customer-pack character may fall through to the starter `price: 0`
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
export const DEFAULT_AVATAR_COSMETIC = "character16";

export const cosmetics: Cosmetic[] = [...cardBackCosmetics, ...avatarCosmetics];

export function cosmeticById(id: string): Cosmetic | null {
  return cosmetics.find((item) => item.id === id) ?? null;
}

export type CardBackArtwork = NonNullable<Cosmetic["art"]>;

/**
 * The three values a card back is drawn from, for any id.
 *
 * Total rather than nullable, and that's the point: this is called for
 * every face-down card on the table, several times per seat per hand. A
 * seat carrying an id from a since-renamed item, a table dealt before card
 * backs reached the felt, a bot with nothing equipped: each resolves to
 * the house deck instead of putting `undefined` into a fill attribute and
 * blanking the card. The store's own preview goes through here too, so
 * what a player is shown before buying is drawn by the same code as what
 * they get.
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
 * mostly just a face, but a card back is something a player is asked to
 * spend 400,000 Gold on, and a table where the bots are holding the rare
 * items devalues the only thing this catalog sells. Restricting them to
 * the free and cheap tier keeps a real player's back the most interesting
 * one at the table, while still showing the feature exists to someone
 * playing their first hand against five bots, who would otherwise see six
 * identical house decks and no reason to visit the store.
 */
const botCardBacks = cardBackCosmetics.filter((item) => item.rarity === "standard");

export function botCardBackFor(position: number): string {
  if (botCardBacks.length === 0) return DEFAULT_CARD_BACK;
  return botCardBacks[position % botCardBacks.length].id;
}

/**
 * The faces a bot may wear: the whole character roster except the earned
 * tier, for the same reason `botCardBacks` stops at standard, one step
 * further along. A bot showing up in a character a player is 1,500 won
 * hands away from is the avatar version of bots holding the rare card
 * backs: it says the threshold buys you nothing anyone can see. Gold-priced
 * characters stay in on purpose: a bot wearing one advertises the store,
 * and it's a thing a player can go and get today rather than a claim about
 * their history at this table.
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
