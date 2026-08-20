import "server-only";
import { LEADERBOARD_GAMES, leaderboardGame, type LeaderboardStats } from "@/lib/leaderboard/contract";
import { getPublicProfilesByIds } from "./profile-store";
import { __memoryPlayerStatsForGlobalBlend } from "./stats-store";
import { adminClient } from "./supabase-admin";

/**
 * Per-game leaderboard stats for every game besides poker, plus the Global
 * leaderboard that blends poker in alongside them.
 *
 * Poker itself is never written here -- player_stats/season_stats
 * (stats-store.ts) stay the source of truth for poker, proven and already
 * idempotent. This module only ever reads poker's numbers, as one more score
 * source for the Global blend (see getGlobalLeaderboard).
 *
 * Same twin-branch shape as every other store here: a real deployment writes
 * through apply_leaderboard_result and reads through the SQL functions in
 * supabase/migrations/20260820120000_game_leaderboard_stats.sql; local/dev/
 * test runs against an in-process approximation of the same math.
 *
 * The three record* functions below never throw -- the same contract
 * applyMissionEvent and applyAchievementEvent keep, called as a sibling of
 * those two at each settlement call site rather than through a shared
 * DomainEvent (see lib/domain-events.ts's own header for why the union stays
 * minimal: this module needs a loser id, every cribbage seat, and a raw
 * metric, payload the mission/achievement consumers don't want).
 */

export interface LeaderboardEntry {
  profileId: string;
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  accent: string;
  stats: LeaderboardStats;
  cells: Record<string, string>;
}

export interface GlobalLeaderboardEntry {
  profileId: string;
  rank: number;
  displayName: string;
  avatarUrl: string | null;
  accent: string;
  globalScore: number;
  gamesCounted: number;
}

const emptyStats = (): LeaderboardStats => ({
  wins: 0, losses: 0, draws: 0, metricSum: 0, metricCount: 0, currentStreak: 0, bestStreak: 0,
});

// ---- memory-mode mirror ----------------------------------------------------
//
// Same twin-branch shape as every other store here. globalThis, not module
// scope, so it survives Next.js's dev-mode module reloads.

declare global {
  var __riverRoomLeaderboardStats: Map<string, LeaderboardStats> | undefined;
}

const memoryStats = globalThis.__riverRoomLeaderboardStats ?? new Map<string, LeaderboardStats>();
globalThis.__riverRoomLeaderboardStats = memoryStats;

function statsKey(profileId: string, gameId: string): string {
  return `${profileId}:${gameId}`;
}

/** Test-only reset. */
export function __resetLeaderboardMemory(): void {
  memoryStats.clear();
}

function applyMemory(
  profileId: string,
  gameId: string,
  outcome: { win: boolean; loss: boolean; draw: boolean },
  metricDelta: number,
  metricCountDelta: number,
): void {
  const key = statsKey(profileId, gameId);
  const current = memoryStats.get(key) ?? emptyStats();
  const nextStreak = outcome.win
    ? Math.max(current.currentStreak, 0) + 1
    : outcome.loss
      ? Math.min(current.currentStreak, 0) - 1
      : outcome.draw
        ? 0
        : current.currentStreak;
  memoryStats.set(key, {
    wins: current.wins + (outcome.win ? 1 : 0),
    losses: current.losses + (outcome.loss ? 1 : 0),
    draws: current.draws + (outcome.draw ? 1 : 0),
    metricSum: current.metricSum + metricDelta,
    metricCount: current.metricCount + metricCountDelta,
    currentStreak: nextStreak,
    bestStreak: outcome.win ? Math.max(current.bestStreak, nextStreak) : current.bestStreak,
  });
}

async function applyResult(
  profileId: string,
  gameId: string,
  outcome: { win: boolean; loss: boolean; draw: boolean },
  metricDelta = 0,
  metricCountDelta = 0,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    applyMemory(profileId, gameId, outcome, metricDelta, metricCountDelta);
    return;
  }
  const { error } = await supabase.rpc("apply_leaderboard_result", {
    p_profile_id: profileId,
    p_game_id: gameId,
    p_win: outcome.win,
    p_loss: outcome.loss,
    p_draw: outcome.draw,
    p_metric_delta: metricDelta,
    p_metric_count_delta: metricCountDelta,
  });
  if (error) throw new Error(`Could not record ${gameId} leaderboard result: ${error.message}`);
}

// ---- writes -----------------------------------------------------------

/** A 2-player duel's result. `winnerSeat` null is a draw -- both players get one. Never throws. */
export async function recordDuelResult(
  gameId: string,
  players: [string, string],
  winnerSeat: 0 | 1 | null,
): Promise<void> {
  try {
    if (winnerSeat === null) {
      await Promise.all([
        applyResult(players[0], gameId, { win: false, loss: false, draw: true }),
        applyResult(players[1], gameId, { win: false, loss: false, draw: true }),
      ]);
      return;
    }
    const winnerId = players[winnerSeat];
    const loserId = players[winnerSeat === 0 ? 1 : 0];
    await Promise.all([
      applyResult(winnerId, gameId, { win: true, loss: false, draw: false }),
      applyResult(loserId, gameId, { win: false, loss: true, draw: false }),
    ]);
  } catch (error) {
    console.error("leaderboard.record_duel_result_failed", { gameId, players, winnerSeat, error });
  }
}

/** An N-player table's result (cribbage): the winner gets a win, everyone else a loss. Never throws. */
export async function recordMultiWayResult(
  gameId: string,
  participantIds: string[],
  winnerId: string,
): Promise<void> {
  try {
    await Promise.all(
      participantIds.map((profileId) =>
        applyResult(profileId, gameId, {
          win: profileId === winnerId,
          loss: profileId !== winnerId,
          draw: false,
        }),
      ),
    );
  } catch (error) {
    console.error("leaderboard.record_multi_way_result_failed", { gameId, participantIds, winnerId, error });
  }
}

/** A metric-only result (Memory Match's turn count). No win/loss/draw. Never throws. */
export async function recordMetricResult(gameId: string, profileId: string, metricDelta: number): Promise<void> {
  try {
    await applyResult(profileId, gameId, { win: false, loss: false, draw: false }, metricDelta, 1);
  } catch (error) {
    console.error("leaderboard.record_metric_result_failed", { gameId, profileId, metricDelta, error });
  }
}

// ---- per-game reads -----------------------------------------------------

interface ScoredRow {
  profileId: string;
  stats: LeaderboardStats;
  score: number;
}

function qualifies(gameId: string, stats: LeaderboardStats): boolean {
  const contract = leaderboardGame(gameId);
  if (!contract) return false;
  const sample = contract.kind === "average_metric" ? stats.metricCount : stats.wins + stats.losses + stats.draws;
  return sample >= contract.minSample;
}

function scoreOf(gameId: string, stats: LeaderboardStats): number {
  const contract = leaderboardGame(gameId);
  if (!contract) return 0;
  if (contract.kind === "average_metric") {
    return stats.metricCount > 0 ? stats.metricSum / stats.metricCount : 0;
  }
  const total = stats.wins + stats.losses + stats.draws;
  return total > 0 ? stats.wins / total : 0;
}

/** Best score first: direction-aware, so a lower_better game (Memory Match) sorts ascending. */
function sortDescendingByGoodness(gameId: string, rows: ScoredRow[]): ScoredRow[] {
  const contract = leaderboardGame(gameId);
  const ascending = contract?.direction === "lower_better";
  return [...rows].sort((a, b) => (ascending ? a.score - b.score : b.score - a.score));
}

async function allGameRows(gameId: string): Promise<ScoredRow[]> {
  const supabase = adminClient();
  let rows: { profileId: string; stats: LeaderboardStats }[];

  if (!supabase) {
    rows = [...memoryStats.entries()]
      .filter(([key]) => key.endsWith(`:${gameId}`))
      .map(([key, stats]) => ({ profileId: key.slice(0, key.length - gameId.length - 1), stats }));
  } else {
    const { data, error } = await supabase
      .from("game_leaderboard_stats")
      .select("profile_id, wins, losses, draws, metric_sum, metric_count, current_streak, best_streak")
      .eq("game_id", gameId);
    if (error) throw new Error(`Could not load the ${gameId} leaderboard: ${error.message}`);
    rows = (data ?? []).map((row) => ({
      profileId: String(row.profile_id),
      stats: {
        wins: Number(row.wins),
        losses: Number(row.losses),
        draws: Number(row.draws),
        metricSum: Number(row.metric_sum),
        metricCount: Number(row.metric_count),
        currentStreak: Number(row.current_streak),
        bestStreak: Number(row.best_streak),
      },
    }));
  }

  return rows
    .filter((row) => qualifies(gameId, row.stats))
    .map((row) => ({ ...row, score: scoreOf(gameId, row.stats) }));
}

async function decorateGameRows(gameId: string, rows: ScoredRow[]): Promise<LeaderboardEntry[]> {
  const contract = leaderboardGame(gameId);
  if (!contract) return [];
  const profiles = await getPublicProfilesByIds(rows.map((row) => row.profileId));
  return rows.map((row, index) => {
    const profile = profiles.get(row.profileId);
    return {
      profileId: row.profileId,
      rank: index + 1,
      displayName: profile?.displayName ?? "Player",
      avatarUrl: profile?.avatarUrl ?? null,
      accent: profile?.accent ?? "#e7c66a",
      stats: row.stats,
      cells: contract.formatRow(row.stats),
    };
  });
}

/** Top `limit` for one game, qualifying players only. Empty for an unknown game id. */
export async function getGameLeaderboard(gameId: string, limit = 10): Promise<LeaderboardEntry[]> {
  if (!leaderboardGame(gameId)) return [];
  const sorted = sortDescendingByGoodness(gameId, await allGameRows(gameId));
  return decorateGameRows(gameId, sorted.slice(0, limit));
}

/** One profile's own standing in one game, even outside the top of the board. Null if they haven't qualified yet. */
export async function getGameStanding(
  gameId: string,
  profileId: string,
): Promise<LeaderboardEntry | null> {
  if (!leaderboardGame(gameId)) return null;
  const sorted = sortDescendingByGoodness(gameId, await allGameRows(gameId));
  const index = sorted.findIndex((row) => row.profileId === profileId);
  if (index === -1) return null;
  const [decorated] = await decorateGameRows(gameId, [sorted[index]]);
  return decorated ? { ...decorated, rank: index + 1 } : null;
}

// ---- global read --------------------------------------------------------
//
// A read-time percentile blend, not a stored column -- a denormalized
// "global score" would need recomputing on every OTHER player's write in
// the same game, since percentiles shift even when you didn't play
// yourself. See the migration's own comment for the full reasoning. The
// memory branch below reimplements Postgres's percent_rank() exactly:
// (rank - 1) / (n - 1), RANK()-style ties, 0 for a lone qualifier.

/** Minimum poker hands played before a player's poker score counts toward the Global blend. */
const POKER_MIN_HANDS = 20;

interface PooledScore {
  profileId: string;
  gameId: string;
  score: number;
  higherBetter: boolean;
}

function percentileMap(rows: PooledScore[]): Map<string, number> {
  const n = rows.length;
  const result = new Map<string, number>();
  if (n === 0) return result;
  if (n === 1) {
    result.set(rows[0].profileId, 0);
    return result;
  }
  const higherBetter = rows[0].higherBetter;
  // higher_better: percent_rank() over (order by score asc) -- the best
  // score sorts last and earns the top percentile. lower_better inverts.
  const sorted = [...rows].sort((a, b) => (higherBetter ? a.score - b.score : b.score - a.score));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && sorted[j].score === sorted[i].score) j += 1;
    const percentile = i / (n - 1);
    for (let k = i; k < j; k += 1) result.set(sorted[k].profileId, percentile);
    i = j;
  }
  return result;
}

async function memoryPooledScores(): Promise<PooledScore[]> {
  const pooled: PooledScore[] = [];

  for (const row of __memoryPlayerStatsForGlobalBlend(POKER_MIN_HANDS)) {
    pooled.push({ profileId: row.profileId, gameId: "poker", score: row.totalChipsWon, higherBetter: true });
  }

  for (const [key, stats] of memoryStats) {
    const separatorIndex = key.lastIndexOf(":");
    const profileId = key.slice(0, separatorIndex);
    const gameId = key.slice(separatorIndex + 1);
    if (!qualifies(gameId, stats)) continue;
    const contract = leaderboardGame(gameId);
    if (!contract) continue;
    pooled.push({
      profileId,
      gameId,
      score: scoreOf(gameId, stats),
      higherBetter: contract.direction === "higher_better",
    });
  }

  return pooled;
}

async function globalScores(): Promise<Map<string, { score: number; gamesCounted: number }>> {
  const supabase = adminClient();
  const byProfile = new Map<string, number[]>();

  if (!supabase) {
    const pooled = await memoryPooledScores();
    // Percentiles are computed per game (one partition per gameId), then
    // averaged per profile -- exactly get_global_leaderboard()'s two-step
    // shape, just done in JS instead of SQL.
    const byGame = new Map<string, PooledScore[]>();
    for (const row of pooled) {
      const list = byGame.get(row.gameId) ?? [];
      list.push(row);
      byGame.set(row.gameId, list);
    }
    for (const rows of byGame.values()) {
      const percentiles = percentileMap(rows);
      for (const [profileId, percentile] of percentiles) {
        const list = byProfile.get(profileId) ?? [];
        list.push(percentile);
        byProfile.set(profileId, list);
      }
    }
  } else {
    const { data, error } = await supabase.rpc("get_global_leaderboard");
    if (error) throw new Error(`Could not load the global leaderboard: ${error.message}`);
    const result = new Map<string, { score: number; gamesCounted: number }>();
    for (const row of (data ?? []) as { profile_id: string; global_score: number; games_counted: number }[]) {
      result.set(String(row.profile_id), { score: Number(row.global_score), gamesCounted: Number(row.games_counted) });
    }
    return result;
  }

  const result = new Map<string, { score: number; gamesCounted: number }>();
  for (const [profileId, percentiles] of byProfile) {
    const score = percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length;
    result.set(profileId, { score, gamesCounted: percentiles.length });
  }
  return result;
}

async function decorateGlobalRows(
  rows: { profileId: string; score: number; gamesCounted: number }[],
): Promise<GlobalLeaderboardEntry[]> {
  const profiles = await getPublicProfilesByIds(rows.map((row) => row.profileId));
  return rows.map((row, index) => {
    const profile = profiles.get(row.profileId);
    return {
      profileId: row.profileId,
      rank: index + 1,
      displayName: profile?.displayName ?? "Player",
      avatarUrl: profile?.avatarUrl ?? null,
      accent: profile?.accent ?? "#e7c66a",
      globalScore: row.score,
      gamesCounted: row.gamesCounted,
    };
  });
}

/** Top `limit` by the Global blend across every game a player qualifies in. */
export async function getGlobalLeaderboard(limit = 10): Promise<GlobalLeaderboardEntry[]> {
  const scores = await globalScores();
  const sorted = [...scores.entries()]
    .map(([profileId, entry]) => ({ profileId, score: entry.score, gamesCounted: entry.gamesCounted }))
    .sort((a, b) => b.score - a.score);
  return decorateGlobalRows(sorted.slice(0, limit));
}

/** One profile's own Global standing, even outside the top of the board. Null if they qualify in no game yet. */
export async function getGlobalStanding(profileId: string): Promise<GlobalLeaderboardEntry | null> {
  const scores = await globalScores();
  const mine = scores.get(profileId);
  if (!mine) return null;
  const rank = 1 + [...scores.values()].filter((entry) => entry.score > mine.score).length;
  const [decorated] = await decorateGlobalRows([{ profileId, score: mine.score, gamesCounted: mine.gamesCounted }]);
  return decorated ? { ...decorated, rank } : null;
}

export { LEADERBOARD_GAMES };
