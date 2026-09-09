/**
 * NPC friendship: gifting a processing-track item to someone on the farm
 * earns points toward a permanent ladder of keepsake rewards, Stardew
 * Valley's own gift-giving loop scaled down to StackAcres' own cadence.
 *
 * A SEPARATE MECHANIC FROM ./devotion.ts. The Pixel Pilgrim already has his
 * own UTC-day prayer streak and relic ladder -- this file does not touch
 * him, and `FRIENDSHIP_NPCS` holds only Grandfather Ray for now. The two
 * systems look similar (a day gate, a claimed-rung ladder) because they
 * solve the same shape of problem the same way this codebase already
 * trusts, not because one was copied into the other; keep them separate
 * modules so a future retune of one can never silently touch the other.
 *
 * Gifts are drawn from ./inventory.ts's processing-track items (wheat,
 * flour, milk, wool, cheese, cloth) -- NOT ./items.ts's Gold-track produce,
 * which is valued and paid the instant it is harvested and has nothing left
 * to hand an NPC. A gift is consumed the moment it counts (see the server's
 * `giveStackAcresGift`, which debits the item and advances a friendship row
 * in one transaction) -- there is no "try it and see" here the way a
 * `donate-secret-item` museum drop gets, because unlike a museum shelf a
 * gift is not information the player already has.
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

export const FRIENDSHIP_NPCS = ["ray"] as const;

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
    label: "Grandfather Ray",
    // He is the one who taught the farm to turn raw stock into something
    // finer (the Mill, the Dairy, the Loom); it is the finished goods he
    // lights up for, not the raw milk and wool he already sees every day.
    preferences: { cheese: "loved", cloth: "loved", flour: "liked" },
  },
};

export function giftPreference(npc: NpcId, item: MachineItemId): GiftPreference {
  return NPC_GIFT_CATALOGUE[npc].preferences[item] ?? "neutral";
}

export function giftPoints(npc: NpcId, item: MachineItemId): number {
  return POINTS_BY_PREFERENCE[giftPreference(npc, item)];
}

/**
 * Ray's keepsakes: what his friendship ladder grants, the same posture
 * ./devotion.ts's RELIC_ITEMS already sets and for the identical reason --
 * NEVER Gold-valued, never sold by Ray, never tradeable, never swept by a
 * harvest. `stackacres-service.ts` enforces a hard, test-pinned rule that
 * Gold leaves StackAcres from exactly three places (a refund helper and the
 * harvest/contract payouts -- see "the currency wall" in that file's own
 * test suite), and a friendship reward is not a fourth: it is a memento, the
 * same category a relic already is.
 */
export const KEEPSAKE_ITEMS = ["carved_whistle", "pocket_ledger", "grandfathers_pocketwatch", "family_photograph"] as const;

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
};

/** One rung on the ladder: the point total it takes, the keepsake it grants
 *  the first time a gift reaches it, and the title the dialogue shows from
 *  then on. Short by design, same reasoning DEVOTION_LADDER gives -- a
 *  handful of real moments, not a grind. Every `points` value here is
 *  unique and ascending; friendship.test.ts holds both. */
export interface FriendshipRung {
  points: number;
  keepsake: KeepsakeId;
  title: string;
}

/** At one loved gift (3 points) per UTC day, the ladder takes 3/8/15/25 days
 *  -- a slightly longer arc than DEVOTION_LADDER's, since a gift also costs
 *  a real processing-track item and the Pilgrim's streak costs nothing but
 *  showing up. */
export const FRIENDSHIP_LADDER: readonly FriendshipRung[] = [
  { points: 9, keepsake: "carved_whistle", title: "Friendly Face" },
  { points: 24, keepsake: "pocket_ledger", title: "Trusted Hand" },
  { points: 45, keepsake: "grandfathers_pocketwatch", title: "Old Friend" },
  { points: 75, keepsake: "family_photograph", title: "Family" },
];

/** Just the thresholds, in ladder order -- what the server hands its own
 *  RPC (the same pattern DEVOTION_RUNG_THRESHOLDS already sets for the
 *  Pilgrim's shrine). */
export const FRIENDSHIP_RUNG_THRESHOLDS: readonly number[] = FRIENDSHIP_LADDER.map(
  (rung) => rung.points,
);

/** One player's standing with one NPC, as stored. `claimedRungs` holds
 *  indices into FRIENDSHIP_LADDER, never titles directly -- same convention
 *  devotion.ts's `claimedRungs` uses, so a rung's title/reward can change
 *  later without disturbing what was already claimed. */
export interface StoredFriendship {
  points: number;
  /** `YYYY-MM-DD` in UTC, or null before a first gift. */
  lastGiftedDay: string | null;
  claimedRungs: readonly number[];
}

export function freshFriendship(): StoredFriendship {
  return { points: 0, lastGiftedDay: null, claimedRungs: [] };
}

/** The first ladder rung whose threshold `points` has now reached that is
 *  not already in `claimedRungs` -- at most one, since a single gift only
 *  ever adds a few points and the ladder's own gaps are wider than the
 *  richest gift is worth. */
function nextUnclaimedRung(points: number, claimedRungs: readonly number[]): number | null {
  for (let i = 0; i < FRIENDSHIP_LADDER.length; i++) {
    if (points >= FRIENDSHIP_LADDER[i].points && !claimedRungs.includes(i)) return i;
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
  const grantedRung = nextUnclaimedRung(points, stored.claimedRungs);
  const claimedRungs = grantedRung === null ? stored.claimedRungs : [...stored.claimedRungs, grantedRung];
  return {
    next: { points, lastGiftedDay: today, claimedRungs },
    outcome: "gifted",
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
export function friendshipView(stored: StoredFriendship, now: Date): StackAcresFriendshipView {
  const today = now.toISOString().slice(0, 10);
  const nextRungIndex = FRIENDSHIP_LADDER.findIndex((_, i) => !stored.claimedRungs.includes(i));
  const nextRung = nextRungIndex === -1 ? null : FRIENDSHIP_LADDER[nextRungIndex];
  const lastClaimed =
    stored.claimedRungs.length > 0 ? FRIENDSHIP_LADDER[Math.max(...stored.claimedRungs)] : null;
  return {
    points: stored.points,
    giftedToday: stored.lastGiftedDay === today,
    title: lastClaimed?.title ?? null,
    nextRungPoints: nextRung?.points ?? null,
    nextRungTitle: nextRung?.title ?? null,
    keepsakesHeld: stored.claimedRungs.map((i) => FRIENDSHIP_LADDER[i].keepsake),
  };
}
