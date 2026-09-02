import "server-only";
import { leaderboardGame, type LeaderboardStats } from "@/lib/leaderboard/contract";
import type { AvatarPreset } from "@/lib/profile/types";
import { DEFAULT_AVATAR_COSMETIC } from "@/lib/cosmetics/catalog";
import { listFriendIds } from "./friends-store";
import { getHeadToHeadSummaries, recordHeadToHeadDuel, recordHeadToHeadTable } from "./head-to-head-store";
import { getPublicProfilesByIds } from "./profile-store";
import { __memoryPlayerStatsForGlobalBlend } from "./stats-store";
import { adminClient } from "./supabase-admin";

/**
 * Per-game leaderboard stats for every game besides poker, plus the Global
 * leaderboard that blends poker in alongside them.
 *
 * Poker itself is never written here. player_stats/season_stats
 * (stats-store.ts) stay the source of truth for poker, proven and already
 * idempotent. This module only ever reads poker's numbers, as one more score
 * source for the Global blend (see getGlobalLeaderboard).
 *
 * Same twin-branch shape as every other store here: a real deployment writes
 * through apply_leaderboard_result and reads through the SQL functions in
 * supabase/migrations/20260820120000_game_leaderboard_stats.sql; local/dev/
 * test runs against an in-process approximation of the same math.
 *
 * The two record* functions below never throw, the same contract
 * applyMissionEvent and applyAchievementEvent keep, called as a sibling of
 * those two at each settlement call site rather than through a shared
 * DomainEvent (see lib/domain-events.ts's own header for why the union stays
 * minimal: this module needs a loser id and every cribbage seat, payload the
 * mission/achievement consumers don't want).
 *
 * Both of them fan the same result out to head-to-head-store.ts (the friends
 * board) from in here, rather than from a second call beside each
 * settlement. One settled match is one event, and two call sites is how the
 * world board and the friends board end up disagreeing about the same game.
 */

export interface LeaderboardEntry {
  profileId: string;
  rank: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  /** Equipped 2D seat-art character id, for a top-3 rank's real portrait on the board. */
  avatarCosmetic: string;
  accent: string;
  stats: LeaderboardStats;
  cells: Record<string, string>;
}

/**
 * One friend on the Friends board: your record against them, not theirs
 * against the world.
 *
 * The only board here whose rows differ per viewer, which is also why it has
 * no rank: there is no ordering of your friends that means anything the way
 * "#3 by Gold won" does. Sorted by how much you have actually played each
 * other instead.
 */
export interface FriendBoardEntry {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  accent: string;
  wins: number;
  losses: number;
  draws: number;
  /** Signed, and only meaningful when a single game accounts for every result. See getHeadToHeadSummaries. */
  currentStreak: number;
  bestStreak: number;
  /** Per game, most played first. Empty for a friend you have never finished a game against. */
  games: { gameId: string; label: string; wins: number; losses: number; draws: number; currentStreak: number }[];
}

export interface GlobalLeaderboardEntry {
  profileId: string;
  rank: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  /** Equipped 2D seat-art character id, for a top-3 rank's real portrait on the board. */
  avatarCosmetic: string;
  accent: string;
  globalScore: number;
  gamesCounted: number;
}

const emptyStats = (): LeaderboardStats => ({
  wins: 0, losses: 0, draws: 0, currentStreak: 0, bestStreak: 0,
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
    currentStreak: nextStreak,
    bestStreak: outcome.win ? Math.max(current.bestStreak, nextStreak) : current.bestStreak,
  });
}

async function applyResult(
  profileId: string,
  gameId: string,
  outcome: { win: boolean; loss: boolean; draw: boolean },
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    applyMemory(profileId, gameId, outcome);
    return;
  }
  // p_metric_delta/p_metric_count_delta are omitted, not passed as 0: the RPC
  // defaults both, and nothing ranks on a raw metric any more.
  const { error } = await supabase.rpc("apply_leaderboard_result", {
    p_profile_id: profileId,
    p_game_id: gameId,
    p_win: outcome.win,
    p_loss: outcome.loss,
    p_draw: outcome.draw,
  });
  if (error) throw new Error(`Could not record ${gameId} leaderboard result: ${error.message}`);
}

// ---- writes -----------------------------------------------------------

/** A 2-player duel's result, on both the world board and the two players' head-to-head record. `winnerSeat` null is a draw: both players get one. Never throws. */
export async function recordDuelResult(
  gameId: string,
  players: [string, string],
  winnerSeat: 0 | 1 | null,
): Promise<void> {
  try {
    if (winnerSeat === null) {
      // No early return here: a draw still has to reach the head-to-head
      // write below, which is the whole reason this branch is an if/else
      // rather than a guard clause.
      await Promise.all([
        applyResult(players[0], gameId, { win: false, loss: false, draw: true }),
        applyResult(players[1], gameId, { win: false, loss: false, draw: true }),
      ]);
    } else {
      const winnerId = players[winnerSeat];
      const loserId = players[winnerSeat === 0 ? 1 : 0];
      await Promise.all([
        applyResult(winnerId, gameId, { win: true, loss: false, draw: false }),
        applyResult(loserId, gameId, { win: false, loss: true, draw: false }),
      ]);
    }
  } catch (error) {
    console.error("leaderboard.record_duel_result_failed", { gameId, players, winnerSeat, error });
  }
  // Outside the try: this one keeps its own contract of never throwing, and
  // a world-board failure above must not swallow the friends board's copy
  // of the same result.
  await recordHeadToHeadDuel(gameId, players, winnerSeat);
}

/** An N-player table's result (cribbage): the winner gets a win, everyone else a loss, and the winner takes a head-to-head win off each of them. Never throws. */
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
  await recordHeadToHeadTable(gameId, participantIds, winnerId);
}

// ---- per-game reads -----------------------------------------------------

interface ScoredRow {
  profileId: string;
  stats: LeaderboardStats;
  score: number;
}

/** Decided games played, which is the sample every registered game qualifies on. */
function sampleOf(stats: LeaderboardStats): number {
  return stats.wins + stats.losses + stats.draws;
}

function qualifies(gameId: string, stats: LeaderboardStats): boolean {
  const contract = leaderboardGame(gameId);
  if (!contract) return false;
  return sampleOf(stats) >= contract.minSample;
}

function scoreOf(stats: LeaderboardStats): number {
  const total = sampleOf(stats);
  return total > 0 ? stats.wins / total : 0;
}

/** Best win rate first. */
function sortDescendingByGoodness(rows: ScoredRow[]): ScoredRow[] {
  return [...rows].sort((a, b) => b.score - a.score);
}

/** Every stored row for a game, qualified or not. allGameRows filters this; getGameQualifyProgress needs what it filters out. */
async function rawGameRows(gameId: string): Promise<{ profileId: string; stats: LeaderboardStats }[]> {
  const supabase = adminClient();

  if (!supabase) {
    return [...memoryStats.entries()]
      .filter(([key]) => key.endsWith(`:${gameId}`))
      .map(([key, stats]) => ({ profileId: key.slice(0, key.length - gameId.length - 1), stats }));
  }

  const { data, error } = await supabase
    .from("game_leaderboard_stats")
    .select("profile_id, wins, losses, draws, current_streak, best_streak")
    .eq("game_id", gameId);
  if (error) throw new Error(`Could not load the ${gameId} leaderboard: ${error.message}`);
  return (data ?? []).map((row) => ({
    profileId: String(row.profile_id),
    stats: {
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
      currentStreak: Number(row.current_streak),
      bestStreak: Number(row.best_streak),
    },
  }));
}

/** Qualifying rows only, scored. Pure so getGameBoard can share it against an already-fetched raw list rather than re-fetching. */
function scoredRows(gameId: string, rows: { profileId: string; stats: LeaderboardStats }[]): ScoredRow[] {
  return rows.filter((row) => qualifies(gameId, row.stats)).map((row) => ({ ...row, score: scoreOf(row.stats) }));
}

async function allGameRows(gameId: string): Promise<ScoredRow[]> {
  return scoredRows(gameId, await rawGameRows(gameId));
}

/**
 * Attaches rank and public-profile identity (name, avatar, accent, with the
 * same "Player" / null / gold fallbacks every board uses) to an already-
 * sorted row list. Shared by decorateGameRows and decorateGlobalRows, so the
 * two can't drift on the fallback values by building the same shape twice.
 */
type RankedIdentity = {
  profileId: string;
  rank: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset;
  avatarCosmetic: string;
  accent: string;
};

async function decorateRankedRows<Row extends { profileId: string }, Extra>(
  rows: Row[],
  extra: (row: Row) => Extra,
): Promise<(RankedIdentity & Extra)[]> {
  const profiles = await getPublicProfilesByIds(rows.map((row) => row.profileId));
  return rows.map((row, index) => {
    const profile = profiles.get(row.profileId);
    return {
      profileId: row.profileId,
      rank: index + 1,
      displayName: profile?.displayName ?? "Player",
      initials: profile?.initials ?? "??",
      avatarUrl: profile?.avatarUrl ?? null,
      avatarPreset: profile?.avatarPreset ?? "ace",
      avatarCosmetic: profile?.avatarCosmetic ?? DEFAULT_AVATAR_COSMETIC,
      accent: profile?.accent ?? "#e7c66a",
      ...extra(row),
    };
  });
}

async function decorateGameRows(gameId: string, rows: ScoredRow[]): Promise<LeaderboardEntry[]> {
  const contract = leaderboardGame(gameId);
  if (!contract) return [];
  return decorateRankedRows(rows, (row) => ({ stats: row.stats, cells: contract.formatRow(row.stats) }));
}

/** Top `limit` for one game, qualifying players only. Empty for an unknown game id. */
export async function getGameLeaderboard(gameId: string, limit = 10): Promise<LeaderboardEntry[]> {
  if (!leaderboardGame(gameId)) return [];
  const sorted = sortDescendingByGoodness(await allGameRows(gameId));
  return decorateGameRows(gameId, sorted.slice(0, limit));
}

/** One profile's own standing in one game, even outside the top of the board. Null if they haven't qualified yet. */
export async function getGameStanding(
  gameId: string,
  profileId: string,
): Promise<LeaderboardEntry | null> {
  if (!leaderboardGame(gameId)) return null;
  const sorted = sortDescendingByGoodness(await allGameRows(gameId));
  const index = sorted.findIndex((row) => row.profileId === profileId);
  if (index === -1) return null;
  const [decorated] = await decorateGameRows(gameId, [sorted[index]]);
  return decorated ? { ...decorated, rank: index + 1 } : null;
}

export interface LeaderboardQualifyProgress {
  /** Games recorded so far toward this game's qualifying sample. */
  sample: number;
  /** The sample size needed before a player appears on the board at all. */
  minSample: number;
}

/**
 * How close a not-yet-qualified player is to appearing on their own game's
 * board. getGameStanding returns a flat null for them, which reads to a
 * player who just played their first match as "you don't exist here,"
 * indistinguishable from having never played. Null here too, but only when
 * there is truly nothing to report: unknown game, zero games played, or
 * already past the threshold (getGameStanding is the answer at that point).
 */
export async function getGameQualifyProgress(
  gameId: string,
  profileId: string,
): Promise<LeaderboardQualifyProgress | null> {
  const contract = leaderboardGame(gameId);
  if (!contract) return null;
  const row = (await rawGameRows(gameId)).find((entry) => entry.profileId === profileId);
  if (!row) return null;
  const sample = sampleOf(row.stats);
  if (sample <= 0 || sample >= contract.minSample) return null;
  return { sample, minSample: contract.minSample };
}

export interface GameBoard {
  entries: LeaderboardEntry[];
  mine: LeaderboardEntry | null;
  mineProgress: LeaderboardQualifyProgress | null;
}

/**
 * Everything a per-game leaderboard tab needs (top `limit`, the caller's own
 * standing, and their qualify progress if they haven't reached it yet) off a
 * single rawGameRows fetch, rather than the three independent calls
 * getGameLeaderboard/getGameStanding/getGameQualifyProgress each made below
 * them -- each of those re-ran the same unfiltered game_leaderboard_stats
 * query and re-sorted the result, so one tab load was three full scans of the
 * same table. This is what app/api/leaderboard/route.ts actually calls now;
 * the three functions above stay for callers (and tests) that only need one
 * piece.
 */
export async function getGameBoard(
  gameId: string,
  profileId: string | null,
  limit = 10,
): Promise<GameBoard> {
  const contract = leaderboardGame(gameId);
  if (!contract) return { entries: [], mine: null, mineProgress: null };

  const raw = await rawGameRows(gameId);
  const sorted = sortDescendingByGoodness(scoredRows(gameId, raw));
  const entries = await decorateGameRows(gameId, sorted.slice(0, limit));

  if (!profileId) return { entries, mine: null, mineProgress: null };

  const index = sorted.findIndex((row) => row.profileId === profileId);
  if (index !== -1) {
    // Already in the decorated slice above (the common case: most callers
    // checking their own standing are checking because they're near the
    // top) -- reuse that row instead of paying for a second
    // getPublicProfilesByIds round trip to decorate it again.
    const inSlice = index < limit ? entries[index] : null;
    const mine = inSlice ?? (await decorateGameRows(gameId, [sorted[index]]))[0];
    return { entries, mine: mine ? { ...mine, rank: index + 1 } : null, mineProgress: null };
  }

  const rawRow = raw.find((row) => row.profileId === profileId);
  const sample = rawRow ? sampleOf(rawRow.stats) : 0;
  const mineProgress = sample > 0 && sample < contract.minSample ? { sample, minSample: contract.minSample } : null;
  return { entries, mine: null, mineProgress };
}

// ---- friends board ------------------------------------------------------

/**
 * Every friend, with the caller's head-to-head record against each.
 *
 * Friends with no shared history are kept rather than filtered out: "you two
 * have never played" is the thing the board exists to fix, and dropping them
 * would make an empty board look broken to someone who has friends but no
 * duels yet. They sort last.
 */
export async function getFriendsBoard(profileId: string): Promise<FriendBoardEntry[]> {
  const friendIds = await listFriendIds(profileId);
  if (friendIds.length === 0) return [];

  const [summaries, profiles] = await Promise.all([
    getHeadToHeadSummaries(profileId, friendIds),
    getPublicProfilesByIds(friendIds),
  ]);

  const entries = friendIds.flatMap((friendId) => {
    const profile = profiles.get(friendId);
    // Same reasoning as the friends drawer's own hydrate(): a row whose
    // profile has vanished mid-deletion is dropped rather than rendered blank.
    if (!profile) return [];
    const summary = summaries.get(friendId);
    return [{
      profileId: friendId,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      accent: profile.accent,
      wins: summary?.wins ?? 0,
      losses: summary?.losses ?? 0,
      draws: summary?.draws ?? 0,
      currentStreak: summary?.currentStreak ?? 0,
      bestStreak: summary?.bestStreak ?? 0,
      games: (summary?.games ?? []).map((game) => ({
        gameId: game.gameId,
        label: game.label,
        wins: game.wins,
        losses: game.losses,
        draws: game.draws,
        currentStreak: game.currentStreak,
      })),
    }];
  });

  const played = (entry: FriendBoardEntry) => entry.wins + entry.losses + entry.draws;
  return entries.sort((a, b) => played(b) - played(a) || a.displayName.localeCompare(b.displayName));
}

// ---- global read --------------------------------------------------------
//
// A read-time percentile blend, not a stored column: a denormalized "global
// score" would need recomputing on every OTHER player's write in the same
// game, since percentiles shift even when you didn't play yourself. See the
// migration's own comment for the full reasoning. The memory branch below
// reimplements Postgres's percent_rank() exactly: (rank - 1) / (n - 1),
// RANK()-style ties, 0 for a lone qualifier.

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
  // higher_better: percent_rank() over (order by score asc), so the best
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
    // higherBetter is true for every registered game; they all rank on win
    // rate. Kept as a field rather than assumed, mirroring the SQL's own
    // higher_better column, so the next game that ranks low-to-high sets it
    // here and needs nothing else changed.
    pooled.push({ profileId, gameId, score: scoreOf(stats), higherBetter: true });
  }

  return pooled;
}

async function globalScores(): Promise<Map<string, { score: number; gamesCounted: number }>> {
  const supabase = adminClient();
  const byProfile = new Map<string, number[]>();

  if (!supabase) {
    const pooled = await memoryPooledScores();
    // Percentiles are computed per game (one partition per gameId), then
    // averaged per profile: exactly get_global_leaderboard()'s two-step
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
  return decorateRankedRows(rows, (row) => ({ globalScore: row.score, gamesCounted: row.gamesCounted }));
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
