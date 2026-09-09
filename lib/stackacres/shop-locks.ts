/**
 * Ray's shop, gated on what the farm has actually done.
 *
 * The supply store used to have exactly one gate on it: price. That is a
 * gate on the PURSE, not on the farm, and a purse in StackAcres is shared
 * with the rest of the app -- a player who has never collected a Sprout Row
 * can walk in off a poker win and buy the Golden Spade. This module is the
 * second gate: a shelf row can also name a thing the farm has to have done
 * before Ray will sell it.
 *
 * WHAT COUNTS AS "DONE" IS DERIVED, NEVER STORED. Every flag below is read
 * off state the farm already keeps for its own reasons -- cleared land, Town
 * Influence, the Greenhouse -- exactly the posture `unlockedSectors` takes in
 * ./sectors.ts, and for the same two reasons: there is no migration to get
 * right, and a live farm that has plainly already done the thing is never
 * asked to do it again. There is no `quest_flags` table and adding one would
 * be a step backwards.
 *
 * PERMANENCE IS THE SELECTION RULE for what may be a flag. A lock that can
 * re-lock is worse than no lock: a player who saw a row unlocked and comes
 * back to find it shut has been taken something from. So a flag may only be
 * built on a fact that cannot go away -- land is cleared once and stays
 * cleared, Influence is cumulative and never spent down, the Greenhouse is
 * built once. Anything that can be sold, retired or consumed (units held,
 * feed in the barn, Gold) is deliberately not a flag, however tempting.
 *
 * The one soft edge is inherited rather than introduced: `sectors` is the
 * DERIVED list, so a legacy farm that never explicitly cleared Ox Fields and
 * reads as unlocked only because it keeps cattle there would regress if it
 * retired the last one. That is `unlockedSectors`'s own quirk, it predates
 * this file, and reading the same list the rest of the screen reads is worth
 * more than a second, subtly different idea of which land is yours.
 *
 * EVERYTHING HERE IS PURE. The server decides (see `buyStackAcresFeed` and
 * `upgradeStackAcresTool` in lib/server/stackacres-service.ts, both of which
 * evaluate a lock BEFORE any Gold moves); the client renders the same
 * functions, so a greyed-out row and the refusal behind it can never word the
 * requirement differently. Same split ./sectors.ts already states.
 */

import type { SectorId } from "./sectors";

/* ------------------------------------------------------------------ */
/* The flags                                                           */
/* ------------------------------------------------------------------ */

/**
 * The named milestones a shelf row may ask for, in the order the ladder
 * below counts them.
 *
 * Deliberately short. Every entry is a thing a player would describe as
 * having happened ("I cleared the Fold"), not a statistic that happens to be
 * above a threshold -- a hint string has one line to say what to go and do,
 * and "reach 40,000 lifetime Gold" is not something anybody can go and do.
 */
export const STACKACRES_QUEST_FLAGS = [
  "crop_fields_unlocked",
  "town_trusted",
  "cleared_wallow",
  "greenhouse_raised",
  "cleared_oxfields",
] as const;

export type StackAcresQuestFlag = (typeof STACKACRES_QUEST_FLAGS)[number];

export function isStackAcresQuestFlag(value: unknown): value is StackAcresQuestFlag {
  return typeof value === "string" && (STACKACRES_QUEST_FLAGS as readonly string[]).includes(value);
}

/**
 * What a locked row says is missing.
 *
 * Imperative, second person, no trailing full stop -- these are dropped
 * straight into "Requires: <label>", so they have to read as an instruction
 * rather than as a description of a state. The district names are written
 * out rather than pulled from `sectorLabel` on purpose: this module stays a
 * leaf with no runtime imports, and the three names are already fixed by
 * ./zones.ts's own labels (there is a test holding these two in step).
 *
 * `crop_fields_unlocked` was `cleared_meadow` before the 2026-09-08 map
 * restructure merged that district into the Farmstead -- see
 * ./crop-fields.ts's own header. Renamed along with the flag itself: "clear
 * the Grand Farm" stopped being an accurate instruction the day the Grand
 * Farm stopped being a place you clear.
 */
export const STACKACRES_QUEST_LABELS: Readonly<Record<StackAcresQuestFlag, string>> = {
  crop_fields_unlocked: "Unlock the Crop Fields",
  town_trusted: "Fill an order for the town",
  cleared_wallow: "Clear the Fold",
  greenhouse_raised: "Raise the Greenhouse",
  cleared_oxfields: "Clear the Cattle Pasture",
};

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the gate is allowed to look at.
 *
 * A struct rather than the whole `StackAcresView`, so the server can answer
 * it from three small reads before a purchase instead of building the entire
 * farm twice -- and so this module cannot quietly grow a dependency on
 * something that moves Gold.
 */
export interface StackAcresShopProgress {
  /** The DERIVED unlocked list -- `unlockedSectors(cleared, units)`, not the
   *  raw cleared rows. See the file header on why. */
  readonly sectors: readonly SectorId[];
  /** Town Influence earned to date. Cumulative and never spent down, which
   *  is what makes `town_trusted` safe to build on. */
  readonly influence: number;
  readonly greenhouseBuilt: boolean;
  /** Whether the Crop Fields have been unlocked -- ./crop-fields.ts's own
   *  standalone flag, not a sector any more (see that module's header). */
  readonly cropFieldsUnlocked: boolean;
}

/** Every flag this farm has earned. */
export function stackacresQuestFlags(
  progress: StackAcresShopProgress,
): ReadonlySet<StackAcresQuestFlag> {
  const earned = new Set<StackAcresQuestFlag>();
  if (progress.cropFieldsUnlocked) earned.add("crop_fields_unlocked");
  if (progress.sectors.includes("wallow")) earned.add("cleared_wallow");
  if (progress.sectors.includes("oxfields")) earned.add("cleared_oxfields");
  if (progress.influence > 0) earned.add("town_trusted");
  if (progress.greenhouseBuilt) earned.add("greenhouse_raised");
  return earned;
}

/* ------------------------------------------------------------------ */
/* The milestone ladder                                                */
/* ------------------------------------------------------------------ */

/**
 * How far along the farm is, as one integer: how many of the flags above it
 * holds.
 *
 * A PLAIN COUNT, IN ANY ORDER, and that is the whole design decision here.
 * The obvious alternative -- the length of the leading run, so milestone 3
 * means "the first three, in order" -- reads better in a hint but is wrong
 * about this farm: the three land flags are forced into order by the sector
 * ladder's own `requires` chain, while the Greenhouse and the town's first
 * order float free of it. Under a leading-run count a player who has cleared
 * all three districts but never taken a town order would sit at milestone 1,
 * which is plainly a lie about their farm.
 *
 * Counting instead makes the number MONOTONE, which is the property that
 * actually matters: every flag is built on a permanent fact (see the header),
 * so a count of permanent facts can only go up, and no shelf row that was
 * once open closes again.
 */
export const STACKACRES_MAX_MILESTONE = STACKACRES_QUEST_FLAGS.length;

export function stackacresMilestone(progress: StackAcresShopProgress): number {
  return stackacresQuestFlags(progress).size;
}

/** The first flag on the ladder this farm has not earned, or null when it
 *  holds every one. What a milestone lock's hint points at next. */
export function nextStackAcresMilestone(
  progress: StackAcresShopProgress,
): StackAcresQuestFlag | null {
  const earned = stackacresQuestFlags(progress);
  return STACKACRES_QUEST_FLAGS.find((flag) => !earned.has(flag)) ?? null;
}

/* ------------------------------------------------------------------ */
/* The lock a shelf row carries                                        */
/* ------------------------------------------------------------------ */

/**
 * The two optional fields a shop registry entry may carry.
 *
 * Structural on purpose: `StackAcresFeedDef` and `StackAcresToolTierDef` both
 * satisfy this by declaring the fields inline, so neither registry has to
 * import a wrapper type or nest its lock under a `lock:` key. Adding a gate
 * to a third registry is two optional fields, not a refactor.
 *
 * BOTH ARE OPTIONAL AND BOTH ARE ANDED when set. An entry carrying neither is
 * an ordinary row that has always been for sale; nothing about the existing
 * shelf changes by declaring this interface.
 */
export interface StackAcresShopLock {
  /** One named flag that must be earned. */
  readonly requiredQuestFlag?: StackAcresQuestFlag;
  /** How many flags in total must be earned. 0 or absent asks for nothing. */
  readonly minimumMilestone?: number;
}

/**
 * A shelf row's gate, resolved against one farm.
 *
 * `isUnlocked` STARTS FALSE for any row that carries a lock and is only
 * flipped by a condition this farm actually meets -- the default for an
 * advanced item is shut, and a progress struct that is missing, empty or
 * malformed leaves it shut rather than open. A row with no lock at all is
 * not "an advanced item that happens to pass"; it never had a gate, and it
 * resolves unlocked with no hint.
 */
export interface StackAcresShopLockState {
  readonly isUnlocked: boolean;
  /** One short line naming what is still missing. Null when unlocked. */
  readonly lockHint: string | null;
  /** How many flags this farm holds, and how many the row asks for. Both 0
   *  for a row with no milestone requirement. Rendered as "1 of 3" by the
   *  shelf; kept out of `lockHint` so the UI can show progress on a row
   *  whose hint is naming a specific quest instead. */
  readonly milestone: number;
  readonly milestoneRequired: number;
}

const OPEN: StackAcresShopLockState = {
  isUnlocked: true,
  lockHint: null,
  milestone: 0,
  milestoneRequired: 0,
};

/**
 * Resolves one registry entry's gate.
 *
 * Takes the entry itself rather than a lock plucked out of it, so a call site
 * cannot forget to pass one of the two fields -- the commonest way a gate
 * quietly stops gating.
 */
export function evaluateStackAcresShopLock(
  entry: StackAcresShopLock,
  progress: StackAcresShopProgress,
): StackAcresShopLockState {
  const required = Math.max(0, Math.trunc(entry.minimumMilestone ?? 0));
  if (!entry.requiredQuestFlag && required === 0) return OPEN;

  const earned = stackacresQuestFlags(progress);
  const milestone = earned.size;

  // The named quest is checked first and reported first: it is the more
  // specific of the two, so a row asking for both is better answered with
  // "clear the Fold" than with "you need three milestones".
  if (entry.requiredQuestFlag && !earned.has(entry.requiredQuestFlag)) {
    return {
      isUnlocked: false,
      lockHint: `Requires: ${STACKACRES_QUEST_LABELS[entry.requiredQuestFlag]}`,
      milestone,
      milestoneRequired: required,
    };
  }

  if (milestone < required) {
    const next = STACKACRES_QUEST_FLAGS.find((flag) => !earned.has(flag));
    // `next` is only null when the farm holds every flag, which cannot be
    // true while `milestone < required` unless a registry entry asks for more
    // milestones than exist -- shop-locks.test.ts refuses that, and the
    // fallback keeps this a hint rather than a crash if one ever lands.
    const suffix = next ? ` — next: ${STACKACRES_QUEST_LABELS[next]}` : "";
    const noun = required === 1 ? "milestone" : "milestones";
    return {
      isUnlocked: false,
      lockHint: `Requires ${required} farm ${noun} (${milestone} done)${suffix}`,
      milestone,
      milestoneRequired: required,
    };
  }

  return { isUnlocked: true, lockHint: null, milestone, milestoneRequired: required };
}

/**
 * The one-line refusal the SERVER raises when a request reaches a locked row
 * anyway -- a hand-rolled fetch, a stale tab, or a second window opened
 * before the farm regressed. Quotes the same hint the shelf shows, so the two
 * surfaces cannot word it differently.
 */
export function stackacresShopLockRefusal(label: string, state: StackAcresShopLockState): string {
  const hint = state.lockHint ?? "Not yet.";
  return `Ray won't sell you a ${label} yet. ${hint}.`;
}
