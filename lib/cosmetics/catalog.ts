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

export type CosmeticSlot = "cardBack";

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  description: string;
  rarity: Rarity;
  /** Gold price. Null means it cannot be bought at any price -- see below. */
  price: number | null;
  /** Two colours and a pattern, interpreted by the card-back renderer. */
  art: { base: string; ink: string; pattern: "lattice" | "chevron" | "rings" | "pinstripe" | "crest" };
}

/**
 * Signature items are deliberately unpriced. Nothing about the most
 * impressive thing at the table should be purchasable -- that rule is what
 * keeps status meaningful and is the main defence against the product
 * reading as pay-to-flex. They are granted by achievement instead.
 */
export const cosmetics: Cosmetic[] = [
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

/** What a brand-new profile has, and falls back to if anything goes missing. */
export const DEFAULT_CARD_BACK = "back-house";

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
}

export const defaultEquipped: EquippedCosmetics = { cardBack: DEFAULT_CARD_BACK };

/**
 * Coerces stored or client-sent equipment into something renderable, and
 * refuses to equip anything that isn't a real item in the right slot.
 */
export function normalizeEquipped(raw: unknown): EquippedCosmetics {
  const input = (raw ?? {}) as Partial<Record<keyof EquippedCosmetics, unknown>>;
  const cardBack = typeof input.cardBack === "string" ? cosmeticById(input.cardBack) : null;
  return {
    cardBack: cardBack && cardBack.slot === "cardBack" ? cardBack.id : DEFAULT_CARD_BACK,
  };
}
