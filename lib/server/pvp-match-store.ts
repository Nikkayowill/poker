import "server-only";
import { randomUUID } from "crypto";
import type { DuelSeat } from "@/lib/pvp/match-contract";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for live and finished duels.
 *
 * The same twin-branch shape as arcade-round-store.ts -- Supabase when
 * configured, an in-process Map otherwise -- and the memory branch enforces
 * the same two invariants the table's constraints do, because `npm test` and a
 * no-env dev server both run on it: one active match per (player, game) for
 * BOTH seats, and a version that only ever advances from the value the caller
 * last saw.
 *
 * The stored `state` is the game's whole state INCLUDING what a client must
 * not see -- a trivia question's correct answer, a word race's solution.
 * Nothing here is safe to hand to a browser; the service redacts through each
 * game's own `snapshot`, per viewer.
 */

export type PvpMatchStatus = "active" | "settled";

export interface StoredPvpMatch<TState = unknown> {
  id: string;
  game: string;
  /** Indexed by seat: [seat 0, seat 1]. Ordered, never sorted -- the seat is part of the game. */
  players: [string, string];
  tier: string;
  /** Per player. The pot is stake * 2. */
  stake: number;
  status: PvpMatchStatus;
  /** Null on an active match means still playing; on a settled one, a draw. */
  winnerSeat: DuelSeat | null;
  version: number;
  state: TState;
  createdAt: string;
  settledAt: string | null;
}

declare global {
  var __riverRoomPvpMatches: Map<string, StoredPvpMatch> | undefined;
}

const memoryMatches = globalThis.__riverRoomPvpMatches ?? new Map<string, StoredPvpMatch>();
globalThis.__riverRoomPvpMatches = memoryMatches;

/** Test seam only: the memory branch is process-global, so suites must not leak matches into each other. */
export function __resetPvpMatchesForTest(): void {
  memoryMatches.clear();
}

/** Thrown when one of the two players already has a live match of this game. */
export class ActivePvpMatchExists extends Error {
  constructor(game: string) {
    super(`One of you is already in a ${game} match.`);
    this.name = "ActivePvpMatchExists";
  }
}

const MATCH_COLUMNS =
  "id, game, player0_id, player1_id, tier, stake, status, winner_seat, version, state, created_at, settled_at";

interface MatchRow {
  id: string;
  game: string;
  player0_id: string;
  player1_id: string;
  tier: string;
  stake: number | string;
  status: string;
  winner_seat: number | null;
  version: number | string;
  state: unknown;
  created_at: string;
  settled_at: string | null;
}

function fromRow<TState>(row: MatchRow): StoredPvpMatch<TState> {
  return {
    id: String(row.id),
    game: String(row.game),
    players: [String(row.player0_id), String(row.player1_id)],
    tier: String(row.tier),
    stake: Number(row.stake),
    status: String(row.status) as PvpMatchStatus,
    winnerSeat: row.winner_seat === null ? null : (Number(row.winner_seat) as DuelSeat),
    version: Number(row.version),
    state: row.state as TState,
    createdAt: String(row.created_at),
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

/** A defensive copy, so a caller mutating what it got back cannot reach into the memory store. */
function clone<TState>(match: StoredPvpMatch<TState>): StoredPvpMatch<TState> {
  return { ...match, players: [...match.players], state: structuredClone(match.state) };
}

function memoryActiveFor(profileId: string, game: string): StoredPvpMatch | undefined {
  return [...memoryMatches.values()].find(
    (match) =>
      match.status === "active"
      && match.game === game
      && (match.players[0] === profileId || match.players[1] === profileId),
  );
}

/** The caller's live match of this game, or null. What restores the board after a refresh. */
export async function getActivePvpMatch<TState>(
  profileId: string,
  game: string,
): Promise<StoredPvpMatch<TState> | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryActiveFor(profileId, game);
    return found ? (clone(found) as StoredPvpMatch<TState>) : null;
  }

  const { data, error } = await supabase
    .from("pvp_matches")
    .select(MATCH_COLUMNS)
    .eq("game", game)
    .eq("status", "active")
    .or(`player0_id.eq.${profileId},player1_id.eq.${profileId}`)
    .maybeSingle();
  if (error) throw new Error(`Could not load the ${game} match: ${error.message}`);
  return data ? fromRow<TState>(data as MatchRow) : null;
}

/**
 * A match by id, live or finished, whoever it belongs to.
 *
 * Authorization is the caller's: this returns anyone's match, and the service
 * is what checks the reader is one of the two players before redacting. Kept
 * that way so the settled-match read (a result card, a rematch offer) does not
 * need a second function with the same body.
 */
export async function getPvpMatchById<TState>(id: string): Promise<StoredPvpMatch<TState> | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryMatches.get(id);
    return found ? (clone(found) as StoredPvpMatch<TState>) : null;
  }

  const { data, error } = await supabase
    .from("pvp_matches")
    .select(MATCH_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load that match: ${error.message}`);
  return data ? fromRow<TState>(data as MatchRow) : null;
}

/**
 * Opens a match. Throws ActivePvpMatchExists when either player already has one.
 *
 * Caught from the two partial unique indexes (23505) rather than by reading
 * first and then inserting: two concurrent accepts of two different challenges
 * both pass a read-first check, and by the time they get here each has already
 * debited an ante.
 */
export async function createPvpMatch<TState>(input: {
  game: string;
  players: [string, string];
  tier: string;
  stake: number;
  state: TState;
}): Promise<StoredPvpMatch<TState>> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    for (const player of input.players) {
      if (memoryActiveFor(player, input.game)) throw new ActivePvpMatchExists(input.game);
    }
    const match: StoredPvpMatch<TState> = {
      id: randomUUID(),
      game: input.game,
      players: input.players,
      tier: input.tier,
      stake: input.stake,
      status: "active",
      winnerSeat: null,
      version: 1,
      state: input.state,
      createdAt: now,
      settledAt: null,
    };
    memoryMatches.set(match.id, clone(match) as StoredPvpMatch);
    return clone(match);
  }

  const { data, error } = await supabase
    .from("pvp_matches")
    .insert({
      game: input.game,
      player0_id: input.players[0],
      player1_id: input.players[1],
      tier: input.tier,
      stake: input.stake,
      status: "active",
      version: 1,
      state: input.state,
    })
    .select(MATCH_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new ActivePvpMatchExists(input.game);
    throw new Error(`Could not open the ${input.game} match: ${error.message}`);
  }
  return fromRow<TState>(data as MatchRow);
}

/**
 * Writes the next state, but only if nobody else already did.
 *
 * Returns null on a lost race -- a stale version, a replayed request, both
 * players' clients settling the same match in the same instant. The caller
 * must treat null as "this did not happen" and, critically, must not pay out
 * on it: only one UPDATE can match a given version, so this guard is the
 * entire reason a pot is credited exactly once.
 *
 * `winnerSeat` is only meaningful when settling. A settled write with a null
 * winner is a DRAW, which is why the two are passed together rather than the
 * winner being inferred from the state -- the store must not have to know how
 * to read a game.
 */
export async function advancePvpMatch<TState>(
  current: StoredPvpMatch<TState>,
  next: TState,
  settle: { winnerSeat: DuelSeat | null } | null,
): Promise<StoredPvpMatch<TState> | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const now = new Date().toISOString();
  const status: PvpMatchStatus = settle ? "settled" : "active";

  if (!supabase) {
    const stored = memoryMatches.get(current.id);
    // The same three conditions the WHERE clause below tests, in order: the
    // row exists, it is still live, and it is at the version acted on.
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredPvpMatch<TState> = {
      ...(stored as StoredPvpMatch<TState>),
      version,
      status,
      state: next,
      winnerSeat: settle ? settle.winnerSeat : null,
      settledAt: settle ? now : null,
    };
    memoryMatches.set(current.id, clone(updated) as StoredPvpMatch);
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("pvp_matches")
    .update({
      version,
      status,
      state: next,
      winner_seat: settle ? settle.winnerSeat : null,
      settled_at: settle ? now : null,
      updated_at: now,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(MATCH_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not save that match: ${error.message}`);
  return data ? fromRow<TState>(data as MatchRow) : null;
}

// ---- head-to-head record -----------------------------------------------

/** One player's record against one opponent, across every duel game combined. */
export interface DuelRecord {
  wins: number;
  losses: number;
  draws: number;
}

/**
 * How many recent settled matches feed a head-to-head record, on each side of
 * the player/opponent pair.
 *
 * A bound rather than every row ever played, matching FRIENDS_PAGE_SIZE's
 * philosophy elsewhere in this app: the record is a badge in a friends list,
 * not an archive, and an unbounded scan over years of matches would cost more
 * than the number is worth.
 */
export const DUEL_RECORD_MATCH_LIMIT = 500;

/**
 * A player's record against every opponent they have settled a duel with,
 * derived from pvp_matches rather than a maintained counter -- see the doc
 * comment on the migration that indexes this.
 *
 * `opponentIds`, when given, narrows both queries to that set (the friends
 * drawer's only caller passes its own friend list) -- without it, a player
 * who has duelled far more strangers than friends pays for a scan-and-discard
 * over rows nobody reads, and a real friend's older matches could fall outside
 * DUEL_RECORD_MATCH_LIMIT because unrelated stranger duels crowded them out.
 *
 * Two queries, not one `or()`, for the same reason getFriendsOverview's
 * asA/asB split is two queries: each one uses its own partial index
 * (pvp_matches_player0_settled_idx / _player1_settled_idx), where a single
 * `or()` would leave the planner no good index to pick.
 */
export async function getDuelRecordsAgainst(
  profileId: string,
  opponentIds?: string[],
): Promise<Map<string, DuelRecord>> {
  const records = new Map<string, DuelRecord>();
  const tally = (opponentId: string, outcome: "win" | "loss" | "draw") => {
    const current = records.get(opponentId) ?? { wins: 0, losses: 0, draws: 0 };
    if (outcome === "win") current.wins += 1;
    else if (outcome === "loss") current.losses += 1;
    else current.draws += 1;
    records.set(opponentId, current);
  };
  // An empty filter means "nobody to look up", not "everybody" -- return
  // early rather than let `.in("...", [])` reach Postgres.
  if (opponentIds && opponentIds.length === 0) return records;
  const wanted = opponentIds ? new Set(opponentIds) : null;

  const supabase = adminClient();
  if (!supabase) {
    const mine = [...memoryMatches.values()]
      .filter((match) => match.status === "settled" && (match.players[0] === profileId || match.players[1] === profileId))
      .sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""))
      .slice(0, DUEL_RECORD_MATCH_LIMIT);
    for (const match of mine) {
      const seat = match.players[0] === profileId ? 0 : 1;
      const opponentId = match.players[seat === 0 ? 1 : 0];
      if (wanted && !wanted.has(opponentId)) continue;
      const outcome = match.winnerSeat === null ? "draw" : match.winnerSeat === seat ? "win" : "loss";
      tally(opponentId, outcome);
    }
    return records;
  }

  const [asPlayer0, asPlayer1] = await Promise.all([
    (() => {
      let query = supabase
        .from("pvp_matches")
        .select("player1_id, winner_seat")
        .eq("player0_id", profileId)
        .eq("status", "settled");
      if (opponentIds) query = query.in("player1_id", opponentIds);
      return query.order("settled_at", { ascending: false }).limit(DUEL_RECORD_MATCH_LIMIT);
    })(),
    (() => {
      let query = supabase
        .from("pvp_matches")
        .select("player0_id, winner_seat")
        .eq("player1_id", profileId)
        .eq("status", "settled");
      if (opponentIds) query = query.in("player0_id", opponentIds);
      return query.order("settled_at", { ascending: false }).limit(DUEL_RECORD_MATCH_LIMIT);
    })(),
  ]);
  if (asPlayer0.error) throw new Error(`Could not load duel record: ${asPlayer0.error.message}`);
  if (asPlayer1.error) throw new Error(`Could not load duel record: ${asPlayer1.error.message}`);

  for (const row of asPlayer0.data ?? []) {
    const winnerSeat = row.winner_seat === null ? null : Number(row.winner_seat);
    tally(String(row.player1_id), winnerSeat === null ? "draw" : winnerSeat === 0 ? "win" : "loss");
  }
  for (const row of asPlayer1.data ?? []) {
    const winnerSeat = row.winner_seat === null ? null : Number(row.winner_seat);
    tally(String(row.player0_id), winnerSeat === null ? "draw" : winnerSeat === 1 ? "win" : "loss");
  }
  return records;
}
