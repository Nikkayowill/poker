/**
 * Ante Up: Word Stack -- a solo skill wager, and the daily bonus's scoring.
 *
 * Wager Gold, guess a fresh word (never the shared daily word), cash out a
 * multiple of the wager if you solve it before running out of guesses. Same
 * "skill, not chance" premise as lib/arcade/ante-up.ts (Sudoku) -- see that
 * file's header for the shape this generalizes.
 *
 * Reuses lib/arcade/puzzles/word-stack.ts's engine untouched -- the answer is
 * picked fresh per attempt (never a calendar day), same "never competes with
 * the shared Daily Word Stack" contract Sudoku's Ante Up already keeps.
 *
 * Unlike Sudoku, there is no difficulty choice and no clock: Word Stack
 * already has a natural loss condition (six guesses, no solve), so the
 * multiplier is not fixed at start -- it is scored at settlement, off how
 * many guesses the win actually took. This file owns the tier table for BOTH
 * contexts a Word Stack round can pay Gold in: a wager attempt here
 * (win-only, forfeit on a loss) and the daily bonus on the shared board at
 * /games/word-stack (always pays something, even on a loss) -- see
 * wordStackDailyBonusMultiplier, used by lib/server/word-stack-service.ts.
 */

import {
  WORD_STACK_MAX_GUESSES,
  WORD_STACK_WORD_LENGTH,
  startWordStackRound,
  submitWordStackGuess,
  wordStackGuessProblem,
  wordStackKeyboardState,
  type WordStackGuessProblem,
  type WordStackRound,
  type WordStackTile,
} from "./puzzles/word-stack";

/**
 * The floor for a wager. Zero is always allowed too -- practice, no payout --
 * same reasoning as ante-up.ts's MIN_ANTE_UP_WAGER (restated here rather than
 * imported: each Ante Up game keeps its own copy of this number, the same
 * "restate, don't couple" convention every money-ordering file in this app
 * follows).
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

export type AnteUpWordStackStatus = "active" | "won" | "lost";

export interface AnteUpWordStackAttempt {
  /** Already debited by the time an attempt exists -- see the service. */
  wager: number;
  word: WordStackRound;
  status: AnteUpWordStackStatus;
  startedAt: string;
}

/** A fresh attempt: `answer` is any playable word, never the shared daily word -- see the file header. */
export function startAnteUpWordStack(answer: string, wager: number, now: Date): AnteUpWordStackAttempt {
  return {
    wager,
    word: startWordStackRound(answer),
    status: "active",
    startedAt: now.toISOString(),
  };
}

/** Why a guess cannot be played, or null if it can. */
export function anteUpWordStackGuessProblem(
  attempt: AnteUpWordStackAttempt,
  guess: string,
): WordStackGuessProblem | null {
  if (attempt.status !== "active") return "finished";
  return wordStackGuessProblem(attempt.word, guess);
}

/** Plays a guess. A solved word becomes a win; a sixth failed guess becomes a loss. */
export function playAnteUpWordStackGuess(attempt: AnteUpWordStackAttempt, guess: string): AnteUpWordStackAttempt {
  if (anteUpWordStackGuessProblem(attempt, guess)) return attempt;

  const word = submitWordStackGuess(attempt.word, guess);
  const status: AnteUpWordStackStatus = word.status === "active" ? "active" : word.status === "won" ? "won" : "lost";
  return { ...attempt, word, status };
}

/** Gives up early. The wager is already spent -- this only records how it ended. */
export function resignAnteUpWordStack(attempt: AnteUpWordStackAttempt): AnteUpWordStackAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost" };
}

/** What a WAGER win pays. Zero on anything but a win -- the wager is forfeit on a loss. */
export function anteUpWordStackPayout(attempt: Pick<AnteUpWordStackAttempt, "wager" | "word">): number {
  if (attempt.word.status !== "won") return 0;
  const multiplier = WAGER_MULTIPLIER_BY_GUESSES[attempt.word.guesses.length] ?? 1.5;
  return Math.round(attempt.wager * multiplier);
}

/**
 * What the shared daily board's completion bonus pays, as a multiplier on
 * DAILY_BONUS_BASE (lib/server/daily-puzzle-bonus.ts). Unlike the wager, this
 * always returns at least 1.0 -- a lost daily attempt still pays the floor,
 * matching how the retired flat mission paid on any completion. Only call
 * this once `round.status !== "active"`.
 */
export function wordStackDailyBonusMultiplier(round: Pick<WordStackRound, "status" | "guesses">): number {
  if (round.status === "lost") return 1.0;
  return DAILY_BONUS_MULTIPLIER_BY_GUESSES[round.guesses.length] ?? 1.0;
}

/**
 * The attempt as the browser may see it. `word.answer` is redacted the same
 * way toWordStackSnapshot redacts it -- absent while active, filled in once
 * the round is over.
 */
export interface AnteUpWordStackSnapshot {
  id: string;
  wager: number;
  version: number;
  status: AnteUpWordStackStatus;
  guesses: string[];
  results: WordStackTile[][];
  answer: string | null;
  keyboard: Record<string, WordStackTile>;
  wordLength: number;
  maxGuesses: number;
  /** wager * multiplier on a win, stated rather than left for the client to compute. Zero otherwise. */
  payout: number;
}

export function toAnteUpWordStackSnapshot(
  attempt: AnteUpWordStackAttempt,
  meta: { id: string; version: number },
): AnteUpWordStackSnapshot {
  return {
    id: meta.id,
    wager: attempt.wager,
    version: meta.version,
    status: attempt.status,
    guesses: [...attempt.word.guesses],
    results: attempt.word.results.map((row) => [...row]),
    answer: attempt.word.status === "active" ? null : attempt.word.answer,
    keyboard: wordStackKeyboardState(attempt.word),
    wordLength: WORD_STACK_WORD_LENGTH,
    maxGuesses: WORD_STACK_MAX_GUESSES,
    payout: anteUpWordStackPayout(attempt),
  };
}
