import { describe, expect, it } from "vitest";
import { WORD_GUESS_POOLS, pickWordGuessWords } from "./brain-word-guess-words";
import {
  WORD_GUESS_BANDS,
  WORD_GUESS_MAX_MISSES,
  wordGuessDifficulty,
  wordGuessMissCap,
  brainWordGuessPayout,
  brainWordGuessProblem,
  guessBrainWordLetter,
  resignBrainWordGuess,
  startBrainWordGuess,
  toBrainWordGuessSnapshot,
} from "./brain-word-guess";


describe("brain word guess", () => {
  it("reveals the correct letter everywhere it appears", () => {
    const attempt = startBrainWordGuess("guitar", 1000, new Date());
    const letter = attempt.word[0];
    const next = guessBrainWordLetter(attempt, letter, new Date());
    expect(next.misses).toBe(0);
    const snapshot = toBrainWordGuessSnapshot(next, { id: "x", version: 1 });
    expect(snapshot.revealed.filter((c) => c === letter).length).toBe(
      [...attempt.word].filter((c) => c === letter).length,
    );
  });

  it("counts a wrong letter as a miss", () => {
    const attempt = startBrainWordGuess("guitar", 1000, new Date());
    const wrong = "qzx".split("").find((c) => !attempt.word.includes(c)) ?? "q";
    const next = guessBrainWordLetter(attempt, wrong, new Date());
    expect(next.misses).toBe(1);
  });

  it("loses once misses reach the cap", () => {
    let attempt = startBrainWordGuess("guitar", 1000, new Date());
    const wrongLetters = "zqxjkvwbfg".split("").filter((c) => !attempt.word.includes(c));
    for (const letter of wrongLetters.slice(0, WORD_GUESS_MAX_MISSES)) {
      attempt = guessBrainWordLetter(attempt, letter, new Date());
    }
    expect(attempt.status).toBe("lost");
    expect(attempt.misses).toBe(WORD_GUESS_MAX_MISSES);
  });

  it("wins once every letter of the word is guessed", () => {
    let attempt = startBrainWordGuess("guitar", 1000, new Date());
    for (const letter of new Set(attempt.word)) {
      attempt = guessBrainWordLetter(attempt, letter, new Date());
    }
    expect(attempt.status).toBe("won");
    expect(brainWordGuessPayout(attempt)).toBeGreaterThan(0);
  });

  it("refuses a repeated or already-finished guess", () => {
    let attempt = startBrainWordGuess("guitar", 1000, new Date());
    attempt = guessBrainWordLetter(attempt, attempt.word[0], new Date());
    expect(brainWordGuessProblem(attempt, attempt.word[0])).toBe("already-guessed");
    const resigned = resignBrainWordGuess(attempt, new Date());
    expect(brainWordGuessProblem(resigned, "a")).toBe("finished");
  });

  it("keeps the word hidden behind underscores while active, revealed once the run ends", () => {
    const attempt = startBrainWordGuess("guitar", 1000, new Date());
    const live = toBrainWordGuessSnapshot(attempt, { id: "x", version: 1 });
    expect(live.word).toBeNull();
    expect(live.revealed.every((c) => c === "_")).toBe(true);
    const resigned = resignBrainWordGuess(attempt, new Date());
    const settled = toBrainWordGuessSnapshot(resigned, { id: "x", version: 1 });
    expect(settled.word).toBe(attempt.word);
  });
});

describe("word guess by stake band", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("scores words with few, rare letters as harder", () => {
    expect(wordGuessDifficulty("jazz")).toBeGreaterThan(wordGuessDifficulty("entertain"));
    expect(wordGuessDifficulty("puppy")).toBeGreaterThan(wordGuessDifficulty("mountain"));
  });

  it("each band's pool is at least as hard as the one below, and still big", () => {
    expect(WORD_GUESS_POOLS[0].length).toBeGreaterThan(400);
    for (const [pressure, below] of [[1, 0], [2, 1], [3, 2]] as const) {
      const pool = WORD_GUESS_POOLS[pressure];
      const floor = WORD_GUESS_BANDS[pressure].minDifficulty!;
      expect(pool.length).toBeGreaterThanOrEqual(100);
      expect(pool.every((word) => wordGuessDifficulty(word) >= floor)).toBe(true);
      expect(pool.every((word) => WORD_GUESS_POOLS[below].includes(word))).toBe(true);
    }
  });

  it("deals the band's number of distinct words from its own pool", () => {
    let seed = 1;
    const random = (max: number) => (seed = (seed * 48271) % 2147483647) % max;
    for (const pressure of [0, 1, 2, 3] as const) {
      for (let i = 0; i < 50; i++) {
        const words = pickWordGuessWords(random, pressure);
        expect(words).toHaveLength(WORD_GUESS_BANDS[pressure].words);
        expect(new Set(words).size).toBe(words.length);
        for (const word of words) expect(WORD_GUESS_POOLS[pressure]).toContain(word);
      }
    }
  });

  it("a multi-word run moves to the next word and shares one miss budget", () => {
    let run = startBrainWordGuess(["jazz", "puppy"], 10_000, now);
    expect(run.pressure).toBe(1);
    expect(wordGuessMissCap(run.ladder!)).toBe(10);
    run = guessBrainWordLetter(run, "e", now);
    for (const letter of "jaz") run = guessBrainWordLetter(run, letter, now);
    expect(run.word).toBe("puppy");
    expect(run.guessed).toEqual([]);
    expect(run.misses).toBe(1);
    let snapshot = toBrainWordGuessSnapshot(run, { id: "x", version: 1 });
    expect(snapshot).toMatchObject({ wordNumber: 2, wordCount: 2, maxMisses: 10, word: null });
    for (const letter of "puy") run = guessBrainWordLetter(run, letter, now);
    expect(run.status).toBe("won");
    snapshot = toBrainWordGuessSnapshot(run, { id: "x", version: 2 });
    expect(snapshot).toMatchObject({ wordNumber: 2, wordCount: 2 });
    expect(brainWordGuessPayout(run)).toBe(30_000);
  });

  it("the run's ladder sets the payout and the miss cap", () => {
    let run = startBrainWordGuess(["jazz", "puppy", "kayak", "quiz"], 1_000_000, now);
    for (const letter of "etoinshrd") run = guessBrainWordLetter(run, letter, now);
    expect(run.status).toBe("active");
    run = guessBrainWordLetter(run, "l", now);
    expect(run.status).toBe("lost");
    expect(run.misses).toBe(10);
    expect(brainWordGuessPayout({ ...run, status: "won", misses: 7 })).toBe(1_300_000);
    expect(brainWordGuessPayout({ ...run, status: "won", misses: 8 })).toBe(800_000);
  });

  it("loads a one-word run stored before bands existed with six misses", () => {
    const old = startBrainWordGuess("jazz", 5_000_000, now);
    delete old.pressure;
    delete old.ladder;
    delete old.queue;
    delete old.solved;
    let run = old;
    for (const letter of "etoin") run = guessBrainWordLetter(run, letter, now);
    expect(run.status).toBe("active");
    expect(toBrainWordGuessSnapshot(run, { id: "x", version: 1 })).toMatchObject({ maxMisses: 6, wordNumber: 1, wordCount: 1 });
    run = guessBrainWordLetter(run, "s", now);
    expect(run.status).toBe("lost");
    const solved = [..."jaz"].reduce((attempt, letter) => guessBrainWordLetter(attempt, letter, now), old);
    expect(solved.status).toBe("won");
    expect(brainWordGuessPayout(solved)).toBe(15_000_000);
  });
});
