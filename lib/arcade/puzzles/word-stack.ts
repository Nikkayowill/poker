/**
 * Daily Word Stack -- the rules, and nothing else.
 *
 * Pure and synchronous like lib/arcade/hi-lo.ts: every function takes a round
 * and returns the next one. Crucially it also takes the *answer* as data --
 * there is no word list in this file. That is not tidiness, it is the security
 * boundary: this module is imported by the browser (the board renders from its
 * types and the share grid is built from its tiles), so anything it imports
 * ships to the client. The answer list lives in word-stack-answers.ts behind
 * `server-only`, and only the service ever touches it.
 *
 * ## Scoring is two passes, and one pass is a bug
 *
 * The whole subtlety of this kind of word puzzle is repeated letters. Marking each tile
 * independently -- "is this letter anywhere in the answer?" -- gets every
 * single-letter case right and quietly lies about the rest: guess CRANE
 * against ABBEY and the naive rule paints both Es, when only one E exists to
 * be found. The fix is to treat the answer as a pool of letters that greens
 * consume first and yellows draw from second, so a letter is never reported
 * more times than it actually occurs. `scoreWordStackGuess` is that, and the
 * duplicate cases are pinned in the tests because this is the one function
 * here that is easy to get subtly, unfalsifiably wrong.
 */

export const WORD_STACK_WORD_LENGTH = 5;
export const WORD_STACK_MAX_GUESSES = 6;

/** What a single letter box reports. The three colours of the share grid, in the same order. */
export type WordStackTile = "correct" | "present" | "absent";

export type WordStackStatus = "active" | "won" | "lost";

export interface WordStackRound {
  /** Lowercase. Secret until the round ends -- see toWordStackSnapshot. */
  answer: string;
  /** Lowercase, oldest first. */
  guesses: string[];
  /** Parallel to `guesses`: results[i] scores guesses[i]. */
  results: WordStackTile[][];
  status: WordStackStatus;
}

/**
 * Why a guess cannot be played, or null if it can.
 *
 * `unknown-word` is deliberately absent: this module has no dictionary, so it
 * cannot answer that question and does not pretend to. The service checks it
 * against the server-only word list and rejects there.
 */
export type WordStackGuessProblem = "finished" | "length" | "letters";

export function normalizeGuess(guess: string): string {
  return guess.trim().toLowerCase();
}

export function wordStackGuessProblem(round: WordStackRound, guess: string): WordStackGuessProblem | null {
  if (round.status !== "active") return "finished";
  const word = normalizeGuess(guess);
  if (word.length !== WORD_STACK_WORD_LENGTH) return "length";
  if (!/^[a-z]+$/.test(word)) return "letters";
  return null;
}

/**
 * Scores one guess against one answer.
 *
 * Two passes over the word: greens first, then yellows out of whatever letters
 * the greens did not already claim. See the note at the top of this file for
 * why the obvious one-pass version is wrong.
 */
export function scoreWordStackGuess(guess: string, answer: string): WordStackTile[] {
  const guessed = normalizeGuess(guess).split("");
  const target = normalizeGuess(answer).split("");
  const tiles: WordStackTile[] = guessed.map(() => "absent");

  /** Letters of the answer still available to be matched, after greens take theirs. */
  const unclaimed = new Map<string, number>();
  guessed.forEach((letter, index) => {
    if (letter === target[index]) {
      tiles[index] = "correct";
      return;
    }
    const answerLetter = target[index];
    if (answerLetter !== undefined) {
      unclaimed.set(answerLetter, (unclaimed.get(answerLetter) ?? 0) + 1);
    }
  });

  guessed.forEach((letter, index) => {
    if (tiles[index] === "correct") return;
    const left = unclaimed.get(letter) ?? 0;
    if (left > 0) {
      tiles[index] = "present";
      unclaimed.set(letter, left - 1);
    }
  });

  return tiles;
}

export function startWordStackRound(answer: string): WordStackRound {
  const word = normalizeGuess(answer);
  if (word.length !== WORD_STACK_WORD_LENGTH || !/^[a-z]+$/.test(word)) {
    throw new Error(`Not a playable answer: ${answer}`);
  }
  return { answer: word, guesses: [], results: [], status: "active" };
}

/**
 * Plays a guess.
 *
 * Inert on a guess the round cannot accept, rather than throwing -- the
 * service re-checks first and turns a rejection into a 4xx, and a throw here
 * would be a 500 where a 409 belongs. Same convention as callHiLo.
 */
export function submitWordStackGuess(round: WordStackRound, guess: string): WordStackRound {
  if (wordStackGuessProblem(round, guess)) return round;

  const word = normalizeGuess(guess);
  const tiles = scoreWordStackGuess(word, round.answer);
  const guesses = [...round.guesses, word];
  const results = [...round.results, tiles];
  const status: WordStackStatus =
    word === round.answer ? "won" : guesses.length >= WORD_STACK_MAX_GUESSES ? "lost" : "active";

  return { ...round, guesses, results, status };
}

/** The strongest thing known about each letter. Drives the on-screen keyboard's colours. */
export function wordStackKeyboardState(round: WordStackRound): Record<string, WordStackTile> {
  const rank: Record<WordStackTile, number> = { absent: 0, present: 1, correct: 2 };
  const state: Record<string, WordStackTile> = {};
  round.guesses.forEach((guess, index) => {
    guess.split("").forEach((letter, position) => {
      const tile = round.results[index]?.[position];
      if (!tile) return;
      const known = state[letter];
      if (!known || rank[tile] > rank[known]) state[letter] = tile;
    });
  });
  return state;
}

/**
 * The round as the browser may see it.
 *
 * `answer` is null while the round is live. That is the entire reason the
 * round lives on the server: a five-letter string in the payload is a
 * one-guess win for anyone with a network tab open, which is not an exotic
 * attack -- it is the first thing a curious player tries. It is filled in once
 * the round is over, because a player who lost is owed the word.
 */
export interface WordStackSnapshot {
  day: string;
  puzzleNumber: number;
  /** Echoed back with the next guess, which is what pins it to this exact state. */
  version: number;
  guesses: string[];
  results: WordStackTile[][];
  status: WordStackStatus;
  /** Null until the round ends. */
  answer: string | null;
  keyboard: Record<string, WordStackTile>;
  wordLength: number;
  maxGuesses: number;
}

export function toWordStackSnapshot(
  round: WordStackRound,
  meta: { day: string; puzzleNumber: number; version: number },
): WordStackSnapshot {
  return {
    day: meta.day,
    puzzleNumber: meta.puzzleNumber,
    version: meta.version,
    guesses: [...round.guesses],
    results: round.results.map((row) => [...row]),
    status: round.status,
    answer: round.status === "active" ? null : round.answer,
    keyboard: wordStackKeyboardState(round),
    wordLength: WORD_STACK_WORD_LENGTH,
    maxGuesses: WORD_STACK_MAX_GUESSES,
  };
}
