/**
 * Minesweeper -- a solo skill wager, or free practice, any time.
 *
 * Wager Gold, clear a fresh board inside the tier's clock, cash out a multiple
 * of the wager. Same shape as lib/arcade/ante-up.ts (Sudoku): the multiplier is
 * fixed per difficulty and copied onto the attempt when it opens, so a player
 * knows exactly what they are playing for before the Gold leaves.
 *
 * ## Why there is a clock at all
 *
 * lib/arcade/puzzles/minesweeper.ts guarantees every board can be finished by
 * logic alone -- no coin flips. That is the right call for a game staking real
 * Gold, but it also means a careful player never *has* to hit a mine, so the
 * natural loss condition alone is a weak risk: the only way to lose is a
 * careless click, and unlimited time removes even that pressure. The per-tier
 * clock is what keeps a wagered attempt a real bet, the same job
 * ANTE_UP_MEMORY_MAX_TURNS does for Memory Match, and it also stops an
 * abandoned attempt from holding the player's one active slot forever.
 *
 * The limits are deliberately generous against real solve times (a competent
 * player clears expert in well under half of it) -- the clock is a backstop
 * against walking away, not the challenge itself. The challenge is the board.
 */

import {
  chordMinesweeperCell,
  minesweeperChordProblem,
  minesweeperElapsedMs,
  minesweeperFlagProblem,
  minesweeperRevealProblem,
  minesweeperView,
  resignMinesweeperRound,
  revealMinesweeperCell,
  startMinesweeperRound,
  toggleMinesweeperFlag,
  type MinesweeperDifficulty,
  type MinesweeperMoveProblem,
  type MinesweeperRound,
  type MinesweeperView,
} from "./puzzles/minesweeper";

/** The floor for a wager. Restated per game -- see ante-up-memory.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

export interface AnteUpMinesweeperTier {
  /** Measured from the FIRST CLICK, not from opening the attempt -- see the round's own clock. */
  readonly timeLimitMs: number;
  readonly multiplier: number;
}

export const ANTE_UP_MINESWEEPER_TIERS: Readonly<
  Record<MinesweeperDifficulty, AnteUpMinesweeperTier>
> = {
  beginner: { timeLimitMs: 5 * 60 * 1000, multiplier: 1.5 },
  intermediate: { timeLimitMs: 12 * 60 * 1000, multiplier: 3 },
  expert: { timeLimitMs: 25 * 60 * 1000, multiplier: 6 },
};

export type AnteUpMinesweeperStatus = "active" | "won" | "lost" | "timed-out";

export interface AnteUpMinesweeperAttempt {
  difficulty: MinesweeperDifficulty;
  /** Already debited by the time an attempt exists -- see the service. */
  wager: number;
  /** Copied from the tier at open, never re-read at settlement. */
  multiplier: number;
  timeLimitMs: number;
  board: MinesweeperRound;
  status: AnteUpMinesweeperStatus;
  startedAt: string;
}

export function startAnteUpMinesweeper(
  difficulty: MinesweeperDifficulty,
  wager: number,
  seed: number,
  now: Date,
): AnteUpMinesweeperAttempt {
  const tier = ANTE_UP_MINESWEEPER_TIERS[difficulty];
  return {
    difficulty,
    wager,
    multiplier: tier.multiplier,
    timeLimitMs: tier.timeLimitMs,
    board: startMinesweeperRound(difficulty, seed),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/**
 * When the clock runs out, or null if it has not started. The clock only runs
 * once the first cell is opened, so an attempt sitting on an untouched board
 * has no deadline to miss.
 */
export function anteUpMinesweeperDeadline(attempt: AnteUpMinesweeperAttempt): number | null {
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
export function tickAnteUpMinesweeper(
  attempt: AnteUpMinesweeperAttempt,
  now: Date,
): AnteUpMinesweeperAttempt | null {
  if (attempt.status !== "active") return null;
  const deadline = anteUpMinesweeperDeadline(attempt);
  if (deadline === null || now.getTime() < deadline) return null;
  return {
    ...attempt,
    board: resignMinesweeperRound(attempt.board, now),
    status: "timed-out",
  };
}

function guard(
  attempt: AnteUpMinesweeperAttempt,
  now: Date,
  problem: MinesweeperMoveProblem | null,
): MinesweeperMoveProblem | null {
  if (attempt.status !== "active") return "finished";
  const deadline = anteUpMinesweeperDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return "finished";
  return problem;
}

export function anteUpMinesweeperRevealProblem(
  attempt: AnteUpMinesweeperAttempt,
  index: number,
  now: Date,
): MinesweeperMoveProblem | null {
  return guard(attempt, now, minesweeperRevealProblem(attempt.board, index));
}

export function anteUpMinesweeperFlagProblem(
  attempt: AnteUpMinesweeperAttempt,
  index: number,
  now: Date,
): MinesweeperMoveProblem | null {
  return guard(attempt, now, minesweeperFlagProblem(attempt.board, index));
}

export function anteUpMinesweeperChordProblem(
  attempt: AnteUpMinesweeperAttempt,
  index: number,
  now: Date,
): MinesweeperMoveProblem | null {
  return guard(attempt, now, minesweeperChordProblem(attempt.board, index));
}

function afterMove(
  attempt: AnteUpMinesweeperAttempt,
  board: MinesweeperRound,
): AnteUpMinesweeperAttempt {
  if (board.status === "cleared") return { ...attempt, board, status: "won" };
  if (board.status === "lost") return { ...attempt, board, status: "lost" };
  return { ...attempt, board, status: "active" };
}

export function revealAnteUpMinesweeperCell(
  attempt: AnteUpMinesweeperAttempt,
  index: number,
  now: Date,
): AnteUpMinesweeperAttempt {
  if (anteUpMinesweeperRevealProblem(attempt, index, now)) return attempt;
  return afterMove(attempt, revealMinesweeperCell(attempt.board, index, now));
}

export function flagAnteUpMinesweeperCell(
  attempt: AnteUpMinesweeperAttempt,
  index: number,
  now: Date,
): AnteUpMinesweeperAttempt {
  if (anteUpMinesweeperFlagProblem(attempt, index, now)) return attempt;
  return { ...attempt, board: toggleMinesweeperFlag(attempt.board, index) };
}

export function chordAnteUpMinesweeperCell(
  attempt: AnteUpMinesweeperAttempt,
  index: number,
  now: Date,
): AnteUpMinesweeperAttempt {
  if (anteUpMinesweeperChordProblem(attempt, index, now)) return attempt;
  return afterMove(attempt, chordMinesweeperCell(attempt.board, index, now));
}

/** Gives up early. The wager is already spent -- this only records how it ended. */
export function resignAnteUpMinesweeper(
  attempt: AnteUpMinesweeperAttempt,
  now: Date,
): AnteUpMinesweeperAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, board: resignMinesweeperRound(attempt.board, now), status: "lost" };
}

/** What a WAGER win pays. Zero on anything else -- a loss or a timeout forfeits the wager. */
export function anteUpMinesweeperPayout(
  attempt: Pick<AnteUpMinesweeperAttempt, "wager" | "multiplier" | "status">,
): number {
  if (attempt.status !== "won") return 0;
  return Math.round(attempt.wager * attempt.multiplier);
}

export interface AnteUpMinesweeperSnapshot {
  id: string;
  version: number;
  difficulty: MinesweeperDifficulty;
  wager: number;
  multiplier: number;
  status: AnteUpMinesweeperStatus;
  /** Redacted -- carries no mine position while the round is live. */
  board: MinesweeperView;
  /**
   * When the clock runs out, or null until the first click starts it. Absolute
   * rather than a duration on purpose: the client ticks its own countdown once
   * a second, and a relative figure would freeze at whatever it said when the
   * snapshot was built.
   */
  expiresAt: string | null;
  /** Floored at zero. Null until the first click starts the clock. */
  msRemaining: number | null;
  timeLimitMs: number;
  elapsedMs: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpMinesweeperSnapshot(
  attempt: AnteUpMinesweeperAttempt,
  meta: { id: string; version: number },
  now: Date,
): AnteUpMinesweeperSnapshot {
  const deadline = anteUpMinesweeperDeadline(attempt);
  return {
    id: meta.id,
    version: meta.version,
    difficulty: attempt.difficulty,
    wager: attempt.wager,
    multiplier: attempt.multiplier,
    status: attempt.status,
    board: minesweeperView(attempt.board),
    expiresAt: deadline === null ? null : new Date(deadline).toISOString(),
    msRemaining:
      deadline === null
        ? null
        : attempt.status === "active"
          ? Math.max(0, deadline - now.getTime())
          : 0,
    timeLimitMs: attempt.timeLimitMs,
    elapsedMs: minesweeperElapsedMs(attempt.board, now),
    payout: anteUpMinesweeperPayout(attempt),
  };
}
