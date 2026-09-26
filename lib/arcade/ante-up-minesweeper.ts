/**
 * Minesweeper: a solo skill wager, or free practice, any time.
 *
 * Wager Gold, clear a fresh board inside the tier's clock, cash out a multiple
 * of the wager. Same shape as lib/arcade/ante-up.ts (Sudoku): the multiplier is
 * fixed per difficulty and copied onto the attempt when it opens, so a player
 * knows exactly what they are playing for before the Gold leaves.
 *
 * There is a clock because lib/arcade/puzzles/minesweeper.ts guarantees every
 * board can be finished by logic alone, no coin flips. That is the right call
 * for a game staking real Gold, but it also means a careful player never *has*
 * to hit a mine, so the natural loss condition alone is a weak risk: the only
 * way to lose is a careless click, and unlimited time removes even that
 * pressure. The per-tier clock is what keeps a wagered attempt a real bet, the
 * same job ANTE_UP_MEMORY_MAX_TURNS does for Memory Match, and it also stops
 * an abandoned attempt from holding the player's one active slot forever.
 *
 * Free play and small stakes get limits above real solve times. From 10k up
 * the clock is set so a player at that band's level of skill usually makes
 * it and most others don't; see ANTE_UP_MINESWEEPER_TIERS. A beginner
 * board with five minutes on it was a certain win, and a certain win paying
 * 1.5x is a money printer at whatever size the player can stake. The clocks
 * below are tighter and the multipliers lower for that reason, and a big
 * stake has to be played on a bigger board (lib/arcade/ante-up-stakes.ts).
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
import { stakePressure } from "./stake-pressure";

/** The floor for a wager. Restated per game; see ante-up-memory.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

export interface AnteUpMinesweeperTier {
  /**
   * For free play and stakes under 10k. Measured from the first click, not
   * from opening the attempt; see the round's own clock.
   */
  readonly timeLimitMs: number;
  /** From 10k up, where each band is set for a stronger player. */
  readonly rankedTimeLimitMs: number;
  readonly multiplier: number;
}

/**
 * Clocks come from a skill model, not from solve-rate data we don't have yet
 * (lib/arcade/ante-up-calibration.test.ts holds it and checks the targets).
 * A median player's time on a phone is taken from published desktop
 * benchmarks (casual beginner about 90s, intermediate 150-300s), scaled to
 * our boards by their work and a 1.3x touch penalty: beginner 90s,
 * intermediate 175s, expert 330s, master 410s. Log-normal, sigma 0.3. Each
 * standard deviation of skill is 1.8x faster, since published skill tiers
 * roughly halve the time each step. A careless click loses the board: 15-40%
 * of the time for a median player, halving per standard deviation.
 *
 * Win rate on the easiest board each stake band allows, by player:
 *
 *   band (floor board, clock)       median   +1SD   +2SD   +3SD
 *   <10k   (beginner, 3:00)           84%     92%     96%    98%
 *   10k+   (intermediate, 2:00)        8%     66%     93%    97%
 *   100k+  (expert, 2:30)             0%     21%     82%    96%
 *   1M+    (master, 1:40)             0%      0%     19%    84%
 *
 * Free play and small stakes keep the old roomy clocks, so anyone can still
 * finish a big board for fun. Retune here once real attempts give solve rates.
 */
export const ANTE_UP_MINESWEEPER_TIERS: Readonly<
  Record<MinesweeperDifficulty, AnteUpMinesweeperTier>
> = {
  beginner: { timeLimitMs: 3 * 60_000, rankedTimeLimitMs: 3 * 60_000, multiplier: 1.1 },
  intermediate: { timeLimitMs: 5 * 60_000, rankedTimeLimitMs: 2 * 60_000, multiplier: 1.8 },
  expert: { timeLimitMs: 10 * 60_000, rankedTimeLimitMs: 150_000, multiplier: 3 },
  master: { timeLimitMs: 12 * 60_000, rankedTimeLimitMs: 100_000, multiplier: 4.5 },
};

/** The clock a board runs at this stake. Fixed on the attempt when it opens. */
export function anteUpMinesweeperTimeLimitMs(difficulty: MinesweeperDifficulty, wager: number): number {
  const tier = ANTE_UP_MINESWEEPER_TIERS[difficulty];
  return stakePressure(wager) >= 1 ? tier.rankedTimeLimitMs : tier.timeLimitMs;
}

export type AnteUpMinesweeperStatus = "active" | "won" | "lost" | "timed-out";

export interface AnteUpMinesweeperAttempt {
  difficulty: MinesweeperDifficulty;
  /** Already debited by the time an attempt exists; see the service. */
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
    timeLimitMs: anteUpMinesweeperTimeLimitMs(difficulty, wager),
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

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignAnteUpMinesweeper(
  attempt: AnteUpMinesweeperAttempt,
  now: Date,
): AnteUpMinesweeperAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, board: resignMinesweeperRound(attempt.board, now), status: "lost" };
}

/** What a wager win pays. Zero on anything else; a loss or a timeout forfeits the wager. */
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
  /** Redacted; carries no mine position while the round is live. */
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
