import "server-only";
import { isHeadToHeadGame, leaderboardGame } from "@/lib/leaderboard/contract";
import { adminClient } from "./supabase-admin";

/**
 * Your record against one specific person, per game.
 *
 * The rest of the leaderboard answers "how do I rank against everyone"; this
 * answers "how do I do against her", which is a different question and the
 * only one a friends board can be built from. See
 * supabase/migrations/20260820140000_head_to_head_records.sql for the row
 * shape and why the rows are stored mirrored (both directions), rather than
 * derived from the match history on every read.
 *
 * Poker never appears here and neither does Memory Match: a pot at a
 * six-handed table is not a result between two named players, and an
 * average-metric game has no opponent at all. Membership is decided by the
 * game's own leaderboard contract (kind === "win_loss_record"), so a future
 * duel joins this board on the same one-registry-entry terms it joins the
 * leaderboard on.
 *
 * The record* writers never throw -- same contract as applyMissionEvent,
 * applyAchievementEvent and the leaderboard's own writers. A settlement that
 * moved real Gold must not be reported as failed because a stats row didn't
 * update.
 */

export interface HeadToHeadRecord {
  wins: number;
  losses: number;
  draws: number;
  /** Positive is an active win streak against this opponent, negative a losing one. */
  currentStreak: number;
  bestStreak: number;
}

/** One opponent's totals, plus the per-game split behind them. */
export interface HeadToHeadSummary extends HeadToHeadRecord {
  opponentId: string;
  /** Only games the two have actually finished together, most played first. */
  games: (HeadToHeadRecord & { gameId: string; label: string })[];
}

type Outcome = "win" | "loss" | "draw";

const emptyRecord = (): HeadToHeadRecord => ({
  wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0,
});

function inverse(outcome: Outcome): Outcome {
  return outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw";
}

// ---- memory-mode mirror ----------------------------------------------------
//
// Same twin-branch shape as leaderboard-store.ts. globalThis, not module
// scope, so it survives Next.js's dev-mode module reloads.

declare global {
  var __riverRoomHeadToHead: Map<string, HeadToHeadRecord> | undefined;
}

const memoryRecords = globalThis.__riverRoomHeadToHead ?? new Map<string, HeadToHeadRecord>();
globalThis.__riverRoomHeadToHead = memoryRecords;

function recordKey(profileId: string, opponentId: string, gameId: string): string {
  return `${profileId}|${opponentId}|${gameId}`;
}

/** Test-only reset. The mirror is process-global, so suites must clear it. */
export function __resetHeadToHeadMemory(): void {
  memoryRecords.clear();
}

function applyMemory(profileId: string, opponentId: string, gameId: string, outcome: Outcome): void {
  const key = recordKey(profileId, opponentId, gameId);
  const current = memoryRecords.get(key) ?? emptyRecord();
  const nextStreak = outcome === "win"
    ? Math.max(current.currentStreak, 0) + 1
    : outcome === "loss"
      ? Math.min(current.currentStreak, 0) - 1
      : 0;
  memoryRecords.set(key, {
    wins: current.wins + (outcome === "win" ? 1 : 0),
    losses: current.losses + (outcome === "loss" ? 1 : 0),
    draws: current.draws + (outcome === "draw" ? 1 : 0),
    currentStreak: nextStreak,
    bestStreak: outcome === "win" ? Math.max(current.bestStreak, nextStreak) : current.bestStreak,
  });
}

/**
 * One result between two players, written to both their rows.
 *
 * `outcome` is from `profileId`'s side. The mirrored row is the RPC's job in
 * a real deployment (one statement, so the pair cannot half-land); the
 * memory branch writes both here for the same reason.
 */
async function applyResult(
  profileId: string,
  opponentId: string,
  gameId: string,
  outcome: Outcome,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    applyMemory(profileId, opponentId, gameId, outcome);
    applyMemory(opponentId, profileId, gameId, inverse(outcome));
    return;
  }
  const { error } = await supabase.rpc("apply_head_to_head_result", {
    p_profile_id: profileId,
    p_opponent_id: opponentId,
    p_game_id: gameId,
    p_outcome: outcome,
  });
  if (error) throw new Error(`Could not record the ${gameId} head-to-head result: ${error.message}`);
}

// ---- writes -----------------------------------------------------------

/**
 * A 2-player duel. `winnerSeat` null is a draw.
 *
 * Called from leaderboard-store's recordDuelResult rather than from the duel
 * service directly: one settled match is one event, and giving it two
 * separate call sites is how the world board and the friends board drift
 * apart. Never throws.
 */
export async function recordHeadToHeadDuel(
  gameId: string,
  players: [string, string],
  winnerSeat: 0 | 1 | null,
): Promise<void> {
  if (!isHeadToHeadGame(gameId)) return;
  if (players[0] === players[1]) return;
  try {
    await applyResult(
      players[0],
      players[1],
      gameId,
      winnerSeat === null ? "draw" : winnerSeat === 0 ? "win" : "loss",
    );
  } catch (error) {
    console.error("head_to_head.record_duel_failed", { gameId, players, winnerSeat, error });
  }
}

/**
 * An N-player table (cribbage): the winner beats every other seat.
 *
 * Two players who both lost get nothing against each other -- neither beat
 * the other, and recording a loss on both sides would leave A holding a loss
 * against B while B holds one against A, which is the one thing the mirrored
 * rows must never say. Never throws.
 */
export async function recordHeadToHeadTable(
  gameId: string,
  participantIds: string[],
  winnerId: string,
): Promise<void> {
  if (!isHeadToHeadGame(gameId)) return;
  const opponents = [...new Set(participantIds)].filter((id) => id !== winnerId);
  if (opponents.length === 0) return;
  try {
    for (const opponentId of opponents) {
      await applyResult(winnerId, opponentId, gameId, "win");
    }
  } catch (error) {
    console.error("head_to_head.record_table_failed", { gameId, participantIds, winnerId, error });
  }
}

// ---- reads --------------------------------------------------------------

interface StoredRow {
  opponentId: string;
  gameId: string;
  record: HeadToHeadRecord;
}

async function rowsFor(profileId: string, opponentIds: string[]): Promise<StoredRow[]> {
  // An empty opponent list means "nobody to look up", not "everybody" --
  // return before `.in("...", [])` ever reaches Postgres.
  if (opponentIds.length === 0) return [];
  const wanted = new Set(opponentIds);

  const supabase = adminClient();
  if (!supabase) {
    const rows: StoredRow[] = [];
    for (const [key, record] of memoryRecords) {
      const [owner, opponentId, gameId] = key.split("|");
      if (owner !== profileId || !wanted.has(opponentId)) continue;
      rows.push({ opponentId, gameId, record });
    }
    return rows;
  }

  const { data, error } = await supabase
    .from("head_to_head_records")
    .select("opponent_id, game_id, wins, losses, draws, current_streak, best_streak")
    .eq("profile_id", profileId)
    .in("opponent_id", opponentIds);
  if (error) throw new Error(`Could not load your head-to-head records: ${error.message}`);
  return (data ?? []).map((row) => ({
    opponentId: String(row.opponent_id),
    gameId: String(row.game_id),
    record: {
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
      currentStreak: Number(row.current_streak),
      bestStreak: Number(row.best_streak),
    },
  }));
}

function played(record: HeadToHeadRecord): number {
  return record.wins + record.losses + record.draws;
}

/**
 * The caller's record against each of `opponentIds`, totalled across games
 * and split per game.
 *
 * Opponents with no shared history are simply absent from the map -- a
 * friend you have never played is not an 0-0 record, it is no record. The
 * friends board fills that in as "No games yet"; the drawer's badge just
 * doesn't draw.
 *
 * The overall `currentStreak` is deliberately NOT the sum or the max of the
 * per-game streaks: "you have lost 5 straight to her" has to mean five
 * results in a row across whatever you played, and that ordering is not
 * recoverable from per-game counters. It is only reported when a single game
 * accounts for every result the two of you have -- otherwise it is 0 and the
 * per-game rows carry the streaks, which is the honest answer rather than a
 * plausible-looking wrong one.
 */
export async function getHeadToHeadSummaries(
  profileId: string,
  opponentIds: string[],
): Promise<Map<string, HeadToHeadSummary>> {
  const summaries = new Map<string, HeadToHeadSummary>();
  const rows = await rowsFor(profileId, opponentIds);

  for (const row of rows) {
    const contract = leaderboardGame(row.gameId);
    if (!contract || played(row.record) === 0) continue;
    const summary = summaries.get(row.opponentId) ?? {
      opponentId: row.opponentId,
      ...emptyRecord(),
      games: [],
    };
    summary.wins += row.record.wins;
    summary.losses += row.record.losses;
    summary.draws += row.record.draws;
    summary.bestStreak = Math.max(summary.bestStreak, row.record.bestStreak);
    summary.games.push({ ...row.record, gameId: row.gameId, label: contract.label });
    summaries.set(row.opponentId, summary);
  }

  for (const summary of summaries.values()) {
    summary.games.sort((a, b) => played(b) - played(a) || a.label.localeCompare(b.label));
    summary.currentStreak = summary.games.length === 1 ? summary.games[0].currentStreak : 0;
  }
  return summaries;
}

/** Totals only, flattened for callers that show a badge rather than a board (the friends drawer). */
export async function getHeadToHeadRecords(
  profileId: string,
  opponentIds: string[],
): Promise<Map<string, HeadToHeadRecord>> {
  const summaries = await getHeadToHeadSummaries(profileId, opponentIds);
  return new Map(
    [...summaries].map(([opponentId, summary]) => [opponentId, {
      wins: summary.wins,
      losses: summary.losses,
      draws: summary.draws,
      currentStreak: summary.currentStreak,
      bestStreak: summary.bestStreak,
    }]),
  );
}
