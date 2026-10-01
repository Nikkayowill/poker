/**
 * The Daily Farm Board: three objectives a day, drawn from work this farm
 * can already do.
 *
 * NOT A NEW PROGRESSION SYSTEM, and that is the whole design constraint.
 * Everything here is assembled out of parts that already exist:
 *
 *   objectives   `StoryObjective` (./story/quests.ts), the same union the
 *                travelers use, so `objectiveAdvance` and `objectiveLabel`
 *                are shared rather than reimplemented.
 *   events       `StoryEvent` (./story/events.ts), the same stream the
 *                server already emits inside each action and the client
 *                already replays locally.
 *   periods      UTC day and UTC Monday, from lib/missions/period.ts, which
 *                the arcade missions and the daily Gold grant already share.
 *   rewards      Gold through the existing keyed grant ledger, and Town
 *                Influence through `adjust_homestead_influence`.
 *
 * A BOARD IS ONLY EVER DRAWN FROM WHAT THE PLAYER CAN ACTUALLY DO, which is
 * why `drawFarmBoard` takes `FarmBoardFacts` rather than reading a farm
 * itself -- the same reason ./contracts.ts's `drawContract` takes the
 * makeable set. An objective for a machine this farm has not built is not a
 * missed opportunity, it is a dead slot for the whole day. Every slot below
 * has at least one candidate that needs nothing built, so a farm on its
 * first morning still draws a full board (pinned in ./farm-board.test.ts).
 *
 * TWO PERIODS, NOT THREE. The easy and steady slots are a UTC day; the long
 * slot is a UTC week, because an objective that resets at midnight is not a
 * long-term objective, whatever it is labelled. A third custom period would
 * be a third boundary to get wrong.
 *
 * WHERE GOLD ENTERS AND LEAVES (lib/stackacres/CLAUDE.md asks this first).
 * It enters: a finished line, CLAIMED by its own action, credits
 * `goldReward` at most once per code per period, through the same
 * keyed-ledger shape missions use. See `advanceFarmBoard` for why this is a
 * claim rather than the auto-credit the arcade missions use. It
 * leaves: nowhere -- the board charges nothing, has no entry fee and cannot
 * be rerolled for Gold. The faucet is bounded by construction, not by a
 * ceiling check: at most two daily codes and one weekly code exist for a
 * profile at a time, and `FARM_BOARD_MAX_GOLD` pins what that is worth
 * in a test. Rewards sit near the bottom of the earning ladder on purpose
 * (a Flour order, the cheapest town contract, pays 140) -- this is a nudge
 * toward work the player was going to do anyway, not an income source, and
 * docs/stackacres-direction.md section 19 is why it must not become a chore
 * worth farming for its own sake.
 *
 * MISSING A DAY COSTS NOTHING. There is no streak, no multiplier and no
 * decay: an undrawn or unfinished board simply expires with its period.
 */

import type { MachineKind } from "./machines";
import { RECIPE_CATALOGUE, type RecipeId } from "./recipes";
import type { StoryEvent } from "./story/events";
import { objectiveAdvance, objectiveLabel, type StoryObjective } from "./story/quests";

/**
 * The three slots, in board order.
 *
 * `easy` and `steady` are today's; `long` is this week's. A slot holds
 * exactly one objective, so the board is always three lines.
 */
export type FarmBoardSlot = "easy" | "steady" | "long";

export const FARM_BOARD_SLOTS: readonly FarmBoardSlot[] = ["easy", "steady", "long"];

/** Which period a slot's objective lives in. */
export type FarmBoardPeriodKind = "daily" | "weekly";

export function slotPeriodKind(slot: FarmBoardSlot): FarmBoardPeriodKind {
  return slot === "long" ? "weekly" : "daily";
}

export interface FarmBoardEntry {
  /** Stable id. Stored, and the reward ledger's key is built from it, so
   *  renaming one is a migration, not an edit. */
  readonly code: string;
  readonly slot: FarmBoardSlot;
  readonly objective: StoryObjective;
  readonly goldReward: number;
  readonly influenceReward: number;
  /** What has to be true of the farm for this to be drawable at all. */
  readonly needs: FarmBoardRequirement;
}

/**
 * A drawability requirement, deliberately coarse.
 *
 * `"none"` is work any farm can do from its first minute (chop, mine, pick,
 * fish, walk to Ray's porch). The rest name one fact off the snapshot
 * `view()` already builds -- no new read, and nothing here asks a question
 * the board cannot answer before it draws.
 */
export type FarmBoardRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "crops" }
  | { readonly kind: "livestock" }
  | { readonly kind: "machine"; readonly machine: MachineKind }
  | { readonly kind: "recipe"; readonly recipe: RecipeId };

/** What the board needs to know about a farm to draw for it. Every field is
 *  already on `StackAcresView`; see `farmBoardFacts` in
 *  lib/server/stackacres-farm-board-service.ts. */
export interface FarmBoardFacts {
  /** Processing buildings placed. A `recipe` requirement reads this through
   *  the recipe's own `machine`, so the two never disagree. */
  readonly machines: readonly MachineKind[];
  /** Any crop growing, or any seed on the shelf to sow. Watering and
   *  harvesting are both dead slots without one. */
  readonly hasCrops: boolean;
  /** Any animal owned, mucked or not. */
  readonly hasLivestock: boolean;
}

/* ------------------------------------------------------------------ */
/* The pool                                                            */
/* ------------------------------------------------------------------ */

const NONE: FarmBoardRequirement = { kind: "none" };
const CROPS: FarmBoardRequirement = { kind: "crops" };
const LIVESTOCK: FarmBoardRequirement = { kind: "livestock" };

function recipe(id: RecipeId): FarmBoardRequirement {
  return { kind: "recipe", recipe: id };
}

/**
 * Every objective the board can draw.
 *
 * Rewards go up with the work, and the ladder is flat within a slot on
 * purpose: a slot where one candidate paid better would turn a board the
 * player cannot reroll into a bad draw they are stuck with all day, the
 * same trap ./contracts.ts's header describes for its rungs.
 */
const EASY_GOLD = 60;
const EASY_INFLUENCE = 2;
const STEADY_GOLD = 180;
const STEADY_INFLUENCE = 6;
const LONG_GOLD = 900;
const LONG_INFLUENCE = 30;

export const FARM_BOARD_POOL: readonly FarmBoardEntry[] = [
  // ---- easy: a few minutes ----
  { code: "easy_chop_3", slot: "easy", objective: { kind: "chop", target: 3 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: NONE },
  { code: "easy_mine_3", slot: "easy", objective: { kind: "mine", target: 3 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: NONE },
  { code: "easy_forage_2", slot: "easy", objective: { kind: "forage", target: 2 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: NONE },
  { code: "easy_fish_1", slot: "easy", objective: { kind: "fish", target: 1 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: NONE },
  { code: "easy_visit_ray", slot: "easy", objective: { kind: "reach-place", place: "ray_porch", target: 1 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: NONE },
  { code: "easy_harvest_3", slot: "easy", objective: { kind: "harvest-any-crop", target: 3 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: CROPS },
  { code: "easy_water_5", slot: "easy", objective: { kind: "water", target: 5 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: CROPS },
  { code: "easy_collect_2", slot: "easy", objective: { kind: "collect-livestock", target: 2 }, goldReward: EASY_GOLD, influenceReward: EASY_INFLUENCE, needs: LIVESTOCK },

  // ---- steady: an afternoon ----
  { code: "steady_chop_12", slot: "steady", objective: { kind: "chop", target: 12 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: NONE },
  { code: "steady_mine_10", slot: "steady", objective: { kind: "mine", target: 10 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: NONE },
  { code: "steady_fish_3", slot: "steady", objective: { kind: "fish", target: 3 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: NONE },
  { code: "steady_harvest_10", slot: "steady", objective: { kind: "harvest-any-crop", target: 10 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: CROPS },
  { code: "steady_feed_4", slot: "steady", objective: { kind: "feed", target: 4 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: LIVESTOCK },
  { code: "steady_flour_2", slot: "steady", objective: { kind: "process", recipe: "flour", target: 2 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: recipe("flour") },
  { code: "steady_bread_1", slot: "steady", objective: { kind: "process", recipe: "bread", target: 1 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: recipe("bread") },
  { code: "steady_stew_1", slot: "steady", objective: { kind: "process", recipe: "stew", target: 1 }, goldReward: STEADY_GOLD, influenceReward: STEADY_INFLUENCE, needs: recipe("stew") },

  // ---- long: a week, and the only slot that survives midnight ----
  { code: "long_chop_60", slot: "long", objective: { kind: "chop", target: 60 }, goldReward: LONG_GOLD, influenceReward: LONG_INFLUENCE, needs: NONE },
  { code: "long_fish_15", slot: "long", objective: { kind: "fish", target: 15 }, goldReward: LONG_GOLD, influenceReward: LONG_INFLUENCE, needs: NONE },
  { code: "long_mine_45", slot: "long", objective: { kind: "mine", target: 45 }, goldReward: LONG_GOLD, influenceReward: LONG_INFLUENCE, needs: NONE },
  { code: "long_harvest_60", slot: "long", objective: { kind: "harvest-any-crop", target: 60 }, goldReward: LONG_GOLD, influenceReward: LONG_INFLUENCE, needs: CROPS },
  { code: "long_contracts_3", slot: "long", objective: { kind: "contracts", target: 3 }, goldReward: LONG_GOLD, influenceReward: LONG_INFLUENCE, needs: recipe("flour") },
  { code: "long_flour_12", slot: "long", objective: { kind: "process", recipe: "flour", target: 12 }, goldReward: LONG_GOLD, influenceReward: LONG_INFLUENCE, needs: recipe("flour") },
];

/** The most Gold one profile's whole board can be worth: both of today's
 *  lines and this week's, together. Pinned by a test. The board is capped by
 *  how many codes can exist at once, not by a runtime ceiling check. */
export const FARM_BOARD_MAX_GOLD = EASY_GOLD + STEADY_GOLD + LONG_GOLD;

const BY_CODE: Readonly<Record<string, FarmBoardEntry>> = Object.fromEntries(
  FARM_BOARD_POOL.map((entry) => [entry.code, entry]),
);

export function farmBoardEntry(code: string): FarmBoardEntry | null {
  return BY_CODE[code] ?? null;
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export function farmBoardRequirementMet(need: FarmBoardRequirement, facts: FarmBoardFacts): boolean {
  switch (need.kind) {
    case "none":
      return true;
    case "crops":
      return facts.hasCrops;
    case "livestock":
      return facts.hasLivestock;
    case "machine":
      return facts.machines.includes(need.machine);
    case "recipe":
      // Read through the recipe rather than naming the building twice: a
      // recipe that moves to another machine moves its requirement with it.
      return facts.machines.includes(RECIPE_CATALOGUE[need.recipe].machine);
  }
}

/** Everything this farm could be asked for, in pool order. */
export function eligibleFarmBoardEntries(facts: FarmBoardFacts): readonly FarmBoardEntry[] {
  return FARM_BOARD_POOL.filter((entry) => farmBoardRequirementMet(entry.needs, facts));
}

/* ------------------------------------------------------------------ */
/* The draw                                                            */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a, 32-bit. A hash, not a random number generator: the draw has to be
 * the same answer for the same (profile, period, slot) every time it is
 * asked, because the drawn codes are persisted on first read and any later
 * recompute has to agree with the row that was stored.
 */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/**
 * One slot's objective for one profile and one period.
 *
 * Deterministic, and per-profile rather than global so two players on the
 * same day are not handed the same three lines. Returns null only when the
 * slot has no eligible candidate at all, which the pool is built to make
 * unreachable -- `farm-board.test.ts` holds that for an empty farm.
 */
export function drawFarmBoardSlot(
  slot: FarmBoardSlot,
  profileId: string,
  periodStart: string,
  facts: FarmBoardFacts,
): FarmBoardEntry | null {
  const candidates = eligibleFarmBoardEntries(facts).filter((entry) => entry.slot === slot);
  if (candidates.length === 0) return null;
  return candidates[hash(`${profileId}:${periodStart}:${slot}`) % candidates.length];
}

/** The codes one period's row should hold, in slot order. */
export function drawFarmBoardCodes(
  periodKind: FarmBoardPeriodKind,
  profileId: string,
  periodStart: string,
  facts: FarmBoardFacts,
): readonly string[] {
  return FARM_BOARD_SLOTS.filter((slot) => slotPeriodKind(slot) === periodKind)
    .map((slot) => drawFarmBoardSlot(slot, profileId, periodStart, facts))
    .filter((entry): entry is FarmBoardEntry => entry !== null)
    .map((entry) => entry.code);
}

/* ------------------------------------------------------------------ */
/* Stored, and how an event moves it                                   */
/* ------------------------------------------------------------------ */

/**
 * One period's row. `codes` and `counts` are positional and the same length;
 * `claimed` names the codes whose reward has been taken, so a finished line
 * is never paid twice even if the row is rewritten.
 */
export interface StoredFarmBoard {
  readonly codes: readonly string[];
  readonly counts: readonly number[];
  readonly claimed: readonly string[];
}

export function freshFarmBoard(codes: readonly string[]): StoredFarmBoard {
  return { codes, counts: codes.map(() => 0), claimed: [] };
}

/** How far along one code is against its own target. Clamped, so a count
 *  stored before a target was retuned downward cannot read over 100%. */
export function farmBoardProgress(entry: FarmBoardEntry, count: number): number {
  return Math.min(entry.objective.target, Math.max(0, count));
}

export function farmBoardComplete(entry: FarmBoardEntry, count: number): boolean {
  return count >= entry.objective.target;
}

/**
 * The row after a batch of events.
 *
 * COUNTS ONLY. Nothing here pays: a finished line waits to be claimed (see
 * `claimFarmBoard` below). That is not the shape the arcade missions use --
 * they auto-credit the moment a mission completes -- and the difference is
 * deliberate. StackAcres pins every Gold credit in its farm service to a
 * named site (the "currency wall" in lib/server/stackacres-service.test.ts),
 * and a reward that can fire inside ANY action would mean every "this action
 * moves no Gold" invariant on the farm now depends on which objective that
 * player happened to draw. It made two of those tests pass or fail on the
 * profile id. A claim keeps the money in exactly one place.
 *
 * Returns the same object when nothing moved, the same "no write needed"
 * signal ./story/state.ts's `applyStoryEvent` gives its caller. A claimed or
 * already-finished code stops counting: letting a finished counter keep
 * climbing would make the stored number a lie about what was asked for.
 */
export function advanceFarmBoard(
  board: StoredFarmBoard,
  events: readonly StoryEvent[],
): StoredFarmBoard {
  if (events.length === 0) return board;

  let changed = false;
  const counts = board.codes.map((code, i) => {
    const current = board.counts[i] ?? 0;
    const entry = farmBoardEntry(code);
    // An unknown code (retired from the pool mid-period) stops counting
    // rather than throwing: the row outlives a deploy, the pool does not.
    if (!entry || farmBoardComplete(entry, current)) return current;

    const delta = events.reduce((sum, event) => sum + objectiveAdvance(entry.objective, event), 0);
    if (delta <= 0) return current;

    const next = farmBoardProgress(entry, current + delta);
    if (next === current) return current;
    changed = true;
    return next;
  });

  if (!changed) return board;
  return { ...board, counts };
}

/* ------------------------------------------------------------------ */
/* Claiming                                                            */
/* ------------------------------------------------------------------ */

export type FarmBoardClaimRefusal = "unknown" | "unfinished" | "already-claimed";

export type FarmBoardClaim =
  | { readonly ok: true; readonly board: StoredFarmBoard; readonly entry: FarmBoardEntry }
  | { readonly ok: false; readonly refusal: FarmBoardClaimRefusal };

/**
 * Taking one finished line's reward.
 *
 * REFUSES BEFORE TOUCHING ANYTHING, the same posture a quest turn-in takes:
 * the caller only moves money once this has answered ok, and the row it
 * hands back is the one to write under the version guard first. The written
 * `claimed` list is the read-side guard; the money's own guard is the
 * keyed ledger in the migration, which is what makes a retry free.
 */
export function claimFarmBoard(board: StoredFarmBoard, code: string): FarmBoardClaim {
  const index = board.codes.indexOf(code);
  const entry = index === -1 ? null : farmBoardEntry(code);
  if (!entry) return { ok: false, refusal: "unknown" };
  if (board.claimed.includes(code)) return { ok: false, refusal: "already-claimed" };
  if (!farmBoardComplete(entry, board.counts[index] ?? 0)) return { ok: false, refusal: "unfinished" };
  return { ok: true, board: { ...board, claimed: [...board.claimed, code] }, entry };
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export interface FarmBoardLine {
  readonly code: string;
  readonly slot: FarmBoardSlot;
  /** The imperative line, from the travelers' own `objectiveLabel`. */
  readonly label: string;
  readonly progress: number;
  readonly target: number;
  readonly goldReward: number;
  readonly influenceReward: number;
  readonly complete: boolean;
  /** True once the reward has been taken. */
  readonly claimed: boolean;
  /** Finished and not yet taken: the one state the Journal offers a tap on. */
  readonly claimable: boolean;
  /** ISO instant this line's period ends, so the UI can say "resets in 6h"
   *  without doing its own calendar arithmetic. */
  readonly periodEnd: string;
}

export interface FarmBoardView {
  readonly lines: readonly FarmBoardLine[];
}

/** One period's stored row as lines. Drops a code the pool no longer has,
 *  for the same reason `advanceFarmBoard` stops counting it. */
export function farmBoardLines(
  board: StoredFarmBoard,
  periodEnd: string,
): readonly FarmBoardLine[] {
  return board.codes.flatMap((code, i) => {
    const entry = farmBoardEntry(code);
    if (!entry) return [];
    const count = farmBoardProgress(entry, board.counts[i] ?? 0);
    const complete = farmBoardComplete(entry, count);
    const claimed = board.claimed.includes(code);
    return [
      {
        code,
        slot: entry.slot,
        label: objectiveLabel(entry.objective),
        progress: count,
        target: entry.objective.target,
        goldReward: entry.goldReward,
        influenceReward: entry.influenceReward,
        complete,
        claimed,
        claimable: complete && !claimed,
        periodEnd,
      },
    ];
  });
}

/** Board order, whatever order the rows were read in. */
export function sortFarmBoardLines(lines: readonly FarmBoardLine[]): readonly FarmBoardLine[] {
  return [...lines].sort((a, b) => FARM_BOARD_SLOTS.indexOf(a.slot) - FARM_BOARD_SLOTS.indexOf(b.slot));
}
