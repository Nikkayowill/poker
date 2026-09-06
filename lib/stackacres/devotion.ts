/**
 * The Pixel Pilgrim's devotion ladder: what a UTC-day prayer streak earns.
 *
 * A player who says "yes" to his dialogue (stackacres-monk-dialogue.tsx) at
 * least once in a UTC day advances a streak by one; skipping a day drops it
 * back to one on the next prayer, not zero -- praying again always restarts
 * the count rather than leaving a player stuck reading a stale number. The
 * day boundary is the app's one existing UTC midnight
 * (./exchange.ts's `stackacresExchangeDay`, already shared by the daily Gold
 * ceiling, Land Maintenance and the daily puzzle gate) -- there is no second
 * clock to learn here.
 *
 * RELIC_ITEMS is A DELIBERATELY SEPARATE ITEM SPACE, same posture as
 * ./crossbreed-items.ts's own header: never Gold-valued, never sold by Ray,
 * never tradeable, never swept by a harvest. A claimed ladder rung IS
 * permanent ownership of its relic -- there is no separate ledger to keep in
 * sync, unlike ./museum-secrets.ts's donation flags, because a relic is
 * never given back or consumed.
 *
 * Pure and closed-form, same posture as every other rules module here:
 * nothing reads a clock or a database directly. `applyPrayer`/`devotionView`
 * both take `today`/`now` as parameters so the server's one real call site
 * (lib/server/stackacres-service.ts's `prayAtStackAcresShrine`) controls the
 * only place time actually enters, and so a lost race there can safely
 * re-derive the same answer from the same stored row.
 */

export const RELIC_ITEMS = ["pilgrims_bead", "vellum_psalm", "reliquary_shard", "pixel_halo"] as const;

export type RelicId = (typeof RELIC_ITEMS)[number];

export function isRelicId(value: string): value is RelicId {
  return (RELIC_ITEMS as readonly string[]).includes(value);
}

export interface RelicDef {
  label: string;
  /** The "???" caption shown before it's ever been earned -- same treatment
   *  ./museum-secrets.ts gives an undiscovered artifact. */
  blurb: string;
  /** A plain emoji, not a stackacres-art.ts painter name -- same posture
   *  lib/stackacres/secrets.ts's own SecretItemDef takes for the identical
   *  reason: a relic is never drawn on the map, only in a toast or a
   *  dialogue's own small chrome, so it needs no vector painter. */
  icon: string;
}

export const RELIC_CATALOGUE: Readonly<Record<RelicId, RelicDef>> = {
  pilgrims_bead: {
    label: "Pilgrim's Bead",
    blurb: "Worn smooth by a devotion older than this farm. Not for sale, anywhere.",
    icon: "📿",
  },
  vellum_psalm: {
    label: "Vellum Psalm",
    blurb: "A page from a book that was never printed, in a language that reads like home to him.",
    icon: "📜",
  },
  reliquary_shard: {
    label: "Reliquary Shard",
    blurb: "A fragment of something he carried out of the pixel world and will not explain.",
    icon: "🔹",
  },
  pixel_halo: {
    label: "Pixel Halo",
    blurb: "The devotion of thirty unbroken days, worn like a crown. Ray has never seen its like.",
    icon: "😇",
  },
} as const;

/** One rung on the ladder: the unbroken-streak length it takes, and the
 *  relic it grants the first time a prayer reaches it. Index in this array
 *  IS the rung number the server and the stored row both key claims by. */
export interface DevotionRung {
  streak: number;
  relic: RelicId;
}

/** Short by design -- a handful of real moments, not a grind. Every streak
 *  length here is unique and ascending; devotion.test.ts holds both. */
export const DEVOTION_LADDER: readonly DevotionRung[] = [
  { streak: 3, relic: "pilgrims_bead" },
  { streak: 7, relic: "vellum_psalm" },
  { streak: 14, relic: "reliquary_shard" },
  { streak: 30, relic: "pixel_halo" },
];

/** Just the thresholds, in ladder order -- what the server hands its own RPC
 *  (a value the RPC could not otherwise know, the same way a secret zone's
 *  roll is handed its odds rather than knowing them itself). */
export const DEVOTION_RUNG_THRESHOLDS: readonly number[] = DEVOTION_LADDER.map((rung) => rung.streak);

/** The whole of a player's devotion, as stored. `claimedRungs` holds indices
 *  into DEVOTION_LADDER, never relic ids directly -- a rung's relic can be
 *  looked up, but a claim is keyed by position so the ladder can be read
 *  back exactly as it was claimed even if a relic's own text changes later. */
export interface StoredDevotion {
  streak: number;
  /** `YYYY-MM-DD` in UTC, or null before a first prayer. */
  lastPrayedDay: string | null;
  claimedRungs: readonly number[];
}

export function freshDevotion(): StoredDevotion {
  return { streak: 0, lastPrayedDay: null, claimedRungs: [] };
}

/** The UTC calendar day immediately before `day` ("YYYY-MM-DD" in, same out),
 *  correct across a month or year boundary -- `Date.UTC` normalises an
 *  out-of-range day-of-month itself, so there is no special case to write. */
export function previousUtcDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

/** The first ladder rung whose threshold `streak` has now reached that is
 *  not already in `claimedRungs` -- at most one, since a single prayer only
 *  ever advances the streak by exactly one day. */
function nextUnclaimedRung(streak: number, claimedRungs: readonly number[]): number | null {
  for (let i = 0; i < DEVOTION_LADDER.length; i++) {
    if (streak >= DEVOTION_LADDER[i].streak && !claimedRungs.includes(i)) return i;
  }
  return null;
}

export interface PrayerResult {
  next: StoredDevotion;
  /** True if this UTC day already had a prayer recorded -- the streak did
   *  not move and nothing new was claimed. */
  alreadyPrayedToday: boolean;
  /** The ladder rung newly claimed by this prayer, or null. Index into
   *  DEVOTION_LADDER, same convention as `claimedRungs`. */
  grantedRung: number | null;
}

/**
 * What praying right now does to a stored devotion record. Pure: the caller
 * (the server's RPC, mirrored by its own memory-mode branch) is the only
 * place that actually persists `next`.
 */
export function applyPrayer(stored: StoredDevotion, today: string): PrayerResult {
  if (stored.lastPrayedDay === today) {
    return { next: stored, alreadyPrayedToday: true, grantedRung: null };
  }
  const streak = stored.lastPrayedDay === previousUtcDay(today) ? stored.streak + 1 : 1;
  const grantedRung = nextUnclaimedRung(streak, stored.claimedRungs);
  const claimedRungs = grantedRung === null ? stored.claimedRungs : [...stored.claimedRungs, grantedRung];
  return {
    next: { streak, lastPrayedDay: today, claimedRungs },
    alreadyPrayedToday: false,
    grantedRung,
  };
}

/** The read-only projection the client renders. A streak whose last prayer
 *  is neither today nor yesterday has lapsed -- reported as 0 here WITHOUT
 *  writing anything back; the actual reset only happens the next time
 *  `applyPrayer` runs, from whatever the stored row still says. */
export interface StackAcresDevotionView {
  streak: number;
  prayedToday: boolean;
  nextRungStreak: number | null;
  nextRelic: RelicId | null;
  relicsHeld: readonly RelicId[];
}

export function devotionView(stored: StoredDevotion, now: Date): StackAcresDevotionView {
  const today = now.toISOString().slice(0, 10);
  const prayedToday = stored.lastPrayedDay === today;
  const lapsed = stored.lastPrayedDay !== null && stored.lastPrayedDay !== today && stored.lastPrayedDay !== previousUtcDay(today);
  const streak = lapsed ? 0 : stored.streak;
  const nextRungIndex = DEVOTION_LADDER.findIndex((_, i) => !stored.claimedRungs.includes(i));
  const nextRung = nextRungIndex === -1 ? null : DEVOTION_LADDER[nextRungIndex];
  return {
    streak,
    prayedToday,
    nextRungStreak: nextRung?.streak ?? null,
    nextRelic: nextRung?.relic ?? null,
    relicsHeld: stored.claimedRungs.map((i) => DEVOTION_LADDER[i].relic),
  };
}
