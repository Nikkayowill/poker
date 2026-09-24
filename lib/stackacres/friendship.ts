/**
 * NPC friendship: gifting a processing-track item to someone on the farm
 * earns points toward a permanent ladder of keepsake rewards, Stardew
 * Valley's own gift-giving loop scaled down to StackAcres' own cadence.
 *
 * A SEPARATE MECHANIC FROM ./devotion.ts. The Pixel Pilgrim already has his
 * own UTC-day prayer streak and relic ladder -- this file does not touch
 * him, and `FRIENDSHIP_NPCS` never includes "pilgrim". The two
 * systems look similar (a day gate, a claimed-rung ladder) because they
 * solve the same shape of problem the same way this codebase already
 * trusts, not because one was copied into the other; keep them separate
 * modules so a future retune of one can never silently touch the other.
 *
 * A SECOND, FREE DAY GATE: alongside a gift, a player can also just say hi
 * (`applyGreet`) -- no item, a smaller flat award, and its own
 * `lastGreetedDay` so greeting and gifting never compete for the same
 * counted-once-a-day slot. This is what makes clicking an NPC with nothing
 * else to say ("nothing to give him," or a traveler whose quest is already
 * done) still build the relationship rather than doing nothing.
 *
 * Pierre and Ivy are in `FRIENDSHIP_NPCS` for exactly this reason: they are
 * two of the eleven story travelers (lib/stackacres/story/) who stay on the
 * farm once their own quest line finishes, and until now a tap after that
 * point always showed the same static "nothing new to say" line forever.
 * A greet gives them the same slow-building relationship Ray's gifts
 * already have. Their gift preferences start empty (every gift reads
 * "neutral") rather than invented from nothing -- a later pass can give
 * them real preferences once they have items associated with their
 * personalities.
 *
 * Gifts are drawn from ./inventory.ts's processing-track items (wheat,
 * flour, milk, wool, cheese, cloth) -- NOT ./items.ts's Gold-track produce,
 * which is valued and paid the instant it is harvested and has nothing left
 * to hand an NPC. A gift is consumed the moment it counts (see the server's
 * `giveStackAcresGift`, which debits the item and advances a friendship row
 * in one transaction) -- there is no "try it and see" here the way donating
 * a secret item (`donate-secret-item`, lib/stackacres/secrets.ts) gets,
 * because unlike showing off a find, a gift is not information the player
 * already has.
 *
 * ONE COUNTED GIFT PER NPC PER UTC DAY, same boundary as devotion.ts's
 * (`./exchange.ts`'s `stackacresExchangeDay`) -- not to gate the item spend
 * (a player may give as many times as they like) but so the SERVER never
 * consumes an item for a gift that would have scored nothing: an
 * already-gifted-today attempt is refused before anything is touched, see
 * the server's own header for why that ordering matters.
 *
 * Pure and closed-form, same posture as every other rules module here:
 * `applyGift` takes `today` as a parameter rather than reading a clock, so
 * the server's one real call site controls where time enters and a lost
 * race can safely re-derive the same answer from the same stored row.
 */

import type { MachineItemId } from "./machine-items";

export const FRIENDSHIP_NPCS = ["ray", "pierre", "ivy"] as const;

export type NpcId = (typeof FRIENDSHIP_NPCS)[number];

export function isNpcId(value: string): value is NpcId {
  return (FRIENDSHIP_NPCS as readonly string[]).includes(value);
}

export type GiftPreference = "loved" | "liked" | "neutral";

/** Points one gift is worth, by how much the NPC likes it. No "disliked"
 *  tier and no penalty for a wrong guess, on purpose -- same generosity
 *  ./devotion.ts's "declining costs nothing" already commits this feature
 *  set to: the worst a gift can do is score less than it might have. */
const POINTS_BY_PREFERENCE: Readonly<Record<GiftPreference, number>> = {
  loved: 3,
  liked: 2,
  neutral: 1,
};

export interface NpcGiftDef {
  label: string;
  /** A missing item defaults to "neutral" -- see `giftPreference`. */
  preferences: Partial<Record<MachineItemId, GiftPreference>>;
}

export const NPC_GIFT_CATALOGUE: Readonly<Record<NpcId, NpcGiftDef>> = {
  ray: {
    label: "Ray",
    // He is the one who taught the farm to turn raw stock into something
    // finer (the Mill, the Dairy, the Loom); it is the finished goods he
    // lights up for, not the raw milk and wool he already sees every day.
    // The Harvest Feast is the one he loves most of all: it is the meal his
    // own kitchen was built for.
    preferences: {
      cheese: "loved",
      cloth: "loved",
      harvest_feast: "loved",
      flour: "liked",
      bean_casserole: "liked",
      stuffed_peppers: "liked",
    },
  },
  pierre: {
    label: "Chef Pierre",
    // A finished dish is his own craft coming back to him; raw stock he
    // already has plenty of in the four-colour kitchen he came from.
    preferences: {
      cake: "loved",
      harvest_feast: "loved",
      stuffed_peppers: "liked",
      bean_casserole: "liked",
      cheese: "liked",
    },
  },
  ivy: {
    label: "Botanist Ivy",
    // What a seed becomes once it is grown and processed all the way
    // through -- the same "past the lookup table, into real ground" arc
    // her own origin line gives her.
    preferences: {
      flour: "loved",
      wheat: "loved",
      cloth: "liked",
      harvest_feast: "liked",
    },
  },
};

/** What can be handed to an NPC: the processing track, not raw harvest. Eggs
 *  and crops sit in the same inventory now, but they were never gifts, and
 *  the route's own schema and the dialogue's picker both read this list so
 *  the two can't drift apart. */
export const GIFTABLE_ITEMS: readonly MachineItemId[] = [
  "wheat",
  "milk",
  "wool",
  "flour",
  "cheese",
  "cloth",
  "cake",
  "stuffed_peppers",
  "bean_casserole",
  "harvest_feast",
];

export function isGiftableItem(item: MachineItemId): boolean {
  return GIFTABLE_ITEMS.includes(item);
}

export function giftPreference(npc: NpcId, item: MachineItemId): GiftPreference {
  return NPC_GIFT_CATALOGUE[npc].preferences[item] ?? "neutral";
}

export function giftPoints(npc: NpcId, item: MachineItemId): number {
  return POINTS_BY_PREFERENCE[giftPreference(npc, item)];
}

/**
 * Every NPC's keepsakes: what their own friendship ladder grants, the same
 * posture ./devotion.ts's RELIC_ITEMS already sets and for the identical
 * reason -- NEVER Gold-valued, never sold, never tradeable, never swept by a
 * harvest. `stackacres-service.ts` enforces a hard, test-pinned rule that
 * Gold is credited from exactly four call sites (a refund helper, Sell, a
 * fulfilled Town Contract and the Fermenting Vat -- see "the currency wall"
 * in that file's own test suite), and a friendship reward is not a fifth: it
 * is a memento, the same category a relic already is.
 *
 * One flat KEEPSAKE_ITEMS id space across all three NPCs (never reused
 * between them, so a KeepsakeId alone always says who gave it) rather than a
 * per-NPC item type -- the same "one id space, ids never collide" choice
 * RELIC_ITEMS already makes for the Pilgrim.
 */
export const KEEPSAKE_ITEMS = [
  "carved_whistle",
  "pocket_ledger",
  "grandfathers_pocketwatch",
  "family_photograph",
  "chipped_ladle",
  "laminated_recipe_card",
  "scorched_apron_pin",
  "signature_dish_plate",
  "pressed_seed_packet",
  "grafted_cutting",
  "hand_drawn_seed_chart",
  "hyperdense_bloom",
] as const;

export type KeepsakeId = (typeof KEEPSAKE_ITEMS)[number];

export interface KeepsakeDef {
  label: string;
  /** The "???" caption shown before it's ever been earned -- same
   *  treatment RELIC_CATALOGUE gives an unclaimed relic. */
  blurb: string;
  /** A plain emoji, same reasoning RelicDef.icon gives: never drawn on the
   *  map, only in a dialogue's own small chrome. */
  icon: string;
}

export const KEEPSAKE_CATALOGUE: Readonly<Record<KeepsakeId, KeepsakeDef>> = {
  carved_whistle: {
    label: "Carved Whistle",
    blurb: "Whittled from a fence post, he says, the first season he ever worked this ground.",
    icon: "🪈",
  },
  pocket_ledger: {
    label: "Pocket Ledger",
    blurb: "Every harvest this farm ever brought him, in a hand steadier than his own has been in years.",
    icon: "📔",
  },
  grandfathers_pocketwatch: {
    label: "Grandfather's Pocketwatch",
    blurb: "Stopped decades ago, at an hour he has never once explained.",
    icon: "⏱️",
  },
  family_photograph: {
    label: "Family Photograph",
    blurb: "Faces he never names, on land that looks a great deal like this one.",
    icon: "🖼️",
  },
  chipped_ladle: {
    label: "Chipped Ladle",
    blurb: "The first tool he ever rendered for himself, four colours and a little worse for wear.",
    icon: "🥄",
  },
  laminated_recipe_card: {
    label: "Laminated Recipe Card",
    blurb: "A dish from the four-colour kitchen, written out in a hand that never once shook.",
    icon: "📇",
  },
  scorched_apron_pin: {
    label: "Scorched Apron Pin",
    blurb: "Singed at the edge. He says the story behind that is a better dish than the burn was.",
    icon: "📌",
  },
  signature_dish_plate: {
    label: "Signature Dish Plate",
    blurb: "The one recipe he never wrote down, plated exactly the way he always imagined it here.",
    icon: "🍽️",
  },
  pressed_seed_packet: {
    label: "Pressed Seed Packet",
    blurb: "One of the tidy squares from her old greenhouse sim, kept flat between two pieces of glass.",
    icon: "🌱",
  },
  grafted_cutting: {
    label: "Grafted Cutting",
    blurb: "A cross she ran the lookup table on a dozen times before she trusted it to actual soil.",
    icon: "🌿",
  },
  hand_drawn_seed_chart: {
    label: "Hand-Drawn Seed Chart",
    blurb: "Every cross she has ever tried on this farm, charted by hand instead of by table.",
    icon: "🗺️",
  },
  hyperdense_bloom: {
    label: "Hyperdense Bloom",
    blurb: "A flower packed too many pixels tight to exist anywhere but here. She grew it for you.",
    icon: "🌸",
  },
};

/** One rung on the ladder: the point total it takes, the keepsake it grants
 *  the first time a gift or greet reaches it, and the title the dialogue
 *  shows from then on. Short by design, same reasoning DEVOTION_LADDER
 *  gives -- a handful of real moments, not a grind. Every `points` value in
 *  one NPC's ladder is unique and ascending; friendship.test.ts holds both. */
export interface FriendshipRung {
  points: number;
  keepsake: KeepsakeId;
  title: string;
}

/** One ladder per NPC -- same point thresholds for all three (so one shared
 *  `FRIENDSHIP_RUNG_THRESHOLDS` still works for every RPC call regardless of
 *  npc), but each NPC's own keepsakes and titles, since a keepsake earned
 *  from Pierre reading "Ray gives you his Carved Whistle" would be a bug,
 *  not a reuse. At one loved gift (3 points) per UTC day, the ladder takes
 *  3/8/15/25 days -- a slightly longer arc than DEVOTION_LADDER's, since a
 *  gift also costs a real processing-track item and the Pilgrim's streak
 *  costs nothing but showing up. A greet alone (1 point/day) takes
 *  9/24/45/75 days, the plain-friendship pace for someone never gifted at all. */
export const FRIENDSHIP_LADDER: Readonly<Record<NpcId, readonly FriendshipRung[]>> = {
  ray: [
    { points: 9, keepsake: "carved_whistle", title: "Friendly Face" },
    { points: 24, keepsake: "pocket_ledger", title: "Trusted Hand" },
    { points: 45, keepsake: "grandfathers_pocketwatch", title: "Old Friend" },
    { points: 75, keepsake: "family_photograph", title: "Family" },
  ],
  pierre: [
    { points: 9, keepsake: "chipped_ladle", title: "Kitchen Regular" },
    { points: 24, keepsake: "laminated_recipe_card", title: "Trusted Taster" },
    { points: 45, keepsake: "scorched_apron_pin", title: "Sous Chef" },
    { points: 75, keepsake: "signature_dish_plate", title: "Family Recipe" },
  ],
  ivy: [
    { points: 9, keepsake: "pressed_seed_packet", title: "Greenhouse Regular" },
    { points: 24, keepsake: "grafted_cutting", title: "Trusted Hand" },
    { points: 45, keepsake: "hand_drawn_seed_chart", title: "Fellow Botanist" },
    { points: 75, keepsake: "hyperdense_bloom", title: "Kindred Sprout" },
  ],
};

/** Just the thresholds, in ladder order -- identical across every NPC (see
 *  FRIENDSHIP_LADDER's own header), so this is what the server hands its
 *  RPC regardless of which npc the call is for (the same pattern
 *  DEVOTION_RUNG_THRESHOLDS already sets for the Pilgrim's shrine). */
export const FRIENDSHIP_RUNG_THRESHOLDS: readonly number[] = FRIENDSHIP_LADDER.ray.map((rung) => rung.points);

/** One player's standing with one NPC, as stored. `claimedRungs` holds
 *  indices into that NPC's own FRIENDSHIP_LADDER entry, never titles
 *  directly -- same convention devotion.ts's `claimedRungs` uses, so a
 *  rung's title/reward can change later without disturbing what was
 *  already claimed. */
export interface StoredFriendship {
  points: number;
  /** `YYYY-MM-DD` in UTC, or null before a first gift. */
  lastGiftedDay: string | null;
  /** `YYYY-MM-DD` in UTC, or null before a first plain greet. A separate
   *  gate from `lastGiftedDay` -- see this file's own header for why
   *  greeting and gifting can never share one gate. */
  lastGreetedDay: string | null;
  claimedRungs: readonly number[];
}

export function freshFriendship(): StoredFriendship {
  return { points: 0, lastGiftedDay: null, lastGreetedDay: null, claimedRungs: [] };
}

/** A plain "say hi" awards, per NPC per UTC day -- flat, and never above a
 *  "neutral" gift's own 1 point (it can tie one, on an item the NPC has no
 *  preference for at all, but never beat a liked or loved gift). A greet
 *  costs nothing, so every NPC in FRIENDSHIP_NPCS needs at least one liked
 *  or loved item in NPC_GIFT_CATALOGUE or gifting them would never be worth
 *  more than showing up for free -- friendship.test.ts holds that rule. */
export const GREET_POINTS = 1;

/** The first ladder rung whose threshold `points` has now reached that is
 *  not already in `claimedRungs` -- at most one, since a single gift or
 *  greet only ever adds a few points and the ladder's own gaps are wider
 *  than the richest gift is worth. */
function nextUnclaimedRung(npc: NpcId, points: number, claimedRungs: readonly number[]): number | null {
  const ladder = FRIENDSHIP_LADDER[npc];
  for (let i = 0; i < ladder.length; i++) {
    if (points >= ladder[i].points && !claimedRungs.includes(i)) return i;
  }
  return null;
}

export type GiftOutcome = "gifted" | "already-gifted-today";

export interface GiftResult {
  next: StoredFriendship;
  outcome: GiftOutcome;
  pointsAwarded: number;
  grantedRung: number | null;
}

/**
 * What giving `item` to `npc` right now does to a stored friendship record.
 * Pure: the caller (the server's RPC, mirrored by its own memory-mode
 * branch) is the only place that actually persists `next` or debits the
 * item. Refuses (outcome "already-gifted-today") without awarding points
 * when a counted gift already landed today -- the server reads this BEFORE
 * touching inventory, so a refused gift never costs the player the item.
 */
export function applyGift(stored: StoredFriendship, npc: NpcId, item: MachineItemId, today: string): GiftResult {
  if (stored.lastGiftedDay === today) {
    return { next: stored, outcome: "already-gifted-today", pointsAwarded: 0, grantedRung: null };
  }
  const pointsAwarded = giftPoints(npc, item);
  const points = stored.points + pointsAwarded;
  const grantedRung = nextUnclaimedRung(npc, points, stored.claimedRungs);
  const claimedRungs = grantedRung === null ? stored.claimedRungs : [...stored.claimedRungs, grantedRung];
  return {
    next: { ...stored, points, lastGiftedDay: today, claimedRungs },
    outcome: "gifted",
    pointsAwarded,
    grantedRung,
  };
}

export type GreetOutcome = "greeted" | "already-greeted-today";

export interface GreetResult {
  next: StoredFriendship;
  outcome: GreetOutcome;
  pointsAwarded: number;
  grantedRung: number | null;
}

/**
 * What saying hi to `npc` right now does to a stored friendship record. Same
 * shape as `applyGift` but its own day gate (`lastGreetedDay`) and no item
 * -- see this file's own header for why the two never share a gate. Pure,
 * same posture as `applyGift`.
 */
export function applyGreet(stored: StoredFriendship, npc: NpcId, today: string): GreetResult {
  if (stored.lastGreetedDay === today) {
    return { next: stored, outcome: "already-greeted-today", pointsAwarded: 0, grantedRung: null };
  }
  const pointsAwarded = GREET_POINTS;
  const points = stored.points + pointsAwarded;
  const grantedRung = nextUnclaimedRung(npc, points, stored.claimedRungs);
  const claimedRungs = grantedRung === null ? stored.claimedRungs : [...stored.claimedRungs, grantedRung];
  return {
    next: { ...stored, points, lastGreetedDay: today, claimedRungs },
    outcome: "greeted",
    pointsAwarded,
    grantedRung,
  };
}

/** The read-only projection the client renders. Points never lapse or
 *  decay -- unlike devotion's streak, a missed day costs nothing at all,
 *  the same "no punishment" posture this file's own header commits to. */
export interface StackAcresFriendshipView {
  points: number;
  giftedToday: boolean;
  greetedToday: boolean;
  /** The highest claimed rung's title, or null before the first one. */
  title: string | null;
  nextRungPoints: number | null;
  nextRungTitle: string | null;
  keepsakesHeld: readonly KeepsakeId[];
}

/** `now` rather than a pre-computed day string -- same ergonomics
 *  ./devotion.ts's own `devotionView` gives, and the same UTC-day
 *  derivation `now.toISOString().slice(0, 10)` (identical to
 *  ./exchange.ts's `stackacresExchangeDay`, restated rather than imported
 *  for the same "this file reads no clock but the one it is handed"
 *  reason `devotionView` already gives). */
export function friendshipView(npc: NpcId, stored: StoredFriendship, now: Date): StackAcresFriendshipView {
  const ladder = FRIENDSHIP_LADDER[npc];
  const today = now.toISOString().slice(0, 10);
  const nextRungIndex = ladder.findIndex((_, i) => !stored.claimedRungs.includes(i));
  const nextRung = nextRungIndex === -1 ? null : ladder[nextRungIndex];
  const lastClaimed = stored.claimedRungs.length > 0 ? ladder[Math.max(...stored.claimedRungs)] : null;
  return {
    points: stored.points,
    giftedToday: stored.lastGiftedDay === today,
    greetedToday: stored.lastGreetedDay === today,
    title: lastClaimed?.title ?? null,
    nextRungPoints: nextRung?.points ?? null,
    nextRungTitle: nextRung?.title ?? null,
    keepsakesHeld: stored.claimedRungs.map((i) => ladder[i].keepsake),
  };
}
