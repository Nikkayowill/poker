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
import { CONNECTIONS_MAX_MISTAKES, type ConnectionsRound } from "./puzzles/connections";
import { stakePressure, type StakePressure } from "./stake-pressure";

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

/**
 * How many mistakes end a round at each stake band: 4, 3, 2, then 1. From
 * band 1 up only a clean solve profits, and less room to fish for groups by
 * trial and error is what makes the band harder.
 */
export const CONNECTIONS_MISTAKES_BY_PRESSURE: Readonly<Record<StakePressure, number>> = {
  0: CONNECTIONS_MAX_MISTAKES,
  1: 3,
  2: 2,
  3: 1,
};

/**
 * Each stake band's ladder. WAGER_MULTIPLIER_BY_MISTAKES above stays as the
 * fallback for rounds stored without one.
 *
 * Calibration. Assumed mistakes per board (0/1/2/3/4+), no public percentile
 * data exists: median 20/20/17/13/30%, +1SD 40/25/15/8/12%, +2SD
 * 60/22/10/4/4%, +3SD 78/15/5/1.5/0.5%.
 *
 *   player   band0 profit/EV  band1        band2        band3
 *   median     70% 1.26x      20% 0.77x    20% 0.50x    20% 0.32x
 *   +1SD       88% 1.86x      40% 1.44x    40% 0.96x    40% 0.64x
 *   +2SD       96% 2.31x      60% 2.05x    60% 1.39x    60% 0.96x
 *   +3SD      100% 2.66x      78% 2.58x    78% 1.76x    78% 1.25x
 *
 * A single board can't separate the percentiles by win rate (a clean solve
 * is the finest skill signal it gives), so the clean-solve multiple falls
 * about 0.7x per band to put the 1x break-even at that band's target.
 */
export const CONNECTIONS_LADDER_BY_PRESSURE: Readonly<Record<StakePressure, WagerLadder>> = {
  0: { 0: 3, 1: 1.6, 2: 1.2, 3: 1.05 },
  1: { 0: 3.2, 1: 0.5, 2: 0.2 },
  2: { 0: 2.2, 1: 0.3 },
  3: { 0: 1.6 },
};

/** What a wager's stake band sets for its round. Copied onto the round at open. */
export interface ConnectionsStakeRules {
  maxMistakes: number;
  ladder: WagerLadder;
}

export function connectionsStakeRules(wager: number): ConnectionsStakeRules {
  const pressure = stakePressure(wager);
  return {
    maxMistakes: CONNECTIONS_MISTAKES_BY_PRESSURE[pressure],
    ladder: CONNECTIONS_LADDER_BY_PRESSURE[pressure],
  };
}

/** Lobby lines for each stake band; see components/arcade/stake-pressure-note.tsx. */
export const CONNECTIONS_PRESSURE_RULES = {
  1: ["3 mistakes end the board instead of 4.", "Only a clean solve profits: 3.2x. One mistake pays back 0.5x."],
  2: ["2 mistakes end the board instead of 4.", "Only a clean solve profits: 2.2x. One mistake pays back 0.3x."],
  3: ["One mistake ends the board.", "A clean solve pays 1.6x."],
} as const;

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
    // The top-stake ladder names fewer rungs, so the floor follows its lowest.
    Math.min(CONNECTIONS_LADDER_FLOOR, ...Object.values(input.ladder ?? {})),
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
