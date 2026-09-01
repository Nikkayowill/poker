/**
 * Nonogram: a solo skill wager, or free practice, any time.
 *
 * Wager Gold, finish a fresh picture inside the tier's clock without spending
 * the mistake budget, cash out a multiple of the wager. Same shape as
 * lib/arcade/ante-up-minesweeper.ts, and for the same reasons: the multiplier,
 * the clock and the mistake limit are all copied onto the attempt when it
 * opens and never re-read, so a retune cannot move the terms of a board
 * somebody is already halfway through. That rule is written down in
 * lib/arcade/ante-up-ladder.ts's header and has been broken twice.
 *
 * There is both a clock and a mistake budget because
 * lib/arcade/puzzles/nonogram.ts guarantees every picture can be finished by
 * line logic alone, no guessing. That is the right call for a board staking
 * real Gold, but it also means a careful player never *has* to be wrong: with
 * unlimited time and unlimited mistakes, clearing a board would be a
 * certainty, and a certainty paying more than 1x is a money printer at
 * whatever size the player can stake (see lib/arcade/ante-up-stakes.ts's
 * header for the day that got found out the hard way). The clock is what
 * makes the big boards a real bet; the mistake budget is what makes the small
 * ones one.
 *
 * The clock starts on the first square, not when the attempt opens, matching
 * Minesweeper. Sitting on an untouched board burns nothing -- but it does hold
 * the player's one active slot at this game, which is what stops an abandoned
 * attempt being parked forever.
 */

import {
  markNonogramCell,
  nonogramConfig,
  nonogramElapsedMs,
  nonogramMarkProblem,
  nonogramView,
  resignNonogramRound,
  startNonogramRound,
  type NonogramDifficulty,
  type NonogramMark,
  type NonogramMoveProblem,
  type NonogramRound,
  type NonogramView,
} from "./puzzles/nonogram";

/** The floor for a wager. Restated per game; see ante-up-memory.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

export interface AnteUpNonogramTier {
  /** Measured from the first square, not from opening the attempt; see the round's own clock. */
  readonly timeLimitMs: number;
  readonly multiplier: number;
}

/**
 * Starting numbers, not tuned against real solve rates; retune here.
 *
 * The clock grows faster than the board does, because a nonogram's work grows
 * with its area and its cross-referencing grows faster still: a 25x25 is not
 * five times a 5x5, it is twenty-five times the squares with far more
 * back-and-forth between rows and columns. Easy pays barely over 1x on
 * purpose -- a 5x5 with four minutes on it is close to a certain win, and the
 * ceiling half of that same guard lives in lib/arcade/ante-up-stakes.ts.
 */
export const ANTE_UP_NONOGRAM_TIERS: Readonly<Record<NonogramDifficulty, AnteUpNonogramTier>> = {
  easy: { timeLimitMs: 4 * 60 * 1000, multiplier: 1.05 },
  medium: { timeLimitMs: 10 * 60 * 1000, multiplier: 1.4 },
  hard: { timeLimitMs: 18 * 60 * 1000, multiplier: 2.2 },
  expert: { timeLimitMs: 28 * 60 * 1000, multiplier: 3.2 },
  master: { timeLimitMs: 40 * 60 * 1000, multiplier: 5 },
};

export type AnteUpNonogramStatus = "active" | "won" | "lost" | "timed-out";

export interface AnteUpNonogramAttempt {
  difficulty: NonogramDifficulty;
  /** Already debited by the time an attempt exists; see the service. */
  wager: number;
  /** Copied from the tier at open, never re-read at settlement. */
  multiplier: number;
  timeLimitMs: number;
  board: NonogramRound;
  status: AnteUpNonogramStatus;
  startedAt: string;
}

export function startAnteUpNonogram(
  difficulty: NonogramDifficulty,
  wager: number,
  seed: number,
  now: Date,
): AnteUpNonogramAttempt {
  const tier = ANTE_UP_NONOGRAM_TIERS[difficulty];
  return {
    difficulty,
    wager,
    multiplier: tier.multiplier,
    timeLimitMs: tier.timeLimitMs,
    board: startNonogramRound(difficulty, seed),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/**
 * When the clock runs out, or null if it has not started. The clock only runs
 * once the first square is marked, so an attempt sitting on an untouched board
 * has no deadline to miss.
 */
export function anteUpNonogramDeadline(attempt: AnteUpNonogramAttempt): number | null {
  if (!attempt.board.startedAt) return null;
  return Date.parse(attempt.board.startedAt) + attempt.timeLimitMs;
}

/**
 * Settles an attempt whose clock has expired.
 *
 * Returns null when nothing changed. That contract matters: the client polls
 * this while a board is live, and a tick that always returned a new object
 * would bump the stored version on every poll and livelock the optimistic
 * concurrency guard against the player's own moves. Every duel engine carries
 * the same rule for the same reason.
 */
export function tickAnteUpNonogram(
  attempt: AnteUpNonogramAttempt,
  now: Date,
): AnteUpNonogramAttempt | null {
  if (attempt.status !== "active") return null;
  const deadline = anteUpNonogramDeadline(attempt);
  if (deadline === null || now.getTime() < deadline) return null;
  return {
    ...attempt,
    board: resignNonogramRound(attempt.board, now),
    status: "timed-out",
  };
}

export function anteUpNonogramMarkProblem(
  attempt: AnteUpNonogramAttempt,
  index: number,
  mark: NonogramMark,
  now: Date,
): NonogramMoveProblem | null {
  if (attempt.status !== "active") return "finished";
  const deadline = anteUpNonogramDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return "finished";
  return nonogramMarkProblem(attempt.board, index, mark);
}

export function markAnteUpNonogramCell(
  attempt: AnteUpNonogramAttempt,
  index: number,
  mark: NonogramMark,
  now: Date,
): AnteUpNonogramAttempt {
  if (anteUpNonogramMarkProblem(attempt, index, mark, now)) return attempt;

  const board = markNonogramCell(attempt.board, index, mark, now);
  if (board.status === "cleared") return { ...attempt, board, status: "won" };
  if (board.status === "lost") return { ...attempt, board, status: "lost" };
  return { ...attempt, board, status: "active" };
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignAnteUpNonogram(
  attempt: AnteUpNonogramAttempt,
  now: Date,
): AnteUpNonogramAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, board: resignNonogramRound(attempt.board, now), status: "lost" };
}

/** What a wager win pays. Zero on anything else; a loss or a timeout forfeits the wager. */
export function anteUpNonogramPayout(
  attempt: Pick<AnteUpNonogramAttempt, "wager" | "multiplier" | "status">,
): number {
  if (attempt.status !== "won") return 0;
  return Math.round(attempt.wager * attempt.multiplier);
}

export interface AnteUpNonogramSnapshot {
  id: string;
  version: number;
  difficulty: NonogramDifficulty;
  wager: number;
  multiplier: number;
  status: AnteUpNonogramStatus;
  /** Redacted; carries no answer while the round is live. */
  board: NonogramView;
  /**
   * When the clock runs out, or null until the first square starts it. Absolute
   * rather than a duration on purpose: the client ticks its own countdown once
   * a second, and a relative figure would freeze at whatever it said when the
   * snapshot was built.
   */
  expiresAt: string | null;
  /** Floored at zero. Null until the first square starts the clock. */
  msRemaining: number | null;
  timeLimitMs: number;
  elapsedMs: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpNonogramSnapshot(
  attempt: AnteUpNonogramAttempt,
  meta: { id: string; version: number },
  now: Date,
): AnteUpNonogramSnapshot {
  const deadline = anteUpNonogramDeadline(attempt);
  return {
    id: meta.id,
    version: meta.version,
    difficulty: attempt.difficulty,
    wager: attempt.wager,
    multiplier: attempt.multiplier,
    status: attempt.status,
    board: nonogramView(attempt.board),
    expiresAt: deadline === null ? null : new Date(deadline).toISOString(),
    msRemaining:
      deadline === null
        ? null
        : attempt.status === "active"
          ? Math.max(0, deadline - now.getTime())
          : 0,
    timeLimitMs: attempt.timeLimitMs,
    elapsedMs: nonogramElapsedMs(attempt.board, now),
    payout: anteUpNonogramPayout(attempt),
  };
}

/** How wide the board at this difficulty is, for copy that names it before one is dealt. */
export function anteUpNonogramSize(difficulty: NonogramDifficulty): number {
  return nonogramConfig(difficulty).size;
}
