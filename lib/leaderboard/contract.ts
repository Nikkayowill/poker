/**
 * The per-game leaderboard registry.
 *
 * Pure and dependency-free, same reasoning as lib/pvp/registry.ts and
 * lib/arcade/games.ts -- vitest.config.ts collects only lib/ and app/, and
 * this is what a future game's leaderboard entry has to agree with. Not a DB
 * catalog the way mission_definitions is: a format function can't survive a
 * round trip through Postgres, and dropping in a new game means shipping a
 * new engine anyway, so a second admin-tunable table would just be another
 * thing to keep in sync for no benefit.
 *
 * Dropping in a future game touches exactly two files: one entry here, and
 * one call to lib/server/leaderboard-store.ts's write functions beside that
 * game's own settlement/completion call site. Nothing else changes -- not
 * the API route, not the UI, not a migration.
 *
 * gameId values here, and the game_id lists baked into the
 * global_leaderboard_entries() SQL function
 * (supabase/migrations/20260820120000_game_leaderboard_stats.sql), must stay
 * hand-in-sync -- that migration's own comment points back at this file.
 */

export type LeaderboardMetricKind = "win_loss_record" | "average_metric";

export interface LeaderboardColumn {
  key: string;
  label: string;
}

/** The raw accumulators one game_leaderboard_stats row carries. */
export interface LeaderboardStats {
  wins: number;
  losses: number;
  draws: number;
  metricSum: number;
  metricCount: number;
  currentStreak: number;
  bestStreak: number;
}

export interface LeaderboardGameContract {
  /** Matches lib/pvp DUEL_GAMES' id, or "cribbage", or "memory-match". */
  gameId: string;
  label: string;
  kind: LeaderboardMetricKind;
  /** "average_metric" games only -- ignored for win_loss_record, which is always higher-is-better. */
  direction: "higher_better" | "lower_better";
  /**
   * The qualifying sample size before a player enters the Global blend --
   * gates a 1-0 record or a two-turn Memory clear from posting a perfect
   * percentile off almost no data. Must match the threshold baked into
   * global_leaderboard_entries()'s SQL.
   */
  minSample: number;
  /** Rendered after rank/avatar/name on this game's own leaderboard tab. */
  columns: LeaderboardColumn[];
  /** Turns raw stats into the display strings `columns` names. */
  formatRow(stats: LeaderboardStats): Record<string, string>;
}

function winRatePct(stats: LeaderboardStats): number {
  const total = stats.wins + stats.losses + stats.draws;
  return total > 0 ? Math.round((stats.wins / total) * 100) : 0;
}

function streakLabel(stats: LeaderboardStats): string {
  if (stats.currentStreak > 0) return `W${stats.currentStreak}`;
  if (stats.currentStreak < 0) return `L${-stats.currentStreak}`;
  return "—";
}

/** Shared by every win/loss-record duel -- only the label and gameId differ. */
function winLossRecordContract(gameId: string, label: string): LeaderboardGameContract {
  return {
    gameId,
    label,
    kind: "win_loss_record",
    direction: "higher_better",
    minSample: 3,
    columns: [
      { key: "record", label: "W-L" },
      { key: "winRate", label: "Win %" },
      { key: "streak", label: "Streak" },
    ],
    formatRow: (stats) => ({
      record: `${stats.wins}-${stats.losses}`,
      winRate: `${winRatePct(stats)}%`,
      streak: streakLabel(stats),
    }),
  };
}

export const LEADERBOARD_GAMES: Readonly<Record<string, LeaderboardGameContract>> = {
  chess: winLossRecordContract("chess", "Chess"),
  checkers: winLossRecordContract("checkers", "Checkers"),
  trivia: winLossRecordContract("trivia", "Trivia Showdown"),
  "word-race": winLossRecordContract("word-race", "Word Race"),
  cribbage: winLossRecordContract("cribbage", "Cribbage"),
  "memory-match": {
    gameId: "memory-match",
    label: "Memory Match",
    kind: "average_metric",
    direction: "lower_better",
    minSample: 3,
    columns: [
      { key: "avgTurns", label: "Avg turns" },
      { key: "rounds", label: "Rounds" },
    ],
    formatRow: (stats) => ({
      avgTurns: stats.metricCount > 0 ? (stats.metricSum / stats.metricCount).toFixed(1) : "—",
      rounds: String(stats.metricCount),
    }),
  },
};

export type LeaderboardGameId = keyof typeof LEADERBOARD_GAMES;

export function leaderboardGame(id: string): LeaderboardGameContract | null {
  return LEADERBOARD_GAMES[id] ?? null;
}

export function isLeaderboardGameId(value: unknown): value is LeaderboardGameId {
  return typeof value === "string" && value in LEADERBOARD_GAMES;
}

/**
 * Every tab the leaderboard page offers, poker and Global always first.
 * Client-safe (no "server-only" import anywhere in this file's dependency
 * chain), unlike app/api/leaderboard/route.ts -- components/leaderboard/
 * leaderboard.tsx imports this directly rather than the route module.
 */
export function leaderboardTabs(): { id: string; label: string }[] {
  return [
    { id: "poker", label: "Poker" },
    { id: "global", label: "Global" },
    ...Object.values(LEADERBOARD_GAMES).map((contract) => ({ id: contract.gameId, label: contract.label })),
  ];
}
