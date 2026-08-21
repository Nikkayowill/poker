/**
 * Sudoku -- a solo skill wager, or free practice, any time.
 *
 * Wager Gold, beat a fresh grid against the clock, cash out a multiple of the
 * wager if you do. It stakes Gold against your own performance, not another
 * player and not the house's fixed odds -- the only thing that decides the
 * outcome is whether the grid gets solved before the deadline, which is
 * exactly the "skill, not chance" line the 2026-08-12 cut of the pure-chance
 * games drew.
 *
 * This is the whole game now -- there is no separate free daily Sudoku with
 * its own once-a-day gate any more (there was, briefly, on 2026-08-21, as
 * part of that day's short-lived "Ante Up" brain-games unification; Kayo's
 * follow-up call the same day put Sudoku back to always-wager-or-free,
 * unlimited, and that is what /games/sudoku renders directly now -- see
 * CLAUDE.md's 2026-08-21 note for the full history).
 *
 * Reuses lib/arcade/puzzles/sudoku.ts's engine untouched -- same
 * `startSudokuRound`/`fillSudokuCell`/`sudokuFillProblem`, same "the solution
 * never leaves the server" contract via `toSudokuSnapshot`. The one thing
 * this file changes about how that engine is used: `generateSudoku` is seeded
 * with a fresh random string per attempt rather than a calendar day, so every
 * attempt is its own grid.
 */

import {
  fillSudokuCell,
  generateSudoku,
  startSudokuRound,
  sudokuFillProblem,
  type SudokuDifficulty,
  type SudokuFillProblem,
  type SudokuRound,
} from "./puzzles/sudoku";

/**
 * The floor for a wager. Zero is always allowed too -- practice, no payout --
 * see MIN_DUEL_STAKE's doc comment for why a nonzero stake needs one at all:
 * without it, a farmed 10x from a stream of 1-Gold wagers is indistinguishable
 * from a real one.
 */
export const MIN_ANTE_UP_WAGER = 500;

export interface AnteUpTier {
  /** How long the clock runs. */
  timeLimitMs: number;
  /** What a win pays: wager * multiplier. */
  multiplier: number;
}

/**
 * One rung per Sudoku difficulty: harder grid, tighter clock, bigger payout.
 * Starting numbers -- not tuned against real play, easy to retune here.
 */
export const ANTE_UP_TIERS: Record<SudokuDifficulty, AnteUpTier> = {
  easy: { timeLimitMs: 15 * 60_000, multiplier: 1.5 },
  medium: { timeLimitMs: 10 * 60_000, multiplier: 2.5 },
  hard: { timeLimitMs: 7 * 60_000, multiplier: 5 },
  expert: { timeLimitMs: 5 * 60_000, multiplier: 10 },
};

/**
 * `active` is still playing. `won` solved it in time. `lost` is an early
 * resignation -- a player who gives up rather than let the clock run out.
 * `timed-out` is the clock itself ending it. The three failure-adjacent
 * states are kept distinct (rather than collapsing lost/timed-out into one
 * "did not win") because they are different player actions, the same reason
 * a duel's outcome names "Resigned" rather than just "Lost".
 */
export type AnteUpStatus = "active" | "won" | "lost" | "timed-out";

export interface AnteUpAttempt {
  difficulty: SudokuDifficulty;
  /** What was staked. Already debited by the time an attempt exists -- see ante-up-service.ts. */
  wager: number;
  /** Copied from ANTE_UP_TIERS at start, not re-read at settlement -- a retuned table must not change a live attempt's payout underneath it. */
  multiplier: number;
  sudoku: SudokuRound;
  status: AnteUpStatus;
  startedAt: string;
  /** ISO instant the clock runs out. Past this, tickAnteUpAttempt ends it. */
  expiresAt: string;
}

/** A fresh attempt: `seed` is any string unique to this attempt, never a calendar day -- see the file header. */
export function startAnteUpAttempt(
  difficulty: SudokuDifficulty,
  wager: number,
  seed: string,
  now: Date,
): AnteUpAttempt {
  const tier = ANTE_UP_TIERS[difficulty];
  const board = generateSudoku(seed, difficulty);
  return {
    difficulty,
    wager,
    multiplier: tier.multiplier,
    sudoku: startSudokuRound(board, difficulty, now),
    status: "active",
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + tier.timeLimitMs).toISOString(),
  };
}

/**
 * Ends an attempt whose clock has run out. Returns null when nothing changed
 * -- the same contract DuelGame#tick documents, for the same reason: the poll
 * calls this on every read, and a fresh object on an attempt that is not
 * actually over would bump the version on every poll and livelock the
 * optimistic-concurrency guard.
 */
export function tickAnteUpAttempt(attempt: AnteUpAttempt, now: Date): AnteUpAttempt | null {
  if (attempt.status !== "active") return null;
  if (now.getTime() < Date.parse(attempt.expiresAt)) return null;
  return { ...attempt, status: "timed-out" };
}

/** Why a fill cannot be made, or null if it can. Checked before anything is written. */
export function anteUpFillProblem(
  attempt: AnteUpAttempt,
  index: number,
  value: number,
): SudokuFillProblem | null {
  if (attempt.status !== "active") return "finished";
  return sudokuFillProblem(attempt.sudoku, index, value);
}

export interface AnteUpFillResult {
  attempt: AnteUpAttempt;
  correct: boolean;
}

/** Writes a digit, or counts a mistake. A completed grid before the deadline becomes a win. */
export function fillAnteUpCell(
  attempt: AnteUpAttempt,
  index: number,
  value: number,
  now: Date,
): AnteUpFillResult {
  if (anteUpFillProblem(attempt, index, value)) return { attempt, correct: false };

  const { round, correct } = fillSudokuCell(attempt.sudoku, index, value, now);
  const won = round.status === "solved";
  return {
    attempt: { ...attempt, sudoku: round, status: won ? "won" : attempt.status },
    correct,
  };
}

/** Gives up early. The wager is already spent (see ante-up-service.ts's rules) -- this only records how it ended. */
export function resignAnteUpAttempt(attempt: AnteUpAttempt): AnteUpAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost" };
}

/** What a win actually pays. Rounded: a fractional Gold credit is not a real amount. */
export function anteUpPayout(attempt: Pick<AnteUpAttempt, "wager" | "multiplier">): number {
  return Math.round(attempt.wager * attempt.multiplier);
}

/**
 * The attempt as the browser may see it.
 *
 * `sudoku.solution` is gone -- not blanked, absent, same as toSudokuSnapshot.
 * That is the one line in this file that matters most: with the solution in
 * hand, "beat the clock" is a formality.
 */
export interface AnteUpSnapshot {
  id: string;
  difficulty: SudokuDifficulty;
  wager: number;
  multiplier: number;
  /** wager * multiplier, stated rather than left for the client to compute. */
  payout: number;
  version: number;
  status: AnteUpStatus;
  puzzle: number[];
  entries: number[];
  mistakes: number;
  startedAt: string;
  expiresAt: string;
  /** Milliseconds left on the clock, floored at 0. What the countdown reads. */
  msRemaining: number;
}

export function toAnteUpSnapshot(
  attempt: AnteUpAttempt,
  meta: { id: string; version: number },
  now: Date,
): AnteUpSnapshot {
  return {
    id: meta.id,
    difficulty: attempt.difficulty,
    wager: attempt.wager,
    multiplier: attempt.multiplier,
    payout: anteUpPayout(attempt),
    version: meta.version,
    status: attempt.status,
    puzzle: [...attempt.sudoku.puzzle],
    entries: [...attempt.sudoku.entries],
    mistakes: attempt.sudoku.mistakes,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    msRemaining: Math.max(0, Date.parse(attempt.expiresAt) - now.getTime()),
  };
}
