/**
 * The per-game leaderboard registry.
 *
 * Who gets a board: every PvP game, poker (through its own richer stats,
 * hands won, biggest pot, not just W/L), and no Ante Up solo game. A solo
 * score board has to pick a difficulty to rank on, and per-difficulty tabs
 * were rejected outright since the tab row is already nine wide on a phone.
 * So a new solo game adds nothing here.
 *
 * Pure and dependency-free, same reasoning as lib/pvp/registry.ts and
 * lib/arcade/games.ts: vitest.config.ts collects only lib/ and app/, and
 * this is what a future game's leaderboard entry has to agree with. It's
 * not a DB catalog the way mission_definitions is; a format function can't
 * survive a round trip through Postgres, and dropping in a new game means
 * shipping a new engine anyway, so a second admin-tunable table would just
 * be another thing to keep in sync for no benefit.
 *
 * Dropping in a future game touches exactly two files: one entry here, and
 * one call to lib/server/leaderboard-store.ts's write functions beside that
 * game's own settlement/completion call site. Nothing else changes, not the
 * API route, not the UI, not a migration.
 *
 * gameId values here, and the game_id lists baked into the
 * global_leaderboard_entries() SQL function
 * (supabase/migrations/20260820120000_game_leaderboard_stats.sql), must stay
 * hand-in-sync; that migration's own comment points back at this file.
 */

export interface LeaderboardColumn {
  key: string;
  label: string;
}

/**
 * The accumulators one game_leaderboard_stats row carries.
 *
 * The table also has metric_sum/metric_count, from when Memory Match ranked
 * on average turns. Nothing reads or writes them any more (see this file's
 * header for why a solo game has no board), and they are absent here: the
 * RPC defaults them to 0. The columns themselves stay, since migrations here
 * are append-only.
 */
export interface LeaderboardStats {
  wins: number;
  losses: number;
  draws: number;
  currentStreak: number;
  bestStreak: number;
}

export interface LeaderboardGameContract {
  /** Matches lib/pvp DUEL_GAMES' id, or "cribbage". */
  gameId: string;
  label: string;
  /**
   * The qualifying sample size before a player enters the Global blend.
   * Gates a 1-0 record from posting a perfect percentile off almost no data.
   * Must match the threshold baked into global_leaderboard_entries()'s SQL.
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

/**
 * "W3" / "L5" / "—" for a signed streak.
 *
 * Exported because the friends board (components/leaderboard/leaderboard.tsx)
 * renders the same idea from head-to-head rows, and two hand-written versions
 * of "how a streak reads" is exactly the kind of near-miss that shows up as
 * one screen saying L5 and another saying -5.
 */
export function formatStreak(currentStreak: number): string {
  if (currentStreak > 0) return `W${currentStreak}`;
  if (currentStreak < 0) return `L${-currentStreak}`;
  return "—";
}

/**
 * "4-2", or "4-2-1" once a draw has actually happened.
 *
 * Shared with the friends drawer's badge for the same reason as formatStreak:
 * the drawer and the board show one player's record from one store, so they
 * have to spell it the same way.
 */
export function formatRecord(wins: number, losses: number, draws: number): string {
  return draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

function streakLabel(stats: LeaderboardStats): string {
  return formatStreak(stats.currentStreak);
}

/**
 * Every registered game's contract; only the label and gameId differ.
 *
 * There is one shape here rather than a `kind` discriminator because every
 * game that gets a board is won or lost against a named opponent. Memory
 * Match's average-turns ranking was the only other shape and went with the
 * board itself; git has it if a game ever ranks on a raw number again.
 */
function winLossRecordContract(gameId: string, label: string): LeaderboardGameContract {
  return {
    gameId,
    label,
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
  // A 6-way winner-take-all table, not a literal 1v1 -- the same "head to
  // head" sense cribbage's own 3-4 player table already reads as, since
  // isHeadToHeadGame below is just registry membership.
  "sit-and-go": winLossRecordContract("sit-and-go", "Sit & Go"),
};

export type LeaderboardGameId = keyof typeof LEADERBOARD_GAMES;

export function leaderboardGame(id: string): LeaderboardGameContract | null {
  return LEADERBOARD_GAMES[id] ?? null;
}

export function isLeaderboardGameId(value: unknown): value is LeaderboardGameId {
  return typeof value === "string" && value in LEADERBOARD_GAMES;
}

/**
 * Whether a game can hold a record between two named players, which is what
 * the friends board is built from (see lib/server/head-to-head-store.ts).
 *
 * Registry membership is the answer rather than a second hand-written list:
 * a game only gets a board by being played against a named opponent, so the
 * two questions have the same members. A future duel joins the friends board
 * on the same one-registry-entry terms it joins the leaderboard on. Poker is
 * the one game that answers no while still having a board, since it isn't in
 * here at all: it ranks off player_stats instead, because one pot at a
 * six-handed table is not a result between two named players.
 */
export function isHeadToHeadGame(gameId: string): boolean {
  return leaderboardGame(gameId) !== null;
}

/**
 * Every tab the leaderboard page offers, poker, Global and Friends always
 * first.
 *
 * Client-safe (no "server-only" import anywhere in this file's dependency
 * chain), unlike app/api/leaderboard/route.ts. components/leaderboard/
 * leaderboard.tsx imports this directly rather than the route module.
 */
export function leaderboardTabs(): { id: string; label: string }[] {
  return [
    { id: "poker", label: "Poker" },
    { id: "global", label: "Global" },
    // Not a game: your own record against each friend, and the one tab whose
    // rows differ per viewer. It sits with the two cross-game tabs rather
    // than after the per-game ones for that reason.
    { id: "friends", label: "Friends" },
    ...Object.values(LEADERBOARD_GAMES).map((contract) => ({ id: contract.gameId, label: contract.label })),
  ];
}
