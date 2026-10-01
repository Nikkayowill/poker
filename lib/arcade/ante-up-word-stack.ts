/**
 * Word Stack's Gold-payout scoring: shared by the one place Word Stack ever
 * pays Gold, a wager on the shared daily board at /games/word-stack.
 *
 * Word Stack keeps its once-a-day limit, full stop; a wager attaches to
 * *that* one attempt rather than unlocking unlimited replay on a separate
 * board (that's what Sudoku/Memory Match offer instead, since they have no
 * daily identity worth protecting the way a shareable daily word does). What
 * is left here is pure scoring math, used by lib/server/word-stack-service.ts:
 * how much a wagered win pays (anteUpWordStackPayout), and how much the free
 * path's completion bonus pays (wordStackDailyBonusMultiplier). The two are
 * mutually exclusive per round; see that file for the "wager replaces the
 * bonus" rule.
 */

import { ladderMultiplier, scaleLadder, type WagerLadder } from "./ante-up-ladder";
import type { WordStackRound } from "./puzzles/word-stack";
import { MIN_WIN_MULTIPLIER, STAKE_PRESSURES, stakePressure, type StakePressure } from "./stake-pressure";

/**
 * The floor for a wager. Zero is always allowed too, for practice with no
 * payout, same reasoning as ante-up.ts's MIN_ANTE_UP_WAGER (restated here
 * rather than imported: each Ante Up game keeps its own copy of this number,
 * the same "restate, don't couple" convention every money-ordering file in
 * this app follows).
 */
export const MIN_ANTE_UP_WAGER = 500;

/**
 * Win-only payout multiplier, keyed by how many guesses the win took. This is
 * Medium's ladder and the reference every other band is scaled from; see
 * scaleForBand in stake-pressure.ts.
 *
 * Every win pays back more than the stake, even on the 6th guess. Someone
 * who solves the word should never end up down Gold. The rungs still slope
 * hard, so a 6-guess win pays far less than a 2-guess win.
 */
export const WAGER_MULTIPLIER_BY_GUESSES: WagerLadder = {
  1: 4, 2: 4, 3: 2.5, 4: 1.8, 5: 1.4, 6: 1.15,
};

/**
 * Each stake band's ladder. Easy barely pays, and every band above pays a
 * bigger gain on the same rungs, so a 10k win on Easy is small and a 1M win
 * on Expert is large. Every rung is above 1x: a solved word never costs Gold,
 * and the risk in a wager is missing all six guesses. Medium and up play hard
 * mode.
 */
export const WORD_STACK_LADDER_BY_PRESSURE: Readonly<Record<StakePressure, WagerLadder>> = Object.fromEntries(
  STAKE_PRESSURES.map((pressure) => [pressure, scaleLadder(WAGER_MULTIPLIER_BY_GUESSES, pressure)]),
) as Record<StakePressure, WagerLadder>;

/** What a wager's stake band sets for its round. Copied onto the round at open. */
export interface WordStackStakeRules {
  hardMode: boolean;
  ladder: WagerLadder;
}

export function wordStackStakeRules(wager: number): WordStackStakeRules {
  const pressure: StakePressure = stakePressure(wager);
  return {
    hardMode: pressure >= 1,
    ladder: WORD_STACK_LADDER_BY_PRESSURE[pressure],
  };
}

/** Lobby lines for each stake band; see components/arcade/stake-pressure-note.tsx. */
const HARD_MODE_LINE = "Hard mode: green letters stay put and gold letters must be used in every later guess.";
function payLine(pressure: StakePressure): string {
  const ladder = WORD_STACK_LADDER_BY_PRESSURE[pressure];
  return `Any win pays back more than you staked. 1-2 guesses pay ${ladder[1]}x, 3 pays ${ladder[3]}x, 6 pays ${ladder[6]}x.`;
}

export const WORD_STACK_PRESSURE_RULES = {
  1: [HARD_MODE_LINE, payLine(1)],
  2: [HARD_MODE_LINE, payLine(2)],
  3: [HARD_MODE_LINE, payLine(3)],
  4: [HARD_MODE_LINE, payLine(4)],
} as const;

/** The payout for a guess count the ladder does not name: the least any win pays. */
export const WORD_STACK_LADDER_FLOOR = MIN_WIN_MULTIPLIER;

/** Always-pays multiplier for the shared daily board's completion bonus. A loss still floors at 1.0x. */
const DAILY_BONUS_MULTIPLIER_BY_GUESSES: Readonly<Record<number, number>> = {
  1: 3.0, 2: 3.0, 3: 2.2, 4: 1.6, 5: 1.2, 6: 1.0,
};

/** What a wager win pays. Zero on anything but a win: the wager is forfeit on a loss. */
export function anteUpWordStackPayout(input: {
  wager: number;
  word: Pick<WordStackRound, "status" | "guesses">;
  /** The ladder this round was opened under; see lib/arcade/ante-up-ladder.ts. */
  ladder?: WagerLadder;
}): number {
  if (input.word.status !== "won") return 0;
  const multiplier = ladderMultiplier(
    input.ladder,
    WAGER_MULTIPLIER_BY_GUESSES,
    input.word.guesses.length,
    // The top-stake ladder goes below the usual floor, so the floor follows it.
    Math.min(WORD_STACK_LADDER_FLOOR, ...Object.values(input.ladder ?? {})),
  );
  return Math.round(input.wager * multiplier);
}

/**
 * What the shared daily board's completion bonus pays, as a multiplier on
 * DAILY_BONUS_BASE (lib/server/daily-puzzle-bonus.ts). Unlike the wager, this
 * always returns at least 1.0: a lost daily attempt still pays the floor,
 * matching how the retired flat mission paid on any completion. Only call
 * this once `round.status !== "active"`.
 */
export function wordStackDailyBonusMultiplier(round: Pick<WordStackRound, "status" | "guesses">): number {
  if (round.status === "lost") return 1.0;
  return DAILY_BONUS_MULTIPLIER_BY_GUESSES[round.guesses.length] ?? 1.0;
}
