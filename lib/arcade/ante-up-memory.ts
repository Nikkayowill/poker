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
  memoryColumnsFor,
  memoryFlipProblem,
  memoryPairsOf,
  startMemoryRound,
  MEMORY_PAIRS,
  type MemoryFlipProblem,
  type MemoryRound,
} from "./puzzles/memory";
import { stakePressure, type StakePressure } from "./stake-pressure";
import type { RandomInt } from "@/lib/game/deck";
import type { Card } from "@/lib/game/types";

/** The floor for a wager. Restated per game; see ante-up-word-stack.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

/**
 * The turn cap for attempts stored before the cap was copied onto them.
 * New attempts carry their band's cap; see MEMORY_RULES_BY_PRESSURE.
 *
 * Still above PERFECT_TURNS (8), but no longer by so much that reaching it is
 * a formality: at 20 turns essentially every attempt cleared, which made this
 * cap decorative rather than the real loss condition the file header claims
 * it is.
 */
export const ANTE_UP_MEMORY_MAX_TURNS = 16;

/**
 * Win-only payout multiplier, keyed by turns taken, read off the attempt's own
 * ladder (the legacy one if it has none).
 *
 * The slow rungs pay **less than 1x on purpose**: a slow win returns less
 * than the wager, so clearing the board is not by itself profitable. Every
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
export function wagerMultiplierForTurns(
  turns: number,
  rungs: readonly MemoryPayoutRung[] = LEGACY_MEMORY_RUNGS,
): number {
  const rung = rungs.find((candidate) => turns <= candidate.upTo) ?? rungs[rungs.length - 1];
  return rung.multiplier;
}

/** One payout step: a win in `upTo` turns or fewer pays `multiplier` times the wager. */
export interface MemoryPayoutRung {
  upTo: number;
  multiplier: number;
}

/**
 * The ladder attempts opened before ladders were stored on them. Kept only so
 * those attempts settle at the rate they were promised.
 */
export const LEGACY_MEMORY_RUNGS: readonly MemoryPayoutRung[] = [
  { upTo: MEMORY_PAIRS, multiplier: 3 },
  { upTo: 10, multiplier: 2 },
  { upTo: 12, multiplier: 1.3 },
  { upTo: 14, multiplier: 0.9 },
  { upTo: 16, multiplier: 0.6 },
];

/** A stake band's board: how many pairs, the turn cap, and what each pace pays. */
export interface MemoryStakeRules {
  pairs: number;
  maxTurns: number;
  rungs: readonly MemoryPayoutRung[];
}

/**
 * Tuned by simulation, 60k boards per cell. Each player remembers at most C
 * face-down cards (Corsi-style span) and forgets each one with chance f every
 * turn: median C6 f.20, +1SD C7 f.12, +2SD C8 f.07, +3SD C9 f.04. The median
 * averages 16.4 turns on 8 pairs. "Profit" is a clear at a rung above 1x.
 *
 *   band (pairs, cap)  median        +1SD          +2SD          +3SD
 *   0 (8, 20)          71% 1.06x     95% 1.37x     100% 1.52x    100% 1.62x
 *   1 (10, 24)         20% 0.55x     56% 1.13x     87% 1.67x     98% 1.99x
 *   2 (12, 28)          4% 0.20x     23% 0.60x     61% 1.23x     89% 1.80x
 *   3 (15, 34)        0.3% 0.03x      4% 0.19x     24% 0.59x     62% 1.25x
 */
export const MEMORY_RULES_BY_PRESSURE: Readonly<Record<StakePressure, MemoryStakeRules>> = {
  0: {
    pairs: 8,
    maxTurns: 20,
    rungs: [
      { upTo: 12, multiplier: 2 },
      { upTo: 14, multiplier: 1.5 },
      { upTo: 17, multiplier: 1.2 },
      { upTo: 20, multiplier: 0.5 },
    ],
  },
  1: {
    pairs: 10,
    maxTurns: 24,
    rungs: [
      { upTo: 15, multiplier: 3 },
      { upTo: 17, multiplier: 2 },
      { upTo: 19, multiplier: 1.5 },
      { upTo: 24, multiplier: 0.4 },
    ],
  },
  2: {
    pairs: 12,
    maxTurns: 28,
    rungs: [
      { upTo: 18, multiplier: 3 },
      { upTo: 20, multiplier: 2.2 },
      { upTo: 22, multiplier: 1.6 },
      { upTo: 28, multiplier: 0.3 },
    ],
  },
  3: {
    pairs: 15,
    maxTurns: 34,
    rungs: [
      { upTo: 22, multiplier: 3.5 },
      { upTo: 24, multiplier: 2.5 },
      { upTo: 27, multiplier: 1.8 },
      { upTo: 34, multiplier: 0.2 },
    ],
  },
};

export function memoryStakeRules(wager: number): MemoryStakeRules {
  return MEMORY_RULES_BY_PRESSURE[stakePressure(wager)];
}

/** Lobby lines for each stake band; see components/arcade/stake-pressure-note.tsx. */
export const MEMORY_PRESSURE_RULES = {
  1: ["10 pairs on a 5 by 4 board, 24 turns to clear it.", "Profit needs 19 turns or fewer."],
  2: ["12 pairs on a 6 by 4 board, 28 turns to clear it.", "Profit needs 22 turns or fewer."],
  3: [
    "15 pairs on a 6 by 5 board, 34 turns to clear it.",
    "Aces and kings come as a black pair and a red pair, so colour has to match too.",
    "Profit needs 27 turns or fewer.",
  ],
} as const;

export type AnteUpMemoryStatus = "active" | "won" | "lost";

export interface AnteUpMemoryAttempt {
  /** Already debited by the time an attempt exists; see the service. */
  wager: number;
  board: MemoryRound;
  status: AnteUpMemoryStatus;
  startedAt: string;
  /**
   * Copied from the stake band's rules when the attempt opens, not re-read
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
  /**
   * The payout ladder, copied on at open for the same reason as maxTurns.
   * Attempts stored before this field existed use LEGACY_MEMORY_RUNGS.
   */
  rungs?: readonly MemoryPayoutRung[];
}

function attemptRungs(attempt: Pick<AnteUpMemoryAttempt, "rungs">): readonly MemoryPayoutRung[] {
  return attempt.rungs ?? LEGACY_MEMORY_RUNGS;
}

/** The turn cap this attempt was opened under, not whatever it is today. */
function attemptMaxTurns(attempt: Pick<AnteUpMemoryAttempt, "maxTurns">): number {
  return attempt.maxTurns ?? ANTE_UP_MEMORY_MAX_TURNS;
}

/**
 * A fresh attempt: `randomInt` deals a board never shown as the shared daily
 * layout; see the file header. The wager's stake band picks the board size,
 * turn cap and payout ladder, all copied onto the attempt.
 */
export function startAnteUpMemory(randomInt: RandomInt, wager: number, now: Date): AnteUpMemoryAttempt {
  const rules = memoryStakeRules(wager);
  return {
    wager,
    board: startMemoryRound(dealMemoryTiles(randomInt, rules.pairs), now),
    status: "active",
    startedAt: now.toISOString(),
    maxTurns: rules.maxTurns,
    rungs: rules.rungs,
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
  // >=, not >: the cap is how many turns you GET, so the turn that reaches
  // it without solving the board is the one that forfeits. `>` let a player
  // take one turn past the advertised cap before losing, and left
  // `turnsLeft` reading "0 turns left" while a flip was still legal.
  if (board.turns >= attemptMaxTurns(attempt)) return { ...attempt, board, status: "lost" };
  return { ...attempt, board, status: "active" };
}

/** Gives up early. The wager is already spent; this only records how it ended. */
export function resignAnteUpMemory(attempt: AnteUpMemoryAttempt): AnteUpMemoryAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost" };
}

/** What a wager win pays. Zero on anything but a win; the wager is forfeit on a loss or a turn-cap timeout. */
export function anteUpMemoryPayout(attempt: Pick<AnteUpMemoryAttempt, "wager" | "board" | "rungs">): number {
  if (attempt.board.status !== "solved") return 0;
  return Math.round(attempt.wager * wagerMultiplierForTurns(attempt.board.turns, attemptRungs(attempt)));
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
  /** The payout ladder this attempt was opened with, so the board can project a live payout. */
  rungs: MemoryPayoutRung[];
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
    pairs: memoryPairsOf(round),
    columns: memoryColumnsFor(memoryPairsOf(round)),
    perfectTurns: memoryPairsOf(round),
    rungs: attemptRungs(attempt).map((rung) => ({ ...rung })),
    payout: anteUpMemoryPayout(attempt),
  };
}
