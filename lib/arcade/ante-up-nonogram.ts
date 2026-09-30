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
  hintNonogramCell,
  markNonogramCell,
  markNonogramCells,
  nonogramConfig,
  nonogramElapsedMs,
  nonogramHintProblem,
  nonogramMarkProblem,
  nonogramUndoProblem,
  nonogramView,
  resignNonogramRound,
  startNonogramRound,
  undoNonogram,
  type NonogramDeal,
  type NonogramDifficulty,
  type NonogramHintProblem,
  type NonogramMark,
  type NonogramMoveProblem,
  type NonogramRound,
  type NonogramUndoProblem,
  type NonogramView,
} from "./puzzles/nonogram";
import { stakePressure } from "./stake-pressure";

/** The floor for a wager. Restated per game; see ante-up-memory.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

export interface AnteUpNonogramTier {
  /**
   * For free play and stakes under 10k. Measured from the first square, not
   * from opening the attempt; see the round's own clock.
   */
  readonly timeLimitMs: number;
  /** From 10k up, where each band is set for a stronger player. */
  readonly rankedTimeLimitMs: number;
  readonly multiplier: number;
}

/**
 * The free-play clocks grow faster than the board does, because a nonogram's
 * work grows with its area and its cross-referencing grows faster still. Easy
 * pays barely over 1x on purpose: a 5x5 with four minutes on it is close to a
 * certain win, and a big stake can't be played on it at all
 * (lib/arcade/ante-up-stakes.ts).
 *
 * The clocks from 10k up come from a skill model, not from solve-rate data we
 * don't have yet (lib/arcade/ante-up-calibration.test.ts holds it and checks
 * the targets). A median player's time on our boards is taken as easy 1.5,
 * medium 7, hard 18, expert 35 and master 55 minutes, below the 10-15 minute
 * 10x10 and 30-45 minute 15x15 published for casual solvers because ours are
 * line-solvable with drag-to-fill. Log-normal, sigma 0.3. Each standard
 * deviation of skill is 1.65x faster, which puts the top players near
 * published speed-solver times. Crossing your own lines (100k up) adds 10%.
 * Spending the mistake budget ends it for 5-25% of median players, halving
 * per standard deviation.
 *
 * Win rate on the smallest board each stake band allows, by player:
 *
 *   band (floor board, clock)     median   +1SD   +2SD   +3SD
 *   <10k   (easy, 4 min)            95%     97%     99%    99%
 *   10k+   (medium, 5 min)          12%     67%     96%    99%
 *   100k+  (hard, 9 min)             0%     16%     73%    97%
 *   1M+    (expert, 11 min)          0%      1%     19%    78%
 *   1M+    (master, 16 min)          0%      0%     13%    69%
 *
 * Retune here once real attempts give solve rates.
 */
export const ANTE_UP_NONOGRAM_TIERS: Readonly<Record<NonogramDifficulty, AnteUpNonogramTier>> = {
  easy: { timeLimitMs: 4 * 60_000, rankedTimeLimitMs: 4 * 60_000, multiplier: 1.05 },
  medium: { timeLimitMs: 10 * 60_000, rankedTimeLimitMs: 5 * 60_000, multiplier: 1.4 },
  hard: { timeLimitMs: 15 * 60_000, rankedTimeLimitMs: 9 * 60_000, multiplier: 2.2 },
  expert: { timeLimitMs: 20 * 60_000, rankedTimeLimitMs: 11 * 60_000, multiplier: 3.2 },
  master: { timeLimitMs: 30 * 60_000, rankedTimeLimitMs: 16 * 60_000, multiplier: 5 },
};

/** The clock a board runs at this stake. Fixed on the attempt when it opens. */
export function anteUpNonogramTimeLimitMs(difficulty: NonogramDifficulty, wager: number): number {
  const tier = ANTE_UP_NONOGRAM_TIERS[difficulty];
  return stakePressure(wager) >= 1 ? tier.rankedTimeLimitMs : tier.timeLimitMs;
}

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

/**
 * Whether a stake this size may have finished lines crossed off for it.
 *
 * Auto-cross never reveals anything, but on a big board it does the
 * bookkeeping that keeps a player from filling a square in a line that is
 * already done, which is a lot of the care the mistake budget is there to
 * test. From 100k up the player crosses their own, as on paper.
 */
export function anteUpNonogramAutoCrossAllowed(wager: number): boolean {
  return stakePressure(wager) < 2;
}

/**
 * Opens an attempt on a board that has already been dealt.
 *
 * The deal comes in rather than being made here for the reason
 * lib/arcade/puzzles/nonogram.ts's header gives: the picture library is
 * `server-only` and this module is imported by the browser.
 *
 * The auto-cross setting is decided here and kept on the round, so a live
 * board never changes under the player.
 */
export function startAnteUpNonogram(
  difficulty: NonogramDifficulty,
  wager: number,
  seed: number,
  deal: NonogramDeal,
  now: Date,
  options: { autoCross?: boolean } = {},
): AnteUpNonogramAttempt {
  const tier = ANTE_UP_NONOGRAM_TIERS[difficulty];
  const autoCross = anteUpNonogramAutoCrossAllowed(wager) ? options.autoCross : false;
  return {
    difficulty,
    wager,
    multiplier: tier.multiplier,
    timeLimitMs: anteUpNonogramTimeLimitMs(difficulty, wager),
    board: startNonogramRound(difficulty, seed, deal, { autoCross }),
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

/**
 * Carries a board's own outcome up onto the attempt. The one place that
 * mapping lives.
 *
 * An unchanged board hands back the same attempt rather than a copy of it.
 * That is not a micro-optimisation: the service uses object identity to decide
 * whether to write, and a copy would bump the stored version for a move that
 * did nothing -- which then refuses the player's own next move, pinned as it
 * is to the version they were shown.
 */
function withBoard(attempt: AnteUpNonogramAttempt, board: NonogramRound): AnteUpNonogramAttempt {
  if (board === attempt.board) return attempt;
  if (board.status === "cleared") return { ...attempt, board, status: "won" };
  if (board.status === "lost") return { ...attempt, board, status: "lost" };
  return { ...attempt, board, status: "active" };
}

export function markAnteUpNonogramCell(
  attempt: AnteUpNonogramAttempt,
  index: number,
  mark: NonogramMark,
  now: Date,
): AnteUpNonogramAttempt {
  if (anteUpNonogramMarkProblem(attempt, index, mark, now)) return attempt;
  return withBoard(attempt, markNonogramCell(attempt.board, index, mark, now));
}

/**
 * Puts a whole dragged stroke down.
 *
 * The clock is checked once, for the stroke, rather than per square: a drag is
 * one gesture and settling it half-applied because the deadline landed
 * mid-list would be a board the player never saw.
 */
export function strokeAnteUpNonogram(
  attempt: AnteUpNonogramAttempt,
  indexes: readonly number[],
  mark: NonogramMark,
  now: Date,
): AnteUpNonogramAttempt {
  if (attempt.status !== "active") return attempt;
  const deadline = anteUpNonogramDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return attempt;

  const { round } = markNonogramCells(attempt.board, indexes, mark, now);
  return withBoard(attempt, round);
}

/** Why undo cannot run on this attempt, or null if it can. */
export function anteUpNonogramUndoProblem(
  attempt: AnteUpNonogramAttempt,
  now: Date,
): NonogramUndoProblem | null {
  if (attempt.status !== "active") return "finished";
  const deadline = anteUpNonogramDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return "finished";
  return nonogramUndoProblem(attempt.board);
}

/** Takes back the last stroke. Never touches the clock, the wager or the mistakes. */
export function undoAnteUpNonogram(
  attempt: AnteUpNonogramAttempt,
  now: Date,
): AnteUpNonogramAttempt {
  if (anteUpNonogramUndoProblem(attempt, now)) return attempt;
  return { ...attempt, board: undoNonogram(attempt.board) };
}

/** Why a hint cannot be given on this attempt, or null if it can. */
export function anteUpNonogramHintProblem(
  attempt: AnteUpNonogramAttempt,
  now: Date,
): NonogramHintProblem | null {
  if (attempt.status !== "active") return "finished";
  const deadline = anteUpNonogramDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return "finished";
  return nonogramHintProblem(attempt.board);
}

/**
 * Gives one square away, for one mistake.
 *
 * A hint can finish a board, and when it does the attempt is won and paid like
 * any other clear -- the mistake it cost is the price, and there is no second
 * one to charge.
 */
export function hintAnteUpNonogram(
  attempt: AnteUpNonogramAttempt,
  now: Date,
): AnteUpNonogramAttempt {
  if (anteUpNonogramHintProblem(attempt, now)) return attempt;
  return withBoard(attempt, hintNonogramCell(attempt.board, now));
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
