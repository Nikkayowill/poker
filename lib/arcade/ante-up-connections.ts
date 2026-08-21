/**
 * Connections' Gold-payout scoring -- shared by the one place Connections
 * ever pays Gold: a wager on the shared daily board at /games/connections.
 *
 * This used to also run a second, always-replayable "Ante Up: Connections"
 * game on a fresh (non-daily) puzzle -- cut the same day it shipped, for the
 * same reason and at the same time as Word Stack's equivalent. See
 * ante-up-word-stack.ts's header for the full reasoning; it applies here
 * unchanged. What is left is pure scoring math, used by
 * lib/server/connections-service.ts.
 */

import type { ConnectionsRound } from "./puzzles/connections";

/** The floor for a wager. Restated per game -- see ante-up-word-stack.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

/** Win-only payout multiplier, keyed by mistakes made. Starting numbers, easy to retune here. */
const WAGER_MULTIPLIER_BY_MISTAKES: Readonly<Record<number, number>> = {
  0: 8, 1: 5, 2: 3, 3: 1.5,
};

/** Always-pays multiplier for the shared daily board's completion bonus. A loss still floors at 1.0x. */
const DAILY_BONUS_MULTIPLIER_BY_MISTAKES: Readonly<Record<number, number>> = {
  0: 3.0, 1: 2.0, 2: 1.5, 3: 1.1,
};

/** What a WAGER win pays. Zero on anything but a win -- the wager is forfeit on a loss. */
export function anteUpConnectionsPayout(input: {
  wager: number;
  puzzle: Pick<ConnectionsRound, "status" | "mistakes">;
}): number {
  if (input.puzzle.status !== "won") return 0;
  const multiplier = WAGER_MULTIPLIER_BY_MISTAKES[input.puzzle.mistakes] ?? 1.5;
  return Math.round(input.wager * multiplier);
}

/**
 * What the shared daily board's completion bonus pays, as a multiplier on
 * DAILY_BONUS_BASE (lib/server/daily-puzzle-bonus.ts). Always at least 1.0 --
 * a lost daily attempt still pays the floor, matching how the retired flat
 * mission paid on any completion. Only call this once `round.status !== "active"`.
 */
export function connectionsDailyBonusMultiplier(round: Pick<ConnectionsRound, "status" | "mistakes">): number {
  if (round.status === "lost") return 1.0;
  return DAILY_BONUS_MULTIPLIER_BY_MISTAKES[round.mistakes] ?? 1.0;
}
