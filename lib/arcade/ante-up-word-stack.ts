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

import { ladderMultiplier, type WagerLadder } from "./ante-up-ladder";
import type { WordStackRound } from "./puzzles/word-stack";
import { stakePressure, type StakePressure } from "./stake-pressure";

/**
 * The floor for a wager. Zero is always allowed too, for practice with no
 * payout, same reasoning as ante-up.ts's MIN_ANTE_UP_WAGER (restated here
 * rather than imported: each Ante Up game keeps its own copy of this number,
 * the same "restate, don't couple" convention every money-ordering file in
 * this app follows).
 */
export const MIN_ANTE_UP_WAGER = 500;

/**
 * Win-only payout multiplier, keyed by how many guesses the win took.
 * Starting numbers, easy to retune here.
 *
 * A 6-guess win pays below 1x on purpose. Scraping the answer on the last
 * legal guess is the outcome closest to not winning at all, and paying a
 * premium for it (it used to pay 1.5x) meant any win was profitable and the
 * wager carried almost no risk. The top rung came down too: a 1-guess win is
 * luck rather than skill, and at 8x it was the single largest per-attempt
 * payout anywhere in the app.
 */
export const WAGER_MULTIPLIER_BY_GUESSES: WagerLadder = {
  1: 4, 2: 4, 3: 2.5, 4: 1.6, 5: 1.1, 6: 0.7,
};

/**
 * Each stake band's ladder. Bands 1-3 play hard mode and only profit on a
 * 3-guess solve or better; the multiples shrink so the expected return
 * crosses 1x at that band's skill target.
 *
 * Calibration. Guess shares by skill, from the NYT/WordleBot aggregate for the
 * median (mean 4.06) and sharpened for stronger players; hard mode slides
 * 20/12/8/5% of each bucket one guess later.
 *
 *   player (hard mode)  solve<=3  band1 EV  band2 EV  band3 EV
 *   median (mean 4.06)    25.7%    0.93x     0.67x     0.55x
 *   +1SD   (mean 3.73)    37.5%    1.24x     0.94x     0.77x
 *   +2SD   (mean 3.54)    47.2%    1.44x     1.13x     0.94x
 *   +3SD   (mean 3.38)    57.0%    1.63x     1.30x     1.10x
 *
 * Band 0 is normal mode: the median profits 86.5% of the time.
 * One word can't separate +1SD from +2SD by win rate, since solving in 3 or
 * fewer only rises about 10 points per SD, so the bands differ by payout
 * rather than by who can profit.
 */
export const WORD_STACK_LADDER_BY_PRESSURE: Readonly<Record<StakePressure, WagerLadder>> = {
  0: WAGER_MULTIPLIER_BY_GUESSES,
  1: { 1: 3, 2: 3, 3: 2.2, 4: 0.8, 5: 0.3, 6: 0 },
  2: { 1: 2.4, 2: 2.4, 3: 1.9, 4: 0.5, 5: 0, 6: 0 },
  3: { 1: 2, 2: 2, 3: 1.7, 4: 0.3, 5: 0, 6: 0 },
};

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
export const WORD_STACK_PRESSURE_RULES = {
  1: [HARD_MODE_LINE, "Profit needs 3 guesses or fewer: 1-2 pay 3x, 3 pays 2.2x, 4 pays back 0.8x, 5 pays 0.3x."],
  2: [HARD_MODE_LINE, "Profit needs 3 guesses or fewer: 1-2 pay 2.4x, 3 pays 1.9x, 4 pays back 0.5x."],
  3: [HARD_MODE_LINE, "Profit needs 3 guesses or fewer: 1-2 pay 2x, 3 pays 1.7x, 4 pays back 0.3x."],
} as const;

/** The lowest rung, and so the payout for a guess count the ladder does not name. */
export const WORD_STACK_LADDER_FLOOR = 0.7;

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
