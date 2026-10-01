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

import { ladderMultiplier, scaleLadder, type WagerLadder } from "./ante-up-ladder";
import { CONNECTIONS_MAX_MISTAKES, type ConnectionsRound } from "./puzzles/connections";
import { MIN_WIN_MULTIPLIER, STAKE_PRESSURES, stakePressure, type StakePressure } from "./stake-pressure";

/** The floor for a wager. Restated per game; see ante-up-word-stack.ts's MIN_ANTE_UP_WAGER for why. */
export const MIN_ANTE_UP_WAGER = 500;

/**
 * Win-only payout multiplier, keyed by mistakes made. Starting numbers, easy
 * to retune here.
 *
 * Every win pays back more than the stake, even a 3-mistake solve, for the
 * same reason as Word Stack's 6-guess rung. A clean 4-for-4 grid is still the
 * point of the game, so it keeps the largest multiple by a wide margin.
 */
export const WAGER_MULTIPLIER_BY_MISTAKES: WagerLadder = {
  0: 4, 1: 2.2, 2: 1.5, 3: 1.15,
};

/**
 * How many mistakes end a round at each stake band: 4, 3, 2, 2, then 1. From
 * Medium up there is less room to fish for groups by trial and error, which
 * is what makes the band harder. Elite keeps Hard's two lives; what it adds is
 * a bigger payout.
 */
export const CONNECTIONS_MISTAKES_BY_PRESSURE: Readonly<Record<StakePressure, number>> = {
  0: CONNECTIONS_MAX_MISTAKES,
  1: 3,
  2: 2,
  3: 2,
  4: 1,
};

/**
 * Each stake band's ladder: WAGER_MULTIPLIER_BY_MISTAKES scaled for the band,
 * with a rung only for each mistake count the band's lives still allow. Easy
 * barely pays and every band above pays a bigger gain. Every rung is above
 * 1x: solving the grid never costs Gold, and the risk in a wager is running
 * out of lives.
 */
export const CONNECTIONS_LADDER_BY_PRESSURE: Readonly<Record<StakePressure, WagerLadder>> = Object.fromEntries(
  STAKE_PRESSURES.map((pressure) => {
    const scaled = scaleLadder(WAGER_MULTIPLIER_BY_MISTAKES, pressure);
    const lives = CONNECTIONS_MISTAKES_BY_PRESSURE[pressure];
    return [pressure, Object.fromEntries(Object.entries(scaled).filter(([mistakes]) => Number(mistakes) < lives))];
  }),
) as Record<StakePressure, WagerLadder>;

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
function payLine(pressure: StakePressure): string {
  const ladder = CONNECTIONS_LADDER_BY_PRESSURE[pressure];
  const later = Object.keys(ladder).length > 1 ? ` One mistake pays ${ladder[1]}x.` : "";
  return `Any win pays back more than you staked. A clean solve pays ${ladder[0]}x.${later}`;
}

export const CONNECTIONS_PRESSURE_RULES = {
  1: ["3 mistakes end the board instead of 4.", payLine(1)],
  2: ["2 mistakes end the board instead of 4.", payLine(2)],
  3: ["2 mistakes end the board instead of 4.", payLine(3)],
  4: ["One mistake ends the board.", payLine(4)],
} as const;

/** The payout for a mistake count the ladder does not name: the least any win pays. */
export const CONNECTIONS_LADDER_FLOOR = MIN_WIN_MULTIPLIER;

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
