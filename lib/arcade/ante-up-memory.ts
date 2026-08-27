/**
 * Memory Match: a solo skill wager, or free practice, any time.
 *
 * Wager Gold, clear a fresh board, cash out a multiple of the wager if you
 * clear it inside the turn cap. Memory kept its full engine (rather than
 * being trimmed to scoring-only, the way Word Stack and Connections were)
 * because it never had a daily identity worth protecting: no shared board,
 * no shareable grid, so there was nothing to keep separate. /games/memory
 * renders this directly, unlimited, with no daily gate.
 *
 * Unlike Word Stack and Connections, Memory Match has no natural loss
 * condition: lib/arcade/puzzles/memory.ts's board always eventually clears,
 * given enough turns. The other two games already have a real "ran out of
 * tries" ending to hang a wager's forfeit on; Memory doesn't, so wagering on
 * it as-is would be risk-free. `ANTE_UP_MEMORY_MAX_TURNS` is the invented
 * failure condition: a wager attempt that exceeds it forfeits, same as
 * running out of guesses does at the other two games. The cap applies
 * whether or not the attempt is wagered, since it's this game's actual
 * challenge and not merely a wager's risk gate, so a free attempt can still
 * "run out of turns" the same as a wagered one; only the payout is gated on
 * wager > 0.
 */

import {
  dealMemoryTiles,
  flipMemoryTile,
  memoryFlipProblem,
  startMemoryRound,
  MEMORY_COLUMNS,
  MEMORY_PAIRS,
  PERFECT_TURNS,
  type MemoryFlipProblem,
  type MemoryRound,
} from "./puzzles/memory";
import type { RandomInt } from "@/lib/game/deck";
import type { Card } from "@/lib/game/types";

/** The floor for a wager. Restated per game; see ante-up-word-stack.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

/**
 * Turns a wagered attempt may take before it forfeits. Daily/free play is
 * never capped; see the file header.
 *
 * Still above PERFECT_TURNS (8), but no longer by so much that reaching it is
 * a formality: at 20 turns essentially every attempt cleared, which made this
 * cap decorative rather than the real loss condition the file header claims
 * it is.
 */
export const ANTE_UP_MEMORY_MAX_TURNS = 16;

/**
 * Win-only payout multiplier, keyed by turns taken. Starting numbers, easy to
 * retune here.
 *
 * The slow rungs pay **less than 1x on purpose**: a win at 15 turns returns
 * 0.6x the wager, so clearing the board is not by itself profitable. Every
 * rung used to pay above 1x, which meant any win at all made money and the
 * only way to lose Gold was to miss the cap entirely -- with the cap set as
 * loosely as it was, that made a wagered attempt close to risk-free, and a
 * risk-free wager compounds without bound. Speed is the skill this game
 * actually tests, so speed is what has to be paid for.
 *
 * Exported, not just used internally by anteUpMemoryPayout below, because the
 * board's own payout field is 0 for the entire game (it only becomes real
 * once `status` is "solved", see anteUpMemoryPayout), so it can't drive a
 * live "cash out ~X right now" figure during play. This is the same formula,
 * just callable against the turn count a live attempt already exposes.
 */
export function wagerMultiplierForTurns(turns: number): number {
  if (turns <= MEMORY_PAIRS) return 3;
  if (turns <= 10) return 2;
  if (turns <= 12) return 1.3;
  if (turns <= 14) return 0.9;
  return 0.6; // 15-16: a win, but a slow one, and it costs you. Anything slower forfeits.
}

export type AnteUpMemoryStatus = "active" | "won" | "lost";

export interface AnteUpMemoryAttempt {
  /** Already debited by the time an attempt exists; see the service. */
  wager: number;
  board: MemoryRound;
  status: AnteUpMemoryStatus;
  startedAt: string;
  /**
   * Copied from ANTE_UP_MEMORY_MAX_TURNS when the attempt opens, not re-read
   * at settlement -- the same rule AnteUpAttempt's `multiplier` and
   * AnteUpMinesweeperAttempt's `timeLimitMs` follow, and for a sharper reason
   * here: this number is a forfeit condition. Retuning the constant while an
   * attempt is live would otherwise decide, retroactively, that a player has
   * already lost turns they were promised, and take a wager for a move that
   * was legal when they made it.
   *
   * Optional for rows written before this field existed; readers fall back to
   * the constant via attemptMaxTurns below.
   */
  maxTurns?: number;
}

/** The turn cap this attempt was opened under, not whatever it is today. */
export function attemptMaxTurns(attempt: Pick<AnteUpMemoryAttempt, "maxTurns">): number {
  return attempt.maxTurns ?? ANTE_UP_MEMORY_MAX_TURNS;
}

/** A fresh attempt: `randomInt` deals a board never shown as the shared daily layout; see the file header. */
export function startAnteUpMemory(randomInt: RandomInt, wager: number, now: Date): AnteUpMemoryAttempt {
  return {
    wager,
    board: startMemoryRound(dealMemoryTiles(randomInt), now),
    status: "active",
    startedAt: now.toISOString(),
    maxTurns: ANTE_UP_MEMORY_MAX_TURNS,
  };
}

/** Why a flip cannot be made, or null if it can. */
export function anteUpMemoryFlipProblem(attempt: AnteUpMemoryAttempt, index: number): MemoryFlipProblem | null {
  if (attempt.status !== "active") return "finished";
  return memoryFlipProblem(attempt.board, index);
}

/**
 * Turns a tile over. A cleared board becomes a win; exceeding
 * ANTE_UP_MEMORY_MAX_TURNS becomes a forfeit; see the file header for why
 * that cap exists at all.
 */
export function flipAnteUpMemoryTile(attempt: AnteUpMemoryAttempt, index: number, now: Date): AnteUpMemoryAttempt {
  if (anteUpMemoryFlipProblem(attempt, index)) return attempt;

  const board = flipMemoryTile(attempt.board, index, now);
  if (board.status === "solved") return { ...attempt, board, status: "won" };
  if (board.turns > attemptMaxTurns(attempt)) return { ...attempt, board, status: "lost" };
  return { ...attempt, board, status: "active" };
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignAnteUpMemory(attempt: AnteUpMemoryAttempt): AnteUpMemoryAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost" };
}

/** What a wager win pays. Zero on anything but a win; the wager is forfeit on a loss or a turn-cap timeout. */
export function anteUpMemoryPayout(attempt: Pick<AnteUpMemoryAttempt, "wager" | "board">): number {
  if (attempt.board.status !== "solved") return 0;
  return Math.round(attempt.wager * wagerMultiplierForTurns(attempt.board.turns));
}

/**
 * The attempt as the browser may see it. `board` holds a card only where one
 * is genuinely face up, the same redaction toMemorySnapshot applies and for
 * the same reason: a client with the layout wins in eight turns every time.
 */
export interface AnteUpMemorySnapshot {
  id: string;
  wager: number;
  version: number;
  status: AnteUpMemoryStatus;
  board: (Card | null)[];
  matched: number[];
  revealed: number[];
  turns: number;
  maxTurns: number;
  pairs: number;
  columns: number;
  perfectTurns: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpMemorySnapshot(
  attempt: AnteUpMemoryAttempt,
  meta: { id: string; version: number },
): AnteUpMemorySnapshot {
  const round = attempt.board;
  const shown = new Set([...round.matched, ...round.revealed]);
  return {
    id: meta.id,
    wager: attempt.wager,
    version: meta.version,
    status: attempt.status,
    board: round.tiles.map((card, index) => (shown.has(index) ? { ...card } : null)),
    matched: [...round.matched],
    revealed: [...round.revealed],
    turns: round.turns,
    maxTurns: attemptMaxTurns(attempt),
    pairs: MEMORY_PAIRS,
    columns: MEMORY_COLUMNS,
    perfectTurns: PERFECT_TURNS,
    payout: anteUpMemoryPayout(attempt),
  };
}
