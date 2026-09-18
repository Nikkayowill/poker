/**
 * How much Gold may ride on one Ante Up attempt.
 *
 * Ante Up used to bound a wager by a per-game, per-difficulty ceiling (see
 * git history / 20260827090000_ante_up_wager_tier_ceiling.sql for why one was
 * added: restaking a near-certain win on an easy board compounded a fortune).
 * That ceiling has been removed -- a solo wager is now bounded only by the
 * player's own balance, same as any other stake in the app. The DB-side
 * trigger this file used to mirror (ante_up_attempts_enforce_wager_ceiling)
 * is now a no-op; see 20260918152323_ante_up_remove_wager_ceiling.sql.
 *
 * The payout side of the old fix is unaffected: ANTE_UP_TIERS and its
 * equivalents (lib/arcade/ante-up.ts) still keep an easy board's multiplier
 * near 1x, and the daily wagered-attempt caps still bound how many attempts a
 * day can run.
 */

/**
 * Every game that takes a wager, by the id it is stored under. Matches the
 * `GAME` constant in each game's service, and `ante_up_attempts.game` for the
 * four that write there (Word Stack and Connections keep their wager inside a
 * daily_puzzle_rounds row instead).
 */
export const ANTE_UP_GAMES = [
  "sudoku",
  "minesweeper",
  "nonogram",
  "memory-match",
  "word-stack",
  "connections",
] as const;

export type AnteUpGame = (typeof ANTE_UP_GAMES)[number];

/**
 * The most that may be staked on one attempt of `game` at `tier`.
 *
 * No ceiling exists any more -- kept as a function (rather than deleted, with
 * every caller inlining Infinity) so a future per-board ceiling has one place
 * to land again.
 */
export function maxAnteUpWager(_game: AnteUpGame, _tier: string | null): number {
  return Number.POSITIVE_INFINITY;
}

/**
 * Why this wager is too big for this board, or null if it fits.
 *
 * Always null now that there is no ceiling; kept for the same reason as
 * `maxAnteUpWager` above.
 */
export function anteUpWagerCeilingProblem(
  _game: AnteUpGame,
  _tier: string | null,
  _wager: number,
): string | null {
  return null;
}
