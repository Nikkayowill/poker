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
   * Path under /public for an image-based item. Missing files degrade to the
   * generated figure rather than a broken image, so catalog entries can land
   * before their artwork does.
   */
  image?: string;
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
    price: 1200,
    art: { base: "#5a1f22", ink: "#d9a2a0", pattern: "chevron" },
  },
  {
    id: "back-slate",
    slot: "cardBack",
    name: "Slate",
    description: "Cool grey, pinstriped like a good suit.",
    rarity: "standard",
    price: 1200,
    art: { base: "#2b3138", ink: "#9aa7b2", pattern: "pinstripe" },
  },
  {
    id: "back-brass",
    slot: "cardBack",
    name: "Brass",
    description: "Warm metal rings under the lamp.",
    rarity: "premium",
    price: 3500,
    art: { base: "#4a3a1c", ink: "#d9b85d", pattern: "rings" },
  },
  {
    id: "back-midnight",
    slot: "cardBack",
    name: "Midnight",
    description: "Near-black with a quiet lattice you only catch up close.",
    rarity: "premium",
    price: 3500,
    art: { base: "#141a22", ink: "#6f7f96", pattern: "lattice" },
  },
  {
    id: "back-ivory",
    slot: "cardBack",
    name: "Ivory Crest",
    description: "Bone stock, engraved crest. Rare enough to notice.",
    rarity: "rare",
    price: 11000,
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
 * Drop the artwork at public/avatars/<id>.webp to match each id below. Until
 * a file exists the entry still lists and sells; it simply renders the
 * generated figure in the meantime, so artwork and catalog can land apart.
 */
export const avatarCosmetics: Cosmetic[] = [
  {
    id: "avatar-regular",
    slot: "avatar",
    name: "The Regular",
    description: "Knows the room, knows the rake. Yours from the start.",
    rarity: "standard",
    price: 0,
    image: "/avatars/avatar-regular.webp",
  },
  {
    id: "avatar-shark",
    slot: "avatar",
    name: "The Shark",
    description: "Quiet until the river.",
    rarity: "standard",
    price: 1500,
    image: "/avatars/avatar-shark.webp",
  },
  {
    id: "avatar-veteran",
    slot: "avatar",
    name: "The Veteran",
    description: "Has folded better hands than you've shown.",
    rarity: "premium",
    price: 4000,
    image: "/avatars/avatar-veteran.webp",
  },
  {
    id: "avatar-closer",
    slot: "avatar",
    name: "The Closer",
    description: "Never leaves a pot on the table.",
    rarity: "premium",
    price: 4000,
    image: "/avatars/avatar-closer.webp",
  },
  {
    id: "avatar-nightowl",
    slot: "avatar",
    name: "The Night Owl",
    description: "Plays best after everyone sensible has gone home.",
    rarity: "rare",
    price: 12000,
    image: "/avatars/avatar-nightowl.webp",
  },
  {
    id: "avatar-housename",
    slot: "avatar",
    name: "House Name",
    description: "Awarded for taking a High-stakes pot. Not for sale.",
    rarity: "signature",
    price: null,
    image: "/avatars/avatar-housename.webp",
  },
];

/** What a brand-new profile has, and falls back to if anything goes missing. */
export const DEFAULT_CARD_BACK = "back-house";
export const DEFAULT_AVATAR_COSMETIC = "avatar-regular";

export const cosmetics: Cosmetic[] = [...cardBackCosmetics, ...avatarCosmetics];

export function cosmeticById(id: string): Cosmetic | null {
  return cosmetics.find((item) => item.id === id) ?? null;
}

/** Items granted to everyone -- free, so never held in the ownership table. */
export function isFreeCosmetic(item: Cosmetic): boolean {
  return item.price === 0;
}

export function isPurchasable(item: Cosmetic): boolean {
  return typeof item.price === "number" && item.price > 0;
}

/** A player's equipped choices, one per slot. */
export interface EquippedCosmetics {
  cardBack: string;
  avatar: string;
}

export const defaultEquipped: EquippedCosmetics = {
  cardBack: DEFAULT_CARD_BACK,
  avatar: DEFAULT_AVATAR_COSMETIC,
};

/**
 * Coerces stored or client-sent equipment into something renderable, and
 * refuses to equip anything that isn't a real item in the right slot.
 */
export function normalizeEquipped(raw: unknown): EquippedCosmetics {
  const input = (raw ?? {}) as Partial<Record<keyof EquippedCosmetics, unknown>>;
  const pick = (value: unknown, slot: CosmeticSlot, fallback: string) => {
    const item = typeof value === "string" ? cosmeticById(value) : null;
    return item && item.slot === slot ? item.id : fallback;
  };
  return {
    cardBack: pick(input.cardBack, "cardBack", DEFAULT_CARD_BACK),
    avatar: pick(input.avatar, "avatar", DEFAULT_AVATAR_COSMETIC),
  };
}
