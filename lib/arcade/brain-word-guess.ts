/**
 * Word Guess: a solo skill wager, or free practice, any time.
 *
 * Classic hangman -- guess letters, six wrong guesses and it's over -- on an
 * everyday word instead of "ML Hangman"'s AI/DSA vocabulary, so nobody needs
 * a CS background to play. Same shape as Memory Match / Lights Out: no
 * natural loss condition beyond the wrong-guess cap, which is the whole
 * reason wagering on it is possible; payout is a ladder keyed by how many
 * wrong guesses it took to solve, same idea as wagerMultiplierForTurns.
 */

export const MIN_ANTE_UP_WAGER = 500;

/** Classic six -- one per limb of the drawing. */
export const WORD_GUESS_MAX_MISSES = 6;

export type BrainWordGuessStatus = "active" | "won" | "lost";

export interface BrainWordGuessAttempt {
  wager: number;
  word: string;
  guessed: string[];
  misses: number;
  status: BrainWordGuessStatus;
  startedAt: string;
  finishedAt: string | null;
}

/** `word` comes from the server-only bank in brain-word-guess-words.ts. */
export function startBrainWordGuess(word: string, wager: number, now: Date): BrainWordGuessAttempt {
  return {
    wager,
    word,
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

/** Win-only payout multiplier, keyed by wrong guesses taken. */
export function wagerMultiplierForMisses(misses: number): number {
  if (misses <= 1) return 3;
  if (misses <= 3) return 2;
  if (misses === 4) return 1.3;
  if (misses === 5) return 0.8;
  return 0;
}

/** Guesses one letter. Every letter revealed wins; WORD_GUESS_MAX_MISSES wrong guesses forfeits. */
export function guessBrainWordLetter(attempt: BrainWordGuessAttempt, letter: string, now: Date): BrainWordGuessAttempt {
  if (brainWordGuessProblem(attempt, letter)) return attempt;

  const guessed = [...attempt.guessed, letter];
  const hit = attempt.word.includes(letter);
  const misses = attempt.misses + (hit ? 0 : 1);
  const solved = [...attempt.word].every((char) => guessed.includes(char));

  if (solved) return { ...attempt, guessed, misses, status: "won", finishedAt: now.toISOString() };
  if (misses >= WORD_GUESS_MAX_MISSES) return { ...attempt, guessed, misses, status: "lost", finishedAt: now.toISOString() };
  return { ...attempt, guessed, misses };
}

export function resignBrainWordGuess(attempt: BrainWordGuessAttempt, now: Date): BrainWordGuessAttempt {
  if (attempt.status !== "active") return attempt;
  return { ...attempt, status: "lost", finishedAt: now.toISOString() };
}

export function brainWordGuessPayout(attempt: Pick<BrainWordGuessAttempt, "wager" | "status" | "misses">): number {
  if (attempt.status !== "won") return 0;
  return Math.round(attempt.wager * wagerMultiplierForMisses(attempt.misses));
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
  payout: number;
  /** Only present once the run is over, win or lose -- there is no reason to hide it any more, and a loss should show what the word was. */
  word: string | null;
}

export function toBrainWordGuessSnapshot(
  attempt: BrainWordGuessAttempt,
  meta: { id: string; version: number },
): BrainWordGuessSnapshot {
  const over = attempt.status !== "active";
  return {
    id: meta.id,
    wager: attempt.wager,
    version: meta.version,
    status: attempt.status,
    revealed: [...attempt.word].map((char) => (over || attempt.guessed.includes(char) ? char : "_")),
    length: attempt.word.length,
    guessed: [...attempt.guessed],
    misses: attempt.misses,
    maxMisses: WORD_GUESS_MAX_MISSES,
    payout: brainWordGuessPayout(attempt),
    word: over ? attempt.word : null,
  };
}
