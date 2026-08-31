import "server-only";
import { randomUUID } from "crypto";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the daily puzzles.
 *
 * This is not arcade_rounds. blackjack-store.ts's shape is right for a casino
 * round and wrong for a daily puzzle, in one way that matters and two that
 * are merely awkward.
 *
 * The one that matters: its unique index is partial on `status = 'active'`,
 * so a settled round never blocks a new one, which is correct for a casino
 * game like Blackjack, where dealing again is the whole point, and
 * catastrophic here. Everyone shares one board per day. If finishing today's
 * Word Stack let you open another, the second attempt would be the same word
 * you had just been shown, and the share grid, the only thing this feature
 * exists to produce, would be a claim nobody could trust. The index below is
 * therefore unconditional on (profile, game, day): one attempt, finished or
 * not, per player per day.
 *
 * The awkward two: `base_stake integer not null check (base_stake > 0)` and a
 * `tier` have no meaning for a free puzzle, and bending them (stake 0, tier
 * 'none') would leave two columns lying in every row.
 *
 * What's kept from it is everything else: the same jsonb `state` holding
 * secrets the client must never see, the same version column as concurrency
 * guard, the same Supabase-or-memory split, the same "null means you lost the
 * race" rule on the guarded update. This is a sibling of that file, not a
 * departure from it, and a reader who knows one knows this one.
 *
 * The version guard does less work here than it does in the casino stores:
 * there is no payout to fire exactly once, so a lost race costs a guess rather
 * than money. It is still the thing that stops a double-fired submit from
 * spending two of a player's six guesses on one word.
 */

export type DailyPuzzleStatus = "active" | "complete";

export interface StoredPuzzleRound<TRound> {
  id: string;
  profileId: string;
  game: string;
  /** The UTC calendar day, `YYYY-MM-DD`. Part of the identity, not a timestamp. */
  day: string;
  version: number;
  status: DailyPuzzleStatus;
  round: TRound;
}

/**
 * Thrown when the player already has an attempt at this day's puzzle.
 *
 * Not an error the player ever sees: every caller resolves it by reading the
 * existing attempt and returning that instead. It exists because the check has
 * to be the database's, not the route's; see createPuzzleRound.
 */
export class DailyPuzzleAlreadyStarted extends Error {
  constructor(game: string, day: string) {
    super(`You have already started the ${game} puzzle for ${day}.`);
    this.name = "DailyPuzzleAlreadyStarted";
  }
}

declare global {
  var __riverRoomDailyPuzzles: Map<string, StoredPuzzleRound<unknown>> | undefined;
  var __riverRoomDailyPuzzleCanon: Map<string, unknown> | undefined;
}

const memoryRounds = globalThis.__riverRoomDailyPuzzles ?? new Map<string, StoredPuzzleRound<unknown>>();
globalThis.__riverRoomDailyPuzzles = memoryRounds;

/** The memory branch's stand-in for daily_puzzle_canon. Keyed the same way as memoryRounds, minus profile_id. */
const memoryCanon = globalThis.__riverRoomDailyPuzzleCanon ?? new Map<string, unknown>();
globalThis.__riverRoomDailyPuzzleCanon = memoryCanon;

/** Test seam only: the memory branch is process-global, so suites must not leak attempts into each other. */
export function __resetDailyPuzzlesForTest(): void {
  memoryRounds.clear();
  memoryCanon.clear();
}

/** The memory branch's stand-in for the unique index. */
function memoryKey(profileId: string, game: string, day: string): string {
  return `${profileId}:${game}:${day}`;
}

/** The memory branch's stand-in for daily_puzzle_canon_one_per_day. */
function canonKey(game: string, day: string): string {
  return `${game}:${day}`;
}

interface PuzzleRow {
  id: string;
  profile_id: string;
  game: string;
  puzzle_day: string;
  version: number | string;
  status: string;
  state: unknown;
}

const PUZZLE_COLUMNS = "id, profile_id, game, puzzle_day, version, status, state";

function fromRow<TRound>(row: PuzzleRow): StoredPuzzleRound<TRound> {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    game: String(row.game),
    // Postgres hands back a `date` as an ISO string; slice guards the case
    // where a driver decides to hand back a timestamp instead.
    day: String(row.puzzle_day).slice(0, 10),
    version: Number(row.version),
    status: String(row.status) as DailyPuzzleStatus,
    round: row.state as TRound,
  };
}

/** A defensive copy, so a caller mutating what it got back cannot reach into the memory store. */
function clone<TRound>(stored: StoredPuzzleRound<TRound>): StoredPuzzleRound<TRound> {
  return { ...stored, round: structuredClone(stored.round) };
}

/**
 * The player's attempt at one day's puzzle, finished or not.
 *
 * Not filtered by status, unlike getActiveArcadeRound. Reading only active
 * attempts is exactly the bug this store exists to prevent: it would report
 * "no attempt" for a puzzle already played and the caller would happily deal
 * it again.
 */
export async function getPuzzleRound<TRound>(
  profileId: string,
  game: string,
  day: string,
): Promise<StoredPuzzleRound<TRound> | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryRounds.get(memoryKey(profileId, game, day));
    return found ? (clone(found) as StoredPuzzleRound<TRound>) : null;
  }

  const { data, error } = await supabase
    .from("daily_puzzle_rounds")
    .select(PUZZLE_COLUMNS)
    .eq("profile_id", profileId)
    .eq("game", game)
    .eq("puzzle_day", day)
    .maybeSingle();
  if (error) throw new Error(`Could not load the ${game} puzzle: ${error.message}`);
  return data ? fromRow<TRound>(data as PuzzleRow) : null;
}

/**
 * Opens the player's attempt at a day's puzzle.
 *
 * Throws DailyPuzzleAlreadyStarted when one exists. Caught from the unique
 * index (23505) rather than by reading first and then inserting: two
 * concurrent opens (two tabs, a double-tap, a retried request) would all pass
 * a read-first check, and the loser would otherwise overwrite a board the
 * player has already made guesses on.
 */
export async function createPuzzleRound<TRound>(input: {
  profileId: string;
  game: string;
  day: string;
  round: TRound;
  /** A puzzle can in principle be over on the deal; none currently is. */
  complete: boolean;
}): Promise<StoredPuzzleRound<TRound>> {
  const supabase = adminClient();
  const status: DailyPuzzleStatus = input.complete ? "complete" : "active";

  if (!supabase) {
    const key = memoryKey(input.profileId, input.game, input.day);
    if (memoryRounds.has(key)) throw new DailyPuzzleAlreadyStarted(input.game, input.day);
    const stored: StoredPuzzleRound<TRound> = {
      id: randomUUID(),
      profileId: input.profileId,
      game: input.game,
      day: input.day,
      version: 1,
      status,
      round: input.round,
    };
    memoryRounds.set(key, clone(stored) as StoredPuzzleRound<unknown>);
    return clone(stored);
  }

  const { data, error } = await supabase
    .from("daily_puzzle_rounds")
    .insert({
      profile_id: input.profileId,
      game: input.game,
      puzzle_day: input.day,
      version: 1,
      status,
      state: input.round,
    })
    .select(PUZZLE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new DailyPuzzleAlreadyStarted(input.game, input.day);
    throw new Error(`Could not open the ${input.game} puzzle: ${error.message}`);
  }
  return fromRow<TRound>(data as PuzzleRow);
}

/**
 * Applies the next state, but only if nobody else already did.
 *
 * Returns null on a lost race: a stale version, a replayed submit, a
 * double-fired key handler. The caller must treat null as "this guess did not
 * happen": a player has six, and spending two of them on one word because a
 * request was retried is the failure this guard exists for.
 */
export async function advancePuzzleRound<TRound>(
  current: StoredPuzzleRound<TRound>,
  next: TRound,
  complete: boolean,
): Promise<StoredPuzzleRound<TRound> | null> {
  const supabase = adminClient();
  const status: DailyPuzzleStatus = complete ? "complete" : "active";
  const version = current.version + 1;

  if (!supabase) {
    const key = memoryKey(current.profileId, current.game, current.day);
    const stored = memoryRounds.get(key);
    // The same three conditions the WHERE clause below tests, in order: the
    // row exists, it is still open, and it is at the version acted on.
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredPuzzleRound<TRound> = {
      ...(stored as StoredPuzzleRound<TRound>),
      version,
      status,
      round: next,
    };
    memoryRounds.set(key, clone(updated) as StoredPuzzleRound<unknown>);
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("daily_puzzle_rounds")
    .update({ version, status, state: next, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(PUZZLE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not save the ${current.game} puzzle: ${error.message}`);
  return data ? fromRow<TRound>(data as PuzzleRow) : null;
}

/**
 * Any one player's attempt at a (game, day), regardless of whose.
 *
 * Used only to backfill the canonical answer cache (getOrCreateCanonicalAnswer,
 * below) from a real attempt written before that cache existed. Never use this
 * to read a specific player's board -- that stays getPuzzleRound's job, and it
 * stays profile-scoped; this function exists precisely because the canon
 * backfill has no profile of its own to scope by.
 */
export async function findAnyPuzzleRound<TRound>(
  game: string,
  day: string,
): Promise<StoredPuzzleRound<TRound> | null> {
  const supabase = adminClient();
  if (!supabase) {
    for (const stored of memoryRounds.values()) {
      if (stored.game === game && stored.day === day) return clone(stored) as StoredPuzzleRound<TRound>;
    }
    return null;
  }

  const { data, error } = await supabase
    .from("daily_puzzle_rounds")
    .select(PUZZLE_COLUMNS)
    .eq("game", game)
    .eq("puzzle_day", day)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not check for an existing ${game} attempt: ${error.message}`);
  return data ? fromRow<TRound>(data as PuzzleRow) : null;
}

/**
 * The one true answer for (game, day), computing and caching it on first
 * ever ask, and simply returning the cached one on every ask after.
 *
 * `compute` is a thunk, not a value, so a cache hit never runs pickDaily (or
 * whatever it wraps) at all -- the whole point is that it must not run again
 * once an answer for this day exists, since the pool it reads from may have
 * changed size since. It only runs on a genuine miss with nothing to
 * backfill from.
 *
 * Backfill: if any player already has a daily_puzzle_rounds row for this
 * (game, day) -- written before this cache existed, or a legitimate race
 * against another first-time asker -- that row's own answer (pulled out by
 * `extractFromRound`, which is the caller's business since this file has no
 * per-game knowledge of a round's shape) is the true historical answer and
 * is what gets cached, in preference to a fresh `compute()`.
 *
 * The insert races safely: the Supabase branch's upsert with ignoreDuplicates
 * is INSERT ... ON CONFLICT DO NOTHING, so a second concurrent caller's
 * insert is a no-op, and both callers then read back whichever row actually
 * won. The memory branch has no database to serialize the write for it, so
 * it does the equivalent by hand: re-checking the cache immediately before
 * writing and deferring to whatever a concurrent winner already set. Either
 * way, two simultaneous first-openers of the same historical day always
 * converge on one answer, never two different "true" ones.
 */
export async function getOrCreateCanonicalAnswer<TAnswer>(
  game: string,
  day: string,
  compute: () => TAnswer,
  extractFromRound: (round: unknown) => TAnswer,
): Promise<TAnswer> {
  const supabase = adminClient();
  const key = canonKey(game, day);

  if (!supabase) {
    const cached = memoryCanon.get(key);
    if (cached !== undefined) return structuredClone(cached) as TAnswer;
    const prior = await findAnyPuzzleRound(game, day);
    const answer = prior ? extractFromRound(prior.round) : compute();
    // Mirrors the Supabase branch's ON CONFLICT DO NOTHING + reselect: the
    // await above is a window a concurrent first-asker could have won in the
    // meantime, so re-check before writing and defer to whatever they set
    // rather than overwriting it -- without this re-check, two concurrent
    // memoryCanon.set calls would just take turns "winning" instead of
    // converging on one answer.
    const winner = memoryCanon.get(key);
    if (winner !== undefined) return structuredClone(winner) as TAnswer;
    memoryCanon.set(key, structuredClone(answer));
    return answer;
  }

  const prior = await findAnyPuzzleRound(game, day);
  const answer = prior ? extractFromRound(prior.round) : compute();

  const { error: upsertError } = await supabase
    .from("daily_puzzle_canon")
    .upsert({ game, puzzle_day: day, state: { answer } }, { onConflict: "game,puzzle_day", ignoreDuplicates: true });
  if (upsertError) throw new Error(`Could not cache the canonical ${game} answer for ${day}: ${upsertError.message}`);

  const { data, error } = await supabase
    .from("daily_puzzle_canon")
    .select("state")
    .eq("game", game)
    .eq("puzzle_day", day)
    .single();
  if (error) throw new Error(`Could not resolve the canonical ${game} answer for ${day}: ${error.message}`);
  return (data.state as { answer: TAnswer }).answer;
}

/**
 * Every attempt a player has ever made at a game, most recent first.
 *
 * Backs the puzzle archive's list view. Uses
 * daily_puzzle_rounds_profile_recent_idx (profile_id, game, puzzle_day desc)
 * -- that index's own comment in the 20260806120000 migration anticipated
 * exactly this query -- so this is an index range scan, not a seq-scan and
 * not one query per day.
 *
 * `before` is exclusive, e.g. the archive list uses it to leave today off:
 * today has its own live page and is not part of "days you missed."
 */
export async function getPuzzleRoundsForProfile<TRound>(
  profileId: string,
  game: string,
  options: { before?: string } = {},
): Promise<StoredPuzzleRound<TRound>[]> {
  const supabase = adminClient();

  if (!supabase) {
    const rounds = [...memoryRounds.values()]
      .filter((stored) => stored.profileId === profileId && stored.game === game)
      .filter((stored) => !options.before || stored.day < options.before)
      .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
    return rounds.map((stored) => clone(stored) as StoredPuzzleRound<TRound>);
  }

  let query = supabase
    .from("daily_puzzle_rounds")
    .select(PUZZLE_COLUMNS)
    .eq("profile_id", profileId)
    .eq("game", game)
    .order("puzzle_day", { ascending: false });
  if (options.before) query = query.lt("puzzle_day", options.before);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load ${game} history: ${error.message}`);
  return (data as PuzzleRow[]).map((row) => fromRow<TRound>(row));
}
