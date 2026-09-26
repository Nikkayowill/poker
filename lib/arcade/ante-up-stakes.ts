import { lowestTierFor, tierAllowedFor, type TierLadder } from "./stake-pressure";

/**
 * How much Gold may ride on one Ante Up attempt.
 *
 * Ante Up used to bound a wager by a per-game, per-difficulty ceiling (see
 * git history / 20260827090000_ante_up_wager_tier_ceiling.sql for why one was
 * added: restaking a near-certain win on an easy board compounded a fortune).
 * That ceiling has been removed -- a solo wager is now bounded only by the
 * player's own balance, same as any other stake in the app. What a big stake
 * changes instead is how hard the board is (ANTE_UP_TIER_LADDERS below). The DB-side
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
  "blockudoku",
  "word-fill-in",
  // The Brain Games set: lib/arcade/brain-streak.ts (the first four, one
  // shared engine) plus lib/arcade/brain-lights-out.ts and
  // lib/arcade/brain-word-guess.ts.
  "sequence-recall",
  "quick-math",
  "pattern-predictor",
  "trivia-blitz",
  "lights-out",
  "word-guess",
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
 * Each tiered game's tiers, easiest first, and the easiest one each stake band
 * may pick. Bigger stakes are played on harder boards; see stake-pressure.ts.
 * Games with no tiers get harder another way, inside their own rules.
 */
export const ANTE_UP_TIER_LADDERS: Partial<Record<AnteUpGame, TierLadder<string>>> = {
  sudoku: { tiers: ["easy", "medium", "hard", "expert"], minTierByPressure: [0, 1, 2, 3] },
  minesweeper: { tiers: ["beginner", "intermediate", "expert", "master"], minTierByPressure: [0, 1, 2, 3] },
  nonogram: { tiers: ["easy", "medium", "hard", "expert", "master"], minTierByPressure: [0, 1, 2, 3] },
  blockudoku: { tiers: ["casual", "standard", "hardcore"], minTierByPressure: [0, 1, 2, 2] },
  "word-fill-in": { tiers: ["quick", "marathon"], minTierByPressure: [0, 1, 1, 1] },
};

/** Whether `tier` may be played at this stake. Always true for a game with no tiers. */
export function anteUpTierAllowed(game: AnteUpGame, tier: string | null, wager: number): boolean {
  const ladder = ANTE_UP_TIER_LADDERS[game];
  if (!ladder || tier === null) return true;
  return tierAllowedFor(ladder, tier, wager);
}

/** Why this tier can't be played at this stake, or null if it can. */
export function anteUpStakeProblem(game: AnteUpGame, tier: string | null, wager: number): string | null {
  if (anteUpTierAllowed(game, tier, wager)) return null;
  const ladder = ANTE_UP_TIER_LADDERS[game]!;
  const lowest = lowestTierFor(ladder, wager);
  const name = lowest.charAt(0).toUpperCase() + lowest.slice(1);
  return `A ${wager.toLocaleString()} Gold stake plays ${name} or harder. Pick a harder board or a smaller stake.`;
}
