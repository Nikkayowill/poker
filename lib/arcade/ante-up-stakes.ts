/**
 * How much Gold may ride on one Ante Up attempt.
 *
 * Every Ante Up game had a wager floor (MIN_ANTE_UP_WAGER, restated per game)
 * and no ceiling at all, so the only bound on a stake was the player's own
 * balance. Combined with an easy board being close to a certain win, that made
 * the safest rung of every ladder the most profitable place to put a fortune:
 * stake everything on a grid you always solve, collect a multiple, restake the
 * larger balance. The daily wagered-attempt caps limited how many times a day
 * that could run, not how big each run was, and compounding does the rest.
 *
 * The rule this file encodes: **a bigger stake has to buy a harder board.**
 * Sudoku, Minesweeper and Nonogram have real difficulty rungs to hang that on,
 * so their ceiling climbs with difficulty. The other three have no difficulty
 * axis, so they get one flat ceiling each until they grow one.
 *
 * This is only half the fix. The other half lives in each game's own
 * multiplier table: a ceiling bounds what a single attempt can pay, but a
 * near-certain win paying more than 1x still prints money at any size. See
 * ANTE_UP_TIERS (lib/arcade/ante-up.ts) and its equivalents for the payout
 * side of the same problem.
 *
 * Numbers below are aligned to the poker STAKES_TIERS ladder so a ceiling
 * reads as "this board can fund that seat". They are starting numbers, not
 * measured against real solve rates; retune them here and nowhere else.
 */

import type { MinesweeperDifficulty } from "./puzzles/minesweeper";
import type { NonogramDifficulty } from "./puzzles/nonogram";
import type { SudokuDifficulty } from "./puzzles/sudoku";

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

/** A guaranteed-solvable easy grid is not worth a fortune; an expert one is. */
const SUDOKU_MAX_WAGER: Readonly<Record<SudokuDifficulty, number>> = {
  easy: 5_000,
  medium: 25_000,
  hard: 100_000,
  expert: 500_000,
};

/** Same ladder, one rung shorter. A no-guess beginner board is the easy grid's twin. */
const MINESWEEPER_MAX_WAGER: Readonly<Record<MinesweeperDifficulty, number>> = {
  beginner: 5_000,
  intermediate: 50_000,
  expert: 500_000,
};

/**
 * Five rungs, one per board size (5x5 through 25x25). The top rung stops at
 * the same 500,000 Sudoku and Minesweeper stop at rather than climbing past
 * them for having two more rungs: this ladder is longer because a nonogram
 * has a size axis, not because a nonogram is worth more.
 */
const NONOGRAM_MAX_WAGER: Readonly<Record<NonogramDifficulty, number>> = {
  easy: 5_000,
  medium: 25_000,
  hard: 100_000,
  expert: 250_000,
  master: 500_000,
};

/**
 * The games with no difficulty rung to climb. One number each, low, because
 * there is no harder board to earn a higher ceiling with -- Memory Match is
 * bounded by its turn cap and the other two by being one shared daily board.
 * Raise these only alongside a real difficulty axis for that game.
 */
const FLAT_MAX_WAGER: Readonly<Record<"memory-match" | "word-stack" | "connections", number>> = {
  "memory-match": 25_000,
  "word-stack": 25_000,
  "connections": 25_000,
};

/**
 * The most that may be staked on one attempt of `game` at `tier`.
 *
 * An unrecognised tier falls to the game's lowest ceiling rather than its
 * highest: a tier string that does not parse must never be the cheap way past
 * this check. The services parse the difficulty before calling in, so this is
 * a backstop, not the primary guard.
 */
export function maxAnteUpWager(game: AnteUpGame, tier: string | null): number {
  switch (game) {
    case "sudoku":
      return tier !== null && tier in SUDOKU_MAX_WAGER
        ? SUDOKU_MAX_WAGER[tier as SudokuDifficulty]
        : SUDOKU_MAX_WAGER.easy;
    case "minesweeper":
      return tier !== null && tier in MINESWEEPER_MAX_WAGER
        ? MINESWEEPER_MAX_WAGER[tier as MinesweeperDifficulty]
        : MINESWEEPER_MAX_WAGER.beginner;
    case "nonogram":
      return tier !== null && tier in NONOGRAM_MAX_WAGER
        ? NONOGRAM_MAX_WAGER[tier as NonogramDifficulty]
        : NONOGRAM_MAX_WAGER.easy;
    default:
      return FLAT_MAX_WAGER[game];
  }
}

/**
 * Why this wager is too big for this board, or null if it fits.
 *
 * The message names the next rung up rather than only refusing, because the
 * fix the player wants is almost always "play a harder board", not "wager
 * less" -- and a bare refusal reads like a bug when the UI let them pick the
 * amount.
 */
export function anteUpWagerCeilingProblem(
  game: AnteUpGame,
  tier: string | null,
  wager: number,
): string | null {
  const max = maxAnteUpWager(game, tier);
  if (wager <= max) return null;

  const harder = nextRungUp(game, tier);
  const stakeMore = harder
    ? ` Step up to ${harder.label} to stake up to ${harder.max.toLocaleString()}.`
    : "";
  return `That board caps at ${max.toLocaleString()} Gold a wager.${stakeMore}`;
}

/** The next difficulty that would allow a bigger wager, for the message above. */
function nextRungUp(
  game: AnteUpGame,
  tier: string | null,
): { label: string; max: number } | null {
  const ladder: readonly string[] | null =
    game === "sudoku"
      ? (["easy", "medium", "hard", "expert"] as const)
      : game === "minesweeper"
        ? (["beginner", "intermediate", "expert"] as const)
        : game === "nonogram"
          ? (["easy", "medium", "hard", "expert", "master"] as const)
          : null;
  if (!ladder || tier === null) return null;

  const next = ladder[ladder.indexOf(tier) + 1];
  if (next === undefined) return null;
  return { label: next.charAt(0).toUpperCase() + next.slice(1), max: maxAnteUpWager(game, next) };
}
