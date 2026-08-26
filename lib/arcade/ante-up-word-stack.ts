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

import type { WordStackRound } from "./puzzles/word-stack";

/**
 * The floor for a wager. Zero is always allowed too, for practice with no
 * payout, same reasoning as ante-up.ts's MIN_ANTE_UP_WAGER (restated here
 * rather than imported: each Ante Up game keeps its own copy of this number,
 * the same "restate, don't couple" convention every money-ordering file in
 * this app follows).
 */
export const MIN_ANTE_UP_WAGER = 500;

/** Win-only payout multiplier, keyed by how many guesses the win took. Starting numbers, easy to retune here. */
const WAGER_MULTIPLIER_BY_GUESSES: Readonly<Record<number, number>> = {
  1: 8, 2: 8, 3: 5, 4: 3, 5: 2, 6: 1.5,
};

/** Always-pays multiplier for the shared daily board's completion bonus. A loss still floors at 1.0x. */
const DAILY_BONUS_MULTIPLIER_BY_GUESSES: Readonly<Record<number, number>> = {
  1: 3.0, 2: 3.0, 3: 2.2, 4: 1.6, 5: 1.2, 6: 1.0,
};

/** What a wager win pays. Zero on anything but a win: the wager is forfeit on a loss. */
export function anteUpWordStackPayout(input: { wager: number; word: Pick<WordStackRound, "status" | "guesses"> }): number {
  if (input.word.status !== "won") return 0;
  const multiplier = WAGER_MULTIPLIER_BY_GUESSES[input.word.guesses.length] ?? 1.5;
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
