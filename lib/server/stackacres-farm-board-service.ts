import "server-only";
import { utcDayKey, utcWeekKey } from "@/lib/missions/period";
import {
  advanceFarmBoard,
  claimFarmBoard,
  drawFarmBoardCodes,
  farmBoardEntry,
  farmBoardLines,
  freshFarmBoard,
  slotPeriodKind,
  sortFarmBoardLines,
  type FarmBoardEntry,
  type FarmBoardFacts,
  type FarmBoardPeriodKind,
  type FarmBoardView,
  type StoredFarmBoard,
} from "@/lib/stackacres/farm-board";
import type { StoryEvent } from "@/lib/stackacres/story/events";
import {
  drawStackAcresFarmBoard,
  farmBoardFromBatchRow,
  grantStackAcresFarmBoardReward,
  readStackAcresFarmBoard,
  writeStackAcresFarmBoard,
  type FarmBoardRow,
} from "./stackacres-farm-board-store";

/**
 * The Daily Farm Board, server side: when it is drawn, how an action moves
 * it, and what a claim does.
 *
 * FOUR ENTRY POINTS, and the split is what keeps the cost down.
 *
 *   `farmBoardView`      runs inside view(), where every fact the draw
 *                        needs is already loaded. A period with no stored
 *                        board shows the one its first action will store,
 *                        drawn the same way, and stores nothing: a read
 *                        never writes, a visitor's read of someone else's
 *                        farm included.
 *   `storeFarmBoardBeforeAction` runs before every farm action. It is the
 *                        ONLY place a board is stored, and the farm's facts
 *                        are read for it only when a period has no board yet,
 *                        so once a period's board exists it costs one read.
 *   `recordFarmBoardEvents` runs inside the action that produced the
 *                        events. It needs no facts at all -- eligibility is
 *                        a question about the draw, and the draw already
 *                        happened -- so it is one read and one write, the
 *                        same cost `recordStoryEvents` beside it pays. It
 *                        moves no money.
 *   `claimFarmBoardReward` is the player's own tap, and the only thing here
 *                        that pays. See lib/stackacres/farm-board.ts's
 *                        `advanceFarmBoard` for why the reward is claimed
 *                        rather than credited the moment a line finishes.
 *
 * STORED BEFORE THE ACTION, NOT AFTER. The draw depends on what the farm can
 * do, and an action can change that (the first seed, the first machine). The
 * period's first action stores the board from the farm as it stood before it
 * acted, which is the farm the player's last read showed the board for, so
 * the board on screen is the board that gets stored and it stays put for the
 * rest of the period. Storing it first also means that action's own work
 * already counts toward it.
 *
 * BEST-EFFORT, EXCEPT THE CLAIM. A draw or an advance is wrapped: a board
 * hiccup must never turn a farm action into an error response, the same
 * posture `recordStoryEvents` takes. A claim is the opposite -- it is the
 * whole point of the request, so its refusals are answers the route turns
 * into a line the player reads.
 */

/** How many times a board write is re-read and retried after losing a
 *  version race. Two farm actions landing in the same instant is the
 *  common case; more is a client hammering the route, which the rate
 *  limiter answers. Matches STORY_WRITE_ATTEMPTS. */
const BOARD_WRITE_ATTEMPTS = 3;

export interface FarmBoardPeriod {
  readonly kind: FarmBoardPeriodKind;
  readonly start: string;
  /** ISO instant the period ends: the next UTC midnight, or next Monday's. */
  readonly end: string;
}

function endOfDay(day: string): string {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function endOfWeek(monday: string): string {
  const next = new Date(`${monday}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}

/** Both periods in progress at `now`, from the server's clock only. The
 *  client's clock never reaches this. */
export function farmBoardPeriods(now: Date): readonly FarmBoardPeriod[] {
  const day = utcDayKey(now);
  const week = utcWeekKey(now);
  return [
    { kind: "daily", start: day, end: endOfDay(day) },
    { kind: "weekly", start: week, end: endOfWeek(week) },
  ];
}

/* ------------------------------------------------------------------ */
/* Reading, and storing before the first action                        */
/* ------------------------------------------------------------------ */

/**
 * What a farm can be asked to do, from its units' stock, its seed shelf and
 * its machines. One function for both the read and the store, so the board
 * a read shows and the board an action stores come from the same answer.
 */
export function farmBoardFacts(
  stocks: readonly StackAcresStock[],
  seedStock: SeedStock,
  machines: readonly MachineKind[],
): FarmBoardFacts {
  return {
    machines,
    // Seed on the shelf counts as "has crops" as much as a bed already
    // sown does: a board that asked a player with seed to harvest is
    // asking for work they can do, and one drawn the other way would
    // have nothing to water on the morning they spend it.
    hasCrops: stocks.some(isStackAcresCrop) || Object.values(seedStock).some((held) => (held ?? 0) > 0),
    hasLivestock: stocks.some(isLivestock),
  };
}

/** The board `period` gets for these facts, or null when no slot has a
 *  candidate at all. Not stored: see `storeFarmBoardBeforeAction`. */
function periodBoard(profileId: string, period: FarmBoardPeriod, facts: FarmBoardFacts): StoredFarmBoard | null {
  const codes = drawFarmBoardCodes(period.kind, profileId, period.start, facts);
  return codes.length > 0 ? freshFarmBoard(codes) : null;
}

/** Rows already fetched by `stackacres_read_batch`, so `farmBoardView` can
 *  skip its own reads on the live-Supabase path. Undefined means "not
 *  batched, read it yourself". */
export interface BatchedFarmBoards {
  readonly daily: FarmBoardRow | null;
  readonly weekly: FarmBoardRow | null;
}

export function farmBoardsFromBatch(
  daily: Record<string, unknown> | null,
  weekly: Record<string, unknown> | null,
): BatchedFarmBoards {
  return {
    daily: farmBoardFromBatchRow(daily as { board: StoredFarmBoard; version: number | string } | null),
    weekly: farmBoardFromBatchRow(weekly as { board: StoredFarmBoard; version: number | string } | null),
  };
}

/**
 * The board this player sees. A period with no stored board yet shows the
 * one its first action will store, without storing it.
 *
 * Never throws: a board is a side panel, and a farm that cannot read one
 * still has to load. An unreadable board comes back empty, which the UI
 * renders as no board rather than an error.
 */
export async function farmBoardView(
  profileId: string,
  facts: FarmBoardFacts,
  now: Date,
  batched?: BatchedFarmBoards,
): Promise<FarmBoardView> {
  try {
    const periods = farmBoardPeriods(now);
    const boards = await Promise.all(
      periods.map(async (period) => {
        const existing =
          batched !== undefined
            ? period.kind === "daily"
              ? batched.daily
              : batched.weekly
            : await readStackAcresFarmBoard(profileId, period.kind, period.start);
        return { period, board: existing ? existing.board : periodBoard(profileId, period, facts) };
      }),
    );

    const lines = boards.flatMap(({ period, board }) =>
      board ? farmBoardLines(board, period.end) : [],
    );
    return { lines: sortFarmBoardLines(lines) };
  } catch (error) {
    console.error("stackacres.farm_board_read_failed", { profileId, error });
    return { lines: [] };
  }
}

/**
 * Stores each period's board that is not stored yet, before an action runs.
 *
 * `readFacts` is only called when a period has no board, so most actions pay
 * one read here and nothing more. The facts are read before the action
 * changes anything, so the stored board is the one the player's last read
 * showed. Two first actions at once store one board: the draw keeps whichever
 * row landed first.
 *
 * Never throws, like `recordFarmBoardEvents`: a board that could not be
 * stored must not stop the action. That action's events then count toward
 * nothing, and the next action tries again.
 */
export async function storeFarmBoardBeforeAction(
  profileId: string,
  now: Date,
  readFacts: () => Promise<FarmBoardFacts>,
): Promise<void> {
  try {
    const periods = farmBoardPeriods(now);
    const stored = await Promise.all(
      periods.map((period) => readStackAcresFarmBoard(profileId, period.kind, period.start)),
    );
    const missing = periods.filter((_, i) => stored[i] === null);
    if (missing.length === 0) return;

    const facts = await readFacts();
    await Promise.all(
      missing.map(async (period) => {
        const board = periodBoard(profileId, period, facts);
        if (board) await drawStackAcresFarmBoard(profileId, period.kind, period.start, board);
      }),
    );
  } catch (error) {
    console.error("stackacres.farm_board_store_failed", { profileId, error });
  }
}

/* ------------------------------------------------------------------ */
/* Advancing, and paying                                               */
/* ------------------------------------------------------------------ */

/**
 * Advances both periods' boards by what an action just did.
 *
 * MOVES NO MONEY. A finished line waits to be claimed, which is what keeps
 * every "this farm action moves no Gold" invariant in
 * stackacres-service.test.ts true regardless of which objective a player
 * drew -- see `advanceFarmBoard`'s own header.
 */
export async function recordFarmBoardEvents(
  profileId: string,
  events: readonly StoryEvent[],
  now: Date,
): Promise<void> {
  if (events.length === 0) return;
  // The whole body is wrapped, not just each period: this runs inside a
  // settled, already-credited farm action, and nothing it can do -- not even
  // working out which periods are in progress -- may turn that action into
  // an error response.
  try {
    await Promise.all(
      farmBoardPeriods(now).map((period) =>
        advanceOnePeriod(profileId, period, events).catch((error) => {
          console.error("stackacres.farm_board_event_failed", { profileId, period: period.kind, error });
        }),
      ),
    );
  } catch (error) {
    console.error("stackacres.farm_board_events_failed", { profileId, error });
  }
}

async function advanceOnePeriod(
  profileId: string,
  period: FarmBoardPeriod,
  events: readonly StoryEvent[],
): Promise<void> {
  for (let attempt = 0; attempt < BOARD_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readStackAcresFarmBoard(profileId, period.kind, period.start);
    // Not drawn yet: this action lands before the player's first read of
    // the period. Nothing to advance, and nothing to draw here -- drawing
    // needs the farm's facts, which only view() has.
    if (!current) return;

    const advanced = advanceFarmBoard(current.board, events);
    if (advanced === current.board) return;

    const version = await writeStackAcresFarmBoard(
      profileId,
      period.kind,
      period.start,
      advanced,
      current.version,
    );
    if (version === null) continue;
    return;
  }
  console.error("stackacres.farm_board_event_lost_race", { profileId, period: period.kind, events });
}

/* ------------------------------------------------------------------ */
/* Claiming                                                           */
/* ------------------------------------------------------------------ */

export type FarmBoardClaimOutcome =
  | { readonly ok: true; readonly entry: FarmBoardEntry; readonly goldBalance: number | null }
  | { readonly ok: false; readonly reason: "unknown" | "unfinished" | "already-claimed" | "conflict" };

/**
 * Takes one finished line's reward.
 *
 * MONEY-ORDERING (CLAUDE.md), read for a credit: the claim is written to the
 * board FIRST, under its version guard, and only a confirmed write goes on
 * to ask for the money -- rule 2, "credit a payout only after the
 * version-guarded settlement write is confirmed". A crash between the two
 * leaves a line marked claimed and unpaid, which is the safe direction to
 * fail, and `grant_homestead_farm_board_reward`'s key means a retried claim
 * pays nothing twice rather than twice over.
 *
 * Unlike everything else in this module, this one THROWS nothing and
 * swallows nothing: it is a player's own tap, so a refusal is an answer the
 * route turns into a message.
 */
export async function claimFarmBoardReward(
  profileId: string,
  code: string,
  now: Date,
): Promise<FarmBoardClaimOutcome> {
  for (let attempt = 0; attempt < BOARD_WRITE_ATTEMPTS; attempt += 1) {
    // A code names its own slot, so it names its own period: no need to ask
    // the client which board it meant, and no way for it to claim a daily
    // line against the weekly row.
    const period = periodForCode(code, now);
    if (!period) return { ok: false, reason: "unknown" };

    const current = await readStackAcresFarmBoard(profileId, period.kind, period.start);
    if (!current) return { ok: false, reason: "unknown" };

    const claim = claimFarmBoard(current.board, code);
    if (!claim.ok) return { ok: false, reason: claim.refusal };

    const version = await writeStackAcresFarmBoard(
      profileId,
      period.kind,
      period.start,
      claim.board,
      current.version,
    );
    if (version === null) continue;

    const grant = await grantStackAcresFarmBoardReward(
      profileId,
      code,
      period.start,
      claim.entry.goldReward,
      claim.entry.influenceReward,
    );
    if (!grant.granted) {
      // The key was already spent: an earlier claim of this same line paid,
      // and this one only just recorded it. Nothing owed.
      return { ok: false, reason: "already-claimed" };
    }
    return { ok: true, entry: claim.entry, goldBalance: grant.goldBalance };
  }
  return { ok: false, reason: "conflict" };
}

/** Which period a code belongs to, from its own slot. Null for a code this
 *  deploy's pool does not have. */
function periodForCode(code: string, now: Date): FarmBoardPeriod | null {
  const entry = farmBoardEntry(code);
  if (!entry) return null;
  const kind = slotPeriodKind(entry.slot);
  return farmBoardPeriods(now).find((period) => period.kind === kind) ?? null;
}
