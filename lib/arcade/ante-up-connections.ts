/**
 * Connections' Gold-payout scoring: shared by the one place Connections
 * ever pays Gold, a wager on the shared daily board at /games/connections.
 *
 * A second, always-replayable "Ante Up: Connections" game on a fresh
 * (non-daily) puzzle shipped and was later removed, for the same reason as
 * Word Stack's equivalent. See ante-up-word-stack.ts's header for the full
 * reasoning; it applies here unchanged. What's left is pure scoring math,
 * used by lib/server/connections-service.ts.
 */

import { ladderMultiplier, type WagerLadder } from "./ante-up-ladder";
import type { ConnectionsRound } from "./puzzles/connections";

/** The floor for a wager. Restated per game; see ante-up-word-stack.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

/**
 * Win-only payout multiplier, keyed by mistakes made. Starting numbers, easy
 * to retune here.
 *
 * A 3-mistake win pays below 1x on purpose, for the same reason Word Stack's
 * 6-guess rung does: solving on the last life left is the outcome closest to
 * losing, and paying a premium for it made every win profitable and the wager
 * close to risk-free. A clean 4-for-4 grid is still the point of the game, so
 * it keeps the largest multiple by a wide margin.
 */
export const WAGER_MULTIPLIER_BY_MISTAKES: WagerLadder = {
  0: 4, 1: 2.2, 2: 1.2, 3: 0.6,
};

/** The lowest rung, and so the payout for a mistake count the ladder does not name. */
export const CONNECTIONS_LADDER_FLOOR = 0.6;

/** Always-pays multiplier for the shared daily board's completion bonus. A loss still floors at 1.0x. */
const DAILY_BONUS_MULTIPLIER_BY_MISTAKES: Readonly<Record<number, number>> = {
  0: 3.0, 1: 2.0, 2: 1.5, 3: 1.1,
};

/** What a wager win pays. Zero on anything but a win; the wager is forfeit on a loss. */
export function anteUpConnectionsPayout(input: {
  wager: number;
  puzzle: Pick<ConnectionsRound, "status" | "mistakes">;
  /** The ladder this round was opened under; see lib/arcade/ante-up-ladder.ts. */
  ladder?: WagerLadder;
}): number {
  if (input.puzzle.status !== "won") return 0;
  const multiplier = ladderMultiplier(
    input.ladder,
    WAGER_MULTIPLIER_BY_MISTAKES,
    input.puzzle.mistakes,
    CONNECTIONS_LADDER_FLOOR,
  );
  return Math.round(input.wager * multiplier);
}

/**
 * What the shared daily board's completion bonus pays, as a multiplier on
 * DAILY_BONUS_BASE (lib/server/daily-puzzle-bonus.ts). Always at least 1.0:
 * a lost daily attempt still pays the floor, matching how the retired flat
 * mission paid on any completion. Only call this once `round.status !== "active"`.
 */
export function connectionsDailyBonusMultiplier(round: Pick<ConnectionsRound, "status" | "mistakes">): number {
  if (round.status === "lost") return 1.0;
  return DAILY_BONUS_MULTIPLIER_BY_MISTAKES[round.mistakes] ?? 1.0;
}
