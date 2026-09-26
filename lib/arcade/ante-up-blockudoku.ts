/**
 * Blockudoku: a solo skill wager, or free practice, any time.
 *
 * Same shape as lib/arcade/ante-up-minesweeper.ts: wager Gold, beat the
 * tier's challenge inside its clock, cash out a multiple of the wager. The
 * puzzle itself has no natural "cleared" state the way a minefield does --
 * it is score-attack until the board jams -- so the challenge here is a
 * target score instead of an empty board. A player wins by reaching it
 * before the piece supply jams the board or the clock runs out; either of
 * those without the target reached is a loss.
 *
 * The clock starts on the first placement, not on opening the attempt, for
 * the same reason Minesweeper's does: a player should not be charged clock
 * time for staring at an empty board deciding where to start.
 */

import {
  blockudokuElapsedMs,
  blockudokuPlacementProblem,
  blockudokuView,
  placeBlockudokuPiece,
  resignBlockudokuRound,
  startBlockudokuRound,
  type BlockudokuMoveProblem,
  type BlockudokuRound,
  type BlockudokuView,
} from "./puzzles/blockudoku";

/** The floor for a wager. Restated per game; see ante-up-memory.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

export type BlockudokuDifficulty = "casual" | "standard" | "hardcore";

export interface AnteUpBlockudokuTier {
  readonly targetScore: number;
  /** Measured from the first placement, not from opening the attempt; see the round's own clock. */
  readonly timeLimitMs: number;
  readonly multiplier: number;
}

/** Starting numbers, not tuned against real play rates; retune here. */
export const ANTE_UP_BLOCKUDOKU_TIERS: Readonly<Record<BlockudokuDifficulty, AnteUpBlockudokuTier>> = {
  casual: { targetScore: 150, timeLimitMs: 5 * 60 * 1000, multiplier: 1.2 },
  standard: { targetScore: 350, timeLimitMs: 8 * 60 * 1000, multiplier: 2 },
  hardcore: { targetScore: 700, timeLimitMs: 12 * 60 * 1000, multiplier: 3.5 },
};

export function isBlockudokuDifficulty(value: unknown): value is BlockudokuDifficulty {
  return value === "casual" || value === "standard" || value === "hardcore";
}

export type AnteUpBlockudokuStatus = "active" | "won" | "lost" | "timed-out";

export interface AnteUpBlockudokuAttempt {
  difficulty: BlockudokuDifficulty;
  /** Already debited by the time an attempt exists; see the service. */
  wager: number;
  /** Copied from the tier at open, never re-read at settlement. */
  multiplier: number;
  targetScore: number;
  timeLimitMs: number;
  board: BlockudokuRound;
  status: AnteUpBlockudokuStatus;
  startedAt: string;
}

export function startAnteUpBlockudoku(
  difficulty: BlockudokuDifficulty,
  wager: number,
  seed: number,
  now: Date,
): AnteUpBlockudokuAttempt {
  const tier = ANTE_UP_BLOCKUDOKU_TIERS[difficulty];
  return {
    difficulty,
    wager,
    multiplier: tier.multiplier,
    targetScore: tier.targetScore,
    timeLimitMs: tier.timeLimitMs,
    board: startBlockudokuRound(seed),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/**
 * When the clock runs out, or null if it has not started. The clock only
 * runs once the first piece is placed, so an attempt sitting on an empty
 * board has no deadline to miss.
 */
export function anteUpBlockudokuDeadline(attempt: AnteUpBlockudokuAttempt): number | null {
  if (!attempt.board.startedAt) return null;
  return Date.parse(attempt.board.startedAt) + attempt.timeLimitMs;
}

/**
 * Settles an attempt whose clock has expired.
 *
 * Returns null when nothing changed, same contract as
 * tickAnteUpMinesweeper: the client polls this while a board is live, and a
 * tick that always returned a new object would bump the stored version on
 * every poll and livelock the optimistic concurrency guard against the
 * player's own moves. If the target score had already been reached the
 * attempt would already be `won` by the time this runs -- see `afterMove`
 * below -- so a still-`active` attempt hitting its deadline is always a
 * miss, never a race with the win.
 */
export function tickAnteUpBlockudoku(
  attempt: AnteUpBlockudokuAttempt,
  now: Date,
): AnteUpBlockudokuAttempt | null {
  if (attempt.status !== "active") return null;
  const deadline = anteUpBlockudokuDeadline(attempt);
  if (deadline === null || now.getTime() < deadline) return null;
  return {
    ...attempt,
    board: resignBlockudokuRound(attempt.board, now),
    status: "timed-out",
  };
}

function guard(
  attempt: AnteUpBlockudokuAttempt,
  now: Date,
  problem: BlockudokuMoveProblem | null,
): BlockudokuMoveProblem | null {
  if (attempt.status !== "active") return "finished";
  const deadline = anteUpBlockudokuDeadline(attempt);
  if (deadline !== null && now.getTime() >= deadline) return "finished";
  return problem;
}

export function anteUpBlockudokuPlacementProblem(
  attempt: AnteUpBlockudokuAttempt,
  slot: number,
  anchorRow: number,
  anchorCol: number,
  now: Date,
): BlockudokuMoveProblem | null {
  return guard(attempt, now, blockudokuPlacementProblem(attempt.board, slot, anchorRow, anchorCol));
}

/** Win outranks jam: reaching the target and jamming the board on the same placement is still a win. */
function afterMove(
  attempt: AnteUpBlockudokuAttempt,
  board: BlockudokuRound,
): AnteUpBlockudokuAttempt {
  if (board.score >= attempt.targetScore) return { ...attempt, board, status: "won" };
  if (board.status === "over") return { ...attempt, board, status: "lost" };
  return { ...attempt, board, status: "active" };
}

export function placeAnteUpBlockudokuPiece(
  attempt: AnteUpBlockudokuAttempt,
  slot: number,
  anchorRow: number,
  anchorCol: number,
  now: Date,
  entropy = 0,
): AnteUpBlockudokuAttempt {
  if (anteUpBlockudokuPlacementProblem(attempt, slot, anchorRow, anchorCol, now)) return attempt;
  return afterMove(attempt, placeBlockudokuPiece(attempt.board, slot, anchorRow, anchorCol, now, entropy));
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignAnteUpBlockudoku(
  attempt: AnteUpBlockudokuAttempt,
  now: Date,
): AnteUpBlockudokuAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, board: resignBlockudokuRound(attempt.board, now), status: "lost" };
}

/** What a wager win pays. Zero on anything else; a loss or a timeout forfeits the wager. */
export function anteUpBlockudokuPayout(
  attempt: Pick<AnteUpBlockudokuAttempt, "wager" | "multiplier" | "status">,
): number {
  if (attempt.status !== "won") return 0;
  return Math.round(attempt.wager * attempt.multiplier);
}

export interface AnteUpBlockudokuSnapshot {
  id: string;
  version: number;
  difficulty: BlockudokuDifficulty;
  wager: number;
  multiplier: number;
  targetScore: number;
  status: AnteUpBlockudokuStatus;
  board: BlockudokuView;
  /** When the clock runs out, or null until the first placement starts it. Absolute, not a duration; see ante-up-minesweeper.ts's own note. */
  expiresAt: string | null;
  /** Floored at zero. Null until the first placement starts the clock. */
  msRemaining: number | null;
  timeLimitMs: number;
  elapsedMs: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpBlockudokuSnapshot(
  attempt: AnteUpBlockudokuAttempt,
  meta: { id: string; version: number },
  now: Date,
): AnteUpBlockudokuSnapshot {
  const deadline = anteUpBlockudokuDeadline(attempt);
  return {
    id: meta.id,
    version: meta.version,
    difficulty: attempt.difficulty,
    wager: attempt.wager,
    multiplier: attempt.multiplier,
    targetScore: attempt.targetScore,
    status: attempt.status,
    board: blockudokuView(attempt.board),
    expiresAt: deadline === null ? null : new Date(deadline).toISOString(),
    msRemaining:
      deadline === null
        ? null
        : attempt.status === "active"
          ? Math.max(0, deadline - now.getTime())
          : 0,
    timeLimitMs: attempt.timeLimitMs,
    elapsedMs: blockudokuElapsedMs(attempt.board, now),
    payout: anteUpBlockudokuPayout(attempt),
  };
}
