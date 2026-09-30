/**
 * Word Guess: a solo skill wager, or free practice, any time.
 *
 * Classic hangman -- guess letters, six wrong guesses and it's over -- on an
 * everyday word instead of "ML Hangman"'s AI/DSA vocabulary, so nobody needs
 * a CS background to play. Same shape as Memory Match / Lights Out: no
 * natural loss condition beyond the wrong-guess cap, which is the whole
 * reason wagering on it is possible; payout is a ladder keyed by how many
 * wrong guesses it took to solve, same idea as wagerMultiplierForTurns.
 *
 * Bigger stakes deal a run of several harder words that share one miss
 * budget. One word is too noisy to tell a strong player from a lucky one;
 * several in a row is not.
 */

import { stakePressure, type StakePressure } from "@/lib/arcade/stake-pressure";

export const MIN_ANTE_UP_WAGER = 500;

/** Classic six -- one per limb of the drawing. Band 0's limit, and older runs'. */
export const WORD_GUESS_MAX_MISSES = 6;

/** English letters, most common first. */
const LETTER_FREQUENCY = "etaoinshrdlcumwfgypbvkjxqz";

/**
 * How hard a word is to hangman. Few distinct letters means each hit reveals
 * little and there is less to find, and rare letters are ones a player reaches
 * late. So: the mean frequency rank of its distinct letters, less 1.5 per
 * distinct letter. "jazz" scores high, "entertain" low.
 */
export function wordGuessDifficulty(word: string): number {
  const letters = [...new Set(word)];
  const meanRank = letters.reduce((sum, letter) => sum + LETTER_FREQUENCY.indexOf(letter), 0) / letters.length;
  return meanRank - 1.5 * letters.length;
}

/** One payout rung: finish with at most `maxMisses` wrong guesses in total, cash out `multiplier`x. Best first. */
export interface WordGuessRung {
  maxMisses: number;
  multiplier: number;
}

/** Per stake band: how many words, the easiest word it may deal, and the payout ladder. */
export interface WordGuessBand {
  words: number;
  minDifficulty: number | null;
  ladder: readonly WordGuessRung[];
}

const rungs = (three: number, two: number, gain: number, floor: number): WordGuessRung[] => [
  { maxMisses: three, multiplier: 3 },
  { maxMisses: two, multiplier: 2 },
  { maxMisses: gain, multiplier: 1.3 },
  { maxMisses: floor, multiplier: 0.8 },
];

/**
 * Calibration, share of runs that finish on a rung above 1x (misses shared across the run).
 * Players are simulated per word: at +z SD a player picks the letter a solver who knows
 * everyday words would pick with chance (z+1)/4, otherwise the most common English letter
 * that still fits the pattern. Targets: see stake-pressure.ts.
 *
 *   band            median  +1SD  +2SD  +3SD
 *   0: 1 word        61%    78%   94%   99%
 *   1: 2 words       21%    51%   86%   99%
 *   2: 3 words        3%    18%   62%   93%
 *   3: 4 words        0%     2%   21%   60%
 */
export const WORD_GUESS_BANDS: Record<StakePressure, WordGuessBand> = {
  0: { words: 1, minDifficulty: null, ladder: rungs(1, 3, 4, 5) },
  1: { words: 2, minDifficulty: -1, ladder: rungs(2, 5, 7, 9) },
  2: { words: 3, minDifficulty: 0, ladder: rungs(3, 6, 8, 10) },
  3: { words: 4, minDifficulty: 0, ladder: rungs(3, 5, 7, 9) },
};

const LEGACY_LADDER = WORD_GUESS_BANDS[0].ladder;

/** The miss count that ends a run: one past its last rung. */
export function wordGuessMissCap(ladder: readonly WordGuessRung[]): number {
  return ladder[ladder.length - 1].maxMisses + 1;
}

export type BrainWordGuessStatus = "active" | "won" | "lost";

export interface BrainWordGuessAttempt {
  wager: number;
  /** The stake band, fixed at open. Missing on older runs, which play as band 0. */
  pressure?: StakePressure;
  /** Copied from the band at open. Missing on older runs, which pay on band 0's ladder. */
  ladder?: WordGuessRung[];
  /** The word in play. */
  word: string;
  /** Words still to come after this one. Missing on older, one-word runs. */
  queue?: string[];
  /** Words already solved this run. */
  solved?: number;
  /** Letters guessed on the word in play. */
  guessed: string[];
  /** Wrong guesses across the whole run. */
  misses: number;
  status: BrainWordGuessStatus;
  startedAt: string;
  finishedAt: string | null;
}

/** `words` come from the server-only bank in brain-word-guess-words.ts, picked for this wager's band. */
export function startBrainWordGuess(words: string | readonly string[], wager: number, now: Date): BrainWordGuessAttempt {
  const pressure = stakePressure(wager);
  const [word, ...queue] = typeof words === "string" ? [words] : words;
  return {
    wager,
    pressure,
    ladder: WORD_GUESS_BANDS[pressure].ladder.map((rung) => ({ ...rung })),
    word,
    queue,
    solved: 0,
    guessed: [],
    misses: 0,
    status: "active",
    startedAt: now.toISOString(),
    finishedAt: null,
  };
}

export type BrainWordGuessProblem = "finished" | "already-guessed" | "not-a-letter";

export function brainWordGuessProblem(attempt: BrainWordGuessAttempt, letter: string): BrainWordGuessProblem | null {
  if (attempt.status !== "active") return "finished";
  if (!/^[a-z]$/.test(letter)) return "not-a-letter";
  if (attempt.guessed.includes(letter)) return "already-guessed";
  return null;
}

/** Win-only payout multiplier, keyed by wrong guesses taken across the run. */
export function wagerMultiplierForMisses(misses: number, ladder: readonly WordGuessRung[] = LEGACY_LADDER): number {
  return ladder.find((rung) => misses <= rung.maxMisses)?.multiplier ?? 0;
}

/** Guesses one letter. Solving the last word wins; solving an earlier one deals the next; running out of misses forfeits. */
export function guessBrainWordLetter(attempt: BrainWordGuessAttempt, letter: string, now: Date): BrainWordGuessAttempt {
  if (brainWordGuessProblem(attempt, letter)) return attempt;

  const guessed = [...attempt.guessed, letter];
  const hit = attempt.word.includes(letter);
  const misses = attempt.misses + (hit ? 0 : 1);
  const solved = [...attempt.word].every((char) => guessed.includes(char));
  const queue = attempt.queue ?? [];

  if (solved && queue.length > 0) {
    const [word, ...rest] = queue;
    return { ...attempt, word, queue: rest, solved: (attempt.solved ?? 0) + 1, guessed: [], misses };
  }
  if (solved) return { ...attempt, guessed, misses, solved: (attempt.solved ?? 0) + 1, status: "won", finishedAt: now.toISOString() };
  if (misses >= wordGuessMissCap(attempt.ladder ?? LEGACY_LADDER)) {
    return { ...attempt, guessed, misses, status: "lost", finishedAt: now.toISOString() };
  }
  return { ...attempt, guessed, misses };
}

export function resignBrainWordGuess(attempt: BrainWordGuessAttempt, now: Date): BrainWordGuessAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost", finishedAt: now.toISOString() };
}

export function brainWordGuessPayout(
  attempt: Pick<BrainWordGuessAttempt, "wager" | "status" | "misses" | "ladder">,
): number {
  if (attempt.status !== "won") return 0;
  return Math.round(attempt.wager * wagerMultiplierForMisses(attempt.misses, attempt.ladder ?? LEGACY_LADDER));
}

export interface BrainWordGuessSnapshot {
  id: string;
  wager: number;
  version: number;
  status: BrainWordGuessStatus;
  /** The word's own letters where guessed (or the game is over), an underscore elsewhere -- the word itself never leaves the server otherwise. */
  revealed: string[];
  length: number;
  guessed: string[];
  misses: number;
  maxMisses: number;
  ladder: WordGuessRung[];
  /** Which word of the run is in play, from 1. */
  wordNumber: number;
  wordCount: number;
  payout: number;
  /** Only present once the run is over, win or lose -- there is no reason to hide it any more, and a loss should show what the word was. */
  word: string | null;
}

export function toBrainWordGuessSnapshot(
  attempt: BrainWordGuessAttempt,
  meta: { id: string; version: number },
): BrainWordGuessSnapshot {
  const over = attempt.status !== "active";
  const ladder = attempt.ladder ?? LEGACY_LADDER;
  const solved = attempt.solved ?? 0;
  // A won run counts its last word as solved; show it as the word in play, not one past it.
  const wordNumber = attempt.status === "won" ? solved : solved + 1;
  return {
    id: meta.id,
    wager: attempt.wager,
    version: meta.version,
    status: attempt.status,
    revealed: [...attempt.word].map((char) => (over || attempt.guessed.includes(char) ? char : "_")),
    length: attempt.word.length,
    guessed: [...attempt.guessed],
    misses: attempt.misses,
    maxMisses: wordGuessMissCap(ladder),
    ladder: ladder.map((rung) => ({ ...rung })),
    wordNumber: Math.max(1, wordNumber),
    wordCount: solved + (attempt.status === "won" ? 0 : 1) + (attempt.queue?.length ?? 0),
    payout: brainWordGuessPayout(attempt),
    word: over ? attempt.word : null,
  };
}
