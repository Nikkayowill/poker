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

import { SEAT_ART_CHARACTERS, seatArtSrc } from "@/lib/scene/seat-art";
import type { ChipMaterial } from "@/lib/scene/chips/chip-spec";

export type Rarity = "standard" | "premium" | "rare" | "signature";

export const rarityLabels: Record<Rarity, string> = {
  standard: "Standard",
  premium: "Premium",
  rare: "Rare",
  signature: "Signature",
};

export type CosmeticSlot = "cardBack" | "avatar" | "chipDesign";

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  name: string;
  description: string;
  rarity: Rarity;
  /** Gold price. Null means it cannot be bought at any price; see below. */
  price: number | null;
  /**
   * Card backs are drawn from two colours -- a stock and an ink -- through
   * one shared ornate template (see components/card-back-art.tsx); avatars
   * are supplied artwork. Exactly one of these is set per item, which is
   * what lets a single ownership and purchase path serve both.
   */
  art?: { base: string; ink: string };
  /**
   * Chip designs are the same five colours `lib/scene/chips/chip-spec.ts`
   * paints a house chip from. Owning one doesn't put it anywhere on the felt
   * by itself -- see `EquippedCosmetics.chipDesigns` -- a player assigns an
   * owned design to whichever denomination they want it on.
   */
  chip?: ChipMaterial;
  /**
   * Avatar-only progress unlock, checked against lifetime PlayerStats after
   * every hand (lib/server/avatar-unlocks.ts) instead of a Gold purchase.
   * Exactly one of the two is set per unlockable item, never both, so a
   * player is never stuck needing two separate kinds of progress to earn one
   * avatar. price stays null on these: they are earned, not for sale, same
   * rule as the signature tier below just gated on a lower bar.
   */
  unlock?: { handsWon: number } | { chipsWon: number };
  /**
   * Grants equip access to whoever holds the admin badge
   * (`profile.adminBadge`, see lib/server/profile-store.ts), instead of a
   * purchase or an unlock threshold. Never for sale (isPurchasable requires
   * a positive price, so price stays null here same as the earned tier) and
   * never shown to a player without the badge -- filtered out of the
   * catalog payload in app/api/cosmetics/route.ts, so it never renders as a
   * locked/preview card either. Also excluded from `botAvatarCosmetics` and
   * from the random opponent-seat fallback pool
   * (`lib/scene/seat-art.ts`'s `ADMIN_ONLY_CHARACTER_IDS`) -- a bot or a
   * stranger's stale seat must never wear this face. Revoking the badge
   * does not un-equip an avatar already chosen; it only stops a future
   * equip from succeeding, the same posture every other admin flag here
   * takes.
   */
  adminOnly?: boolean;
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
 * sale here: one id space, so "buy a character" and "that's who's drawn at
 * my seat" are the same claim instead of two systems that happen to agree.
 *
 * Every roster entry needs an offer below; a character added to the
 * seat-art bucket with no matching entry here throws rather than silently
 * landing on the free-starter default (see `characterAvatarCosmetics`).
 *
 * Names are plain character names, not gamer tags; that convention was
 * tried first (2026-08-21) and reversed the same week: a seated opponent
 * should read as a real player's own handle, which is what
 * `lib/game/engine.ts`'s SEPARATE bot-tag pool is for, while a store card
 * names the character on it the way a normal person is named. Nothing maps a
 * character to a bot; a player wearing character7 still shows their own name.
 *
 * Three tiers, in order:
 *  - standard (character4, character9): the starter roster. Free from the
 *    moment a profile exists, one man, one woman.
 *  - rare (character5-8, character10-31): Gold-purchasable, one ascending
 *    ladder, 80,000 up to 4,080,000, decelerating from ~50% a rung down to
 *    ~7% by the top. character26-29 (added 2026-08-26) and character30-31
 *    (added the same day) continue the same constant-second-difference
 *    sequence (delta grows by 10,000 each rung) rather than starting a new
 *    curve.
 *  - signature (character1-3): earned only, on a lifetime hands-won ladder
 *    (250/750/1,500 hands) checked by `lib/server/avatar-unlocks.ts` after
 *    every hand. `price` is null on these and must stay null: Gold buying
 *    a shortcut past the threshold is exactly what would make the tier mean
 *    nothing, the same rule `back-riverwood` follows.
 *
 * Renumbered 2026-08-25 (Kayo's explicit call, having accepted the one real
 * cost: a player's equipped avatar is stored by this exact id string, so
 * anyone who had already bought/equipped one of the old ids would fall back
 * to the default, judged low-risk this soon after the ids in question went
 * live). The roster had accumulated gaps from several same-day deletions
 * (character29, 31-34 removed, leaving 13-28/30/35-41) and read as a mess of
 * arbitrary numbers; ids are now a clean character1-24, tier boundaries
 * preserved exactly, plus a new character25. The Gold ladder was repriced in
 * the same pass to close a discontinuity the deletions had left in it
 * (removing four mid-ladder characters without repricing the survivors above
 * them had produced an ~86% jump between two adjacent rungs); it's now one
 * smooth decelerating sequence start to finish. Old gamer-tag-style names on
 * the earlier characters (`amaraa_04`, `ttv_danpark`, `nico_noscope`, ...)
 * were fixed to real names in the same pass, closing out the one convention
 * left over from before the 2026-08-21 reversal above.
 *
 * Full narrative history of how each individual character's art arrived
 * (sheet quirks, facing fixes, slicer changes) has been pruned along with
 * the old ids it was anchored to; recover it from `git log` on this file
 * if needed; what's kept here is the standing rules, not the play-by-play.
 */
const characterAvatarOffers: Record<
  string,
  {
    name: string;
    description: string;
    price: number | null;
    unlock?: Cosmetic["unlock"];
    adminOnly?: boolean;
  }
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
  character26: { name: "Emory Vance", description: "Silver hair, steel nerve. Been folding you since the '80s.", price: 2_780_000 },
  character27: { name: "Reggie Cross", description: "Doesn't blink. Doesn't bluff. Doesn't need to.", price: 3_020_000 },
  character28: { name: "Wren Callahan", description: "Quiet at the felt. Loud on the leaderboard.", price: 3_270_000 },
  character29: { name: "Haruto Kessler", description: "Three decades at the table. Still the one to watch.", price: 3_530_000 },
  character30: { name: "Wren Ashby", description: "Ink on her skin, math in her head. Reads you both.", price: 3_800_000 },
  character31: { name: "Cade Osei", description: "Controller in one hand, your stack in the other.", price: 4_080_000 },
  // Admin-only, not sold or earned -- see Cosmetic.adminOnly's own comment.
  // Excluded from the priced ladder above and from every ladder/unlock test
  // on purpose; see the dedicated "admin-only avatar" tests instead.
  character32: {
    name: "Kayo",
    description: "Built the table.",
    price: null,
    adminOnly: true,
  },
};

/**
 * Chip designs. A player owns a pool of these (same purchase path as card
 * backs and avatars) and assigns any owned design to any of the four
 * denominations `lib/scene/chips/chip-spec.ts` currently draws (1/5/25/100)
 * -- Kayo's own framing: "if someone bets small they could use pink chips to
 * be their BB amount." Unlike the other two slots this isn't one equip per
 * slot; see `EquippedCosmetics.chipDesigns`.
 *
 * Visible to the whole table on that player's own bet and standing-stack
 * chips only -- the shared pot mound has no single owner (`RenderChip` never
 * carries a `profileId` for pooled chips), so it always stays the house
 * palette. That's a real scope limit, not an oversight: see
 * `components/table/scene/racetrack-scene.tsx`'s chip-material resolver.
 *
 * One free tier entry, same reasoning as `back-house`/character4/9: a
 * player should have a real alternative to try with no Gold spent, not just
 * a locked storefront.
 */
const chipDesignCosmetics: Cosmetic[] = [
  {
    id: "chip-cobalt",
    slot: "chipDesign",
    name: "Cobalt",
    description: "Deep blue clay, house-standard finish.",
    rarity: "standard",
    price: 0,
    chip: { body: 0x1f3f6e, spot: 0xe6ddcb, inlay: 0x2a5490, ink: 0xf3ece0 },
  },
  {
    id: "chip-crimson",
    slot: "chipDesign",
    name: "Crimson",
    description: "Bright red clay, sharper than the house oxblood.",
    rarity: "standard",
    price: 20_000,
    chip: { body: 0x6e1f2f, spot: 0xe6ddcb, inlay: 0x8a2a40, ink: 0xf3ece0 },
  },
  {
    id: "chip-sable",
    slot: "chipDesign",
    name: "Sable Stripe",
    description: "Black clay, white edge spots -- reads as a stripe from across the felt.",
    rarity: "standard",
    price: 20_000,
    chip: { body: 0x18181a, spot: 0xf0ede4, inlay: 0x232326, ink: 0xf0ede4 },
  },
  {
    id: "chip-blush",
    slot: "chipDesign",
    name: "Blush",
    description: "Bright pink clay -- easy to spot as your small-blind marker.",
    rarity: "standard",
    price: 20_000,
    chip: { body: 0xa8285f, spot: 0xe6ddcb, inlay: 0xc23a74, ink: 0xf3ece0 },
  },
  {
    id: "chip-violet",
    slot: "chipDesign",
    name: "Violet",
    description: "Deep purple clay, pale inserts.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0x3a1f5e, spot: 0xd9c8e6, inlay: 0x4c2a78, ink: 0xf3ece0 },
  },
  {
    id: "chip-jade",
    slot: "chipDesign",
    name: "Jade",
    description: "Cool green clay, a shade brighter than the house felt.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0x1f5e46, spot: 0xd9e6dc, inlay: 0x2a7860, ink: 0xf3ece0 },
  },
  {
    id: "chip-platinum",
    slot: "chipDesign",
    name: "Platinum",
    description: "Bone-white clay, dark edge spots. Rare enough to notice.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0xb9b4a8, spot: 0x2b2b2e, inlay: 0xcfc9ba, ink: 0x1b1b1d },
  },

  // Gold Reserve -- gold clay, black edge inserts and denomination. Ten
  // shades of one hue rather than ten different colours, the way a real
  // foil-pressed high-roller set stays "gold" across its whole run.
  {
    id: "chip-champagne-reserve",
    slot: "chipDesign",
    name: "Champagne Reserve",
    description: "Pale gold clay, black inserts. The lightest chip in the Reserve run.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0xd9b969, spot: 0x1c1408, inlay: 0xe8cf8f, ink: 0x1c1408 },
  },
  {
    id: "chip-royal-aureate",
    slot: "chipDesign",
    name: "Royal Aureate",
    description: "Deep gold clay, black edge spots -- the Reserve run's centerpiece.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0xc99a2e, spot: 0x181206, inlay: 0xdaad42, ink: 0x181206 },
  },
  {
    id: "chip-laurel-sovereign",
    slot: "chipDesign",
    name: "Laurel Sovereign",
    description: "Antique gold clay with a warmer cast than house-standard.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0xceab4a, spot: 0x1a1509, inlay: 0xdcbd63, ink: 0x1a1509 },
  },
  {
    id: "chip-amber-high-roller",
    slot: "chipDesign",
    name: "Amber High Roller",
    description: "Bright amber-gold clay, black inserts.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0xd39a2e, spot: 0x1c1306, inlay: 0xe3ad42, ink: 0x1c1306 },
  },
  {
    id: "chip-bronze-trifecta",
    slot: "chipDesign",
    name: "Bronze Trifecta",
    description: "Muted bronze-gold clay, the darkest of the Reserve run.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0xb98a3f, spot: 0x1a1409, inlay: 0xc99e52, ink: 0x1a1409 },
  },
  {
    id: "chip-sunset-ledger",
    slot: "chipDesign",
    name: "Sunset Ledger",
    description: "Warm orange-gold clay, black inserts.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0xd6a13c, spot: 0x1c1407, inlay: 0xe4b654, ink: 0x1c1407 },
  },
  {
    id: "chip-honeycomb-deuce",
    slot: "chipDesign",
    name: "Honeycomb Deuce",
    description: "Bright yellow-gold clay, black inserts.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0xd8b84b, spot: 0x1c1508, inlay: 0xe6cb66, ink: 0x1c1508 },
  },
  {
    id: "chip-imperial-club",
    slot: "chipDesign",
    name: "Imperial Club",
    description: "Saturated gold clay, black edge spots and denomination ink.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0xc9a23a, spot: 0x191305, inlay: 0xdab851, ink: 0x191305 },
  },
  {
    id: "chip-vintage-heart",
    slot: "chipDesign",
    name: "Vintage Heart",
    description: "Aged gold clay, a shade darker than Bronze Trifecta.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0xbd9635, spot: 0x171205, inlay: 0xceaa4c, ink: 0x171205 },
  },
  {
    id: "chip-midas-bolt",
    slot: "chipDesign",
    name: "Midas Bolt",
    description: "The brightest gold in the Reserve run, near-white at the highlight.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0xe0be5c, spot: 0x1e1709, inlay: 0xefd47a, ink: 0x1e1709 },
  },

  // Neon Circuit -- near-black clay carrying one bright green accent, the
  // same construction as Sable Stripe's dark-body/light-insert chip, just
  // lit with neon instead of enamel white.
  {
    id: "chip-neon-lime-strike",
    slot: "chipDesign",
    name: "Neon Lime Strike",
    description: "Near-black clay, lime-green inserts and denomination.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0x101a13, spot: 0x5cff6e, inlay: 0x162016, ink: 0x9dffab },
  },
  {
    id: "chip-acid-green-deuce",
    slot: "chipDesign",
    name: "Acid Green Deuce",
    description: "Near-black clay, a sharper acid-green accent than Lime Strike.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0x0f1a10, spot: 0x8dff3d, inlay: 0x152016, ink: 0xc4ff8d },
  },
  {
    id: "chip-electric-jade-club",
    slot: "chipDesign",
    name: "Electric Jade Club",
    description: "Near-black clay, a cooler jade-green accent.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0x0d1a16, spot: 0x2bffa8, inlay: 0x13221c, ink: 0x8dffd4 },
  },
  {
    id: "chip-emerald-volt-heart",
    slot: "chipDesign",
    name: "Emerald Volt Heart",
    description: "Near-black clay, a mid-tone emerald accent.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0x10190f, spot: 0x4dff6f, inlay: 0x162016, ink: 0xa8ffb8 },
  },
  {
    id: "chip-cyber-mint-facet",
    slot: "chipDesign",
    name: "Cyber Mint Facet",
    description: "Near-black clay, a pale mint-green accent.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0x0d1a17, spot: 0x3dffc4, inlay: 0x13221f, ink: 0x9dffe0 },
  },
  {
    id: "chip-toxic-sevens",
    slot: "chipDesign",
    name: "Toxic Sevens",
    description: "Near-black clay, a yellow-shifted toxic-green accent.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0x121a0d, spot: 0x9dff3d, inlay: 0x182212, ink: 0xceff8d },
  },
  {
    id: "chip-radioactive-nova",
    slot: "chipDesign",
    name: "Radioactive Nova",
    description: "Near-black clay, the brightest accent in the Circuit run.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0x0d1a14, spot: 0x2bffb0, inlay: 0x13221a, ink: 0x8dffdc },
  },
  {
    id: "chip-chartreuse-pulse",
    slot: "chipDesign",
    name: "Chartreuse Pulse",
    description: "Near-black clay, a yellow-green chartreuse accent.",
    rarity: "premium",
    price: 150_000,
    chip: { body: 0x151a0d, spot: 0xc2ff3d, inlay: 0x1e2212, ink: 0xe4ff8d },
  },
  {
    id: "chip-viper-crown",
    slot: "chipDesign",
    name: "Viper Crown",
    description: "Near-black clay, a mid-saturation green accent.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0x0f190f, spot: 0x4dff86, inlay: 0x152016, ink: 0xa8ffc4 },
  },
  {
    id: "chip-laser-emerald-ace",
    slot: "chipDesign",
    name: "Laser Emerald Ace",
    description: "Near-black clay, a deep laser-emerald accent -- the coolest in the Circuit run.",
    rarity: "rare",
    price: 350_000,
    chip: { body: 0x0c1a15, spot: 0x1dffb4, inlay: 0x122220, ink: 0x8dffe4 },
  },
];

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
    // An earned OR admin-only character reads as `signature`, not as a
    // `standard` starter. Deriving the tier from `price > 0` alone would put
    // both in the free bucket, since neither carries a Gold price.
    rarity: offer.unlock || offer.adminOnly ? "signature" : offer.price ? "rare" : "standard",
    price: offer.price,
    ...(offer.unlock ? { unlock: offer.unlock } : {}),
    ...(offer.adminOnly ? { adminOnly: true } : {}),
  };
});

/**
 * There used to be a second, entirely separate character roster here for the
 * WebGL 3D room (`character3DCosmetics`, backed by `CHARACTERS_3D` and its
 * own `premiumCharacter3DOffers` acquisition table) with its own equipment
 * slot (`avatar3d`) and Collection tab. It was deleted along with the 3D
 * room itself -- recoverable from the `archive/webgl-3d-table` git tag, not
 * from this file. `characterAvatarCosmetics` above is the entire avatar
 * catalog now, not one half of it.
 */
export const avatarCosmetics: Cosmetic[] = characterAvatarCosmetics;

/** What a brand-new profile has, and falls back to if anything goes missing. */
export const DEFAULT_CARD_BACK = "back-house";
export const DEFAULT_AVATAR_COSMETIC = "character4";

export const cosmetics: Cosmetic[] = [...cardBackCosmetics, ...avatarCosmetics, ...chipDesignCosmetics];

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
 * their history at this table. Admin-only characters are excluded too, for
 * an unrelated reason -- a bot wearing one is not "someone who could look
 * like this," it's a random opponent wearing a specific real person's face.
 */
export const botAvatarCosmetics: Cosmetic[] = characterAvatarCosmetics.filter(
  (item) => !item.unlock && !item.adminOnly,
);

/** Items granted to everyone -- free, so never held in the ownership table. */
export function isFreeCosmetic(item: Cosmetic): boolean {
  return item.price === 0;
}

export function isPurchasable(item: Cosmetic): boolean {
  return typeof item.price === "number" && item.price > 0;
}

/**
 * A player's equipped choices. `avatar2d` kept its name rather than becoming
 * plain `avatar` when its `avatar3d` sibling (the WebGL 3D room's own
 * equipment slot) was deleted -- the id space and the field both stay ready
 * for a second avatar-rendering surface to reuse the "2d"/"3d" split without
 * a rename, the same reasoning `TableRenderer` follows in
 * `lib/scene/table-renderer.ts`.
 */
/**
 * The denominations a chip design can be assigned to. Chip designs are sold
 * generically ("Cobalt", not "Cobalt 5"), so this is the one place that has
 * to agree with `lib/scene/chips/chip-spec.ts`'s `CHIP_MATERIALS` -- kept as
 * a literal rather than importing that table's keys so this module doesn't
 * need to know the house palette, only the shape of the ladder it overrides.
 */
export const CHIP_DESIGN_DENOMINATIONS = [1, 5, 25, 100] as const;
export type ChipDesignDenomination = (typeof CHIP_DESIGN_DENOMINATIONS)[number];

export interface EquippedCosmetics {
  cardBack: string;
  avatar2d: string;
  /**
   * Denomination -> owned chip-design id. Unlike `cardBack`/`avatar2d` this
   * is a pool assignment, not a single equip choice: a denomination with no
   * entry here just draws the house `CHIP_MATERIALS` default, which is also
   * what an unrecognised or since-removed id falls back to (`chipDesignMaterial`
   * below), the same "never let a bad id blank the felt" rule `cardBackArt`
   * follows.
   */
  chipDesigns: Partial<Record<ChipDesignDenomination, string>>;
}

export const defaultEquipped: EquippedCosmetics = {
  cardBack: DEFAULT_CARD_BACK,
  avatar2d: DEFAULT_AVATAR_COSMETIC,
  chipDesigns: {},
};

/**
 * Coerces stored or client-sent equipment into something renderable, and
 * refuses to equip anything that isn't a real item in the right slot.
 */
export function normalizeEquipped(raw: unknown): EquippedCosmetics {
  const input = (raw ?? {}) as Record<string, unknown>;
  const pick = (value: unknown, fallback: string) => {
    const item = typeof value === "string" ? cosmeticById(value) : null;
    return item && item.slot === "avatar" ? item.id : fallback;
  };
  // `avatar` is what this field was called before the now-deleted 3D room
  // needed its own slot and this one picked up its "2d" suffix; a profile
  // stored under the old name still resolves correctly.
  const legacyAvatar = input.avatar;
  const rawChipDesigns = (input.chipDesigns ?? {}) as Record<string, unknown>;
  const chipDesigns: Partial<Record<ChipDesignDenomination, string>> = {};
  for (const denomination of CHIP_DESIGN_DENOMINATIONS) {
    const value = rawChipDesigns[String(denomination)];
    const item = typeof value === "string" ? cosmeticById(value) : null;
    if (item?.slot === "chipDesign") chipDesigns[denomination] = item.id;
  }
  return {
    cardBack: cosmeticById(String(input.cardBack ?? ""))?.slot === "cardBack"
      ? String(input.cardBack)
      : DEFAULT_CARD_BACK,
    avatar2d: pick(input.avatar2d ?? legacyAvatar, DEFAULT_AVATAR_COSMETIC),
    chipDesigns,
  };
}

/**
 * A chip design's material, or null for "no override, draw the house
 * denomination default" -- an unset assignment and an unrecognised/removed
 * id resolve the same way on purpose, so a deleted catalog entry never
 * blanks a chip the way a missing card-back art lookup would blank a card.
 */
export function chipDesignMaterial(id: string | null | undefined): ChipMaterial | null {
  const item = typeof id === "string" ? cosmeticById(id) : null;
  return item?.slot === "chipDesign" && item.chip ? item.chip : null;
}

/**
 * The designs a bot may wear. Whole catalog, no `unlock`/rarity filter --
 * same reasoning `botAvatarCosmetics` gives for letting Gold-priced
 * characters through: a bot showing up in a design a player could go buy
 * today advertises the store, it isn't a claim about the bot's own history.
 * There's no earned tier here to exclude in the first place (no chip design
 * carries `unlock`), so the filter is really just future-proofing against
 * one showing up later.
 */
const botChipDesignCosmetics: Cosmetic[] = chipDesignCosmetics.filter((item) => !item.unlock);

/**
 * One design, worn on all four denominations -- a bot's own chip colour,
 * the same way `botAvatarFor` gives it one face rather than a different
 * character per card. Keyed on identity, not seat position, so a rotated
 * bot brings its colour with it, same as its face and card back.
 */
export function botChipDesignsFor(identity: number): Partial<Record<ChipDesignDenomination, string>> {
  if (botChipDesignCosmetics.length === 0) return {};
  const design = botChipDesignCosmetics[identity % botChipDesignCosmetics.length].id;
  const assigned: Partial<Record<ChipDesignDenomination, string>> = {};
  for (const denomination of CHIP_DESIGN_DENOMINATIONS) assigned[denomination] = design;
  return assigned;
}
