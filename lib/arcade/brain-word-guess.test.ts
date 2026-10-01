import { describe, expect, it } from "vitest";
import {
  WORD_GUESS_MAX_MISSES,
  brainWordGuessPayout,
  brainWordGuessProblem,
  guessBrainWordLetter,
  resignBrainWordGuess,
  startBrainWordGuess,
  toBrainWordGuessSnapshot,
} from "./brain-word-guess";

const fixedRandom = (n: number) => () => n;

describe("brain word guess", () => {
  it("reveals the correct letter everywhere it appears", () => {
    const attempt = startBrainWordGuess(fixedRandom(0), 1000, new Date());
    const letter = attempt.word[0];
    const next = guessBrainWordLetter(attempt, letter, new Date());
    expect(next.misses).toBe(0);
    const snapshot = toBrainWordGuessSnapshot(next, { id: "x", version: 1 });
    expect(snapshot.revealed.filter((c) => c === letter).length).toBe(
      [...attempt.word].filter((c) => c === letter).length,
    );
  });

  it("counts a wrong letter as a miss", () => {
    const attempt = startBrainWordGuess(fixedRandom(0), 1000, new Date());
    const wrong = "qzx".split("").find((c) => !attempt.word.includes(c)) ?? "q";
    const next = guessBrainWordLetter(attempt, wrong, new Date());
    expect(next.misses).toBe(1);
  });

  it("loses once misses reach the cap", () => {
    let attempt = startBrainWordGuess(fixedRandom(0), 1000, new Date());
    const wrongLetters = "zqxjkvwbfg".split("").filter((c) => !attempt.word.includes(c));
    for (const letter of wrongLetters.slice(0, WORD_GUESS_MAX_MISSES)) {
      attempt = guessBrainWordLetter(attempt, letter, new Date());
    }
    expect(attempt.status).toBe("lost");
    expect(attempt.misses).toBe(WORD_GUESS_MAX_MISSES);
  });

  it("wins once every letter of the word is guessed", () => {
    let attempt = startBrainWordGuess(fixedRandom(0), 1000, new Date());
    for (const letter of new Set(attempt.word)) {
      attempt = guessBrainWordLetter(attempt, letter, new Date());
    }
    expect(attempt.status).toBe("won");
    expect(brainWordGuessPayout(attempt)).toBeGreaterThan(0);
  });

  it("refuses a repeated or already-finished guess", () => {
    let attempt = startBrainWordGuess(fixedRandom(0), 1000, new Date());
    attempt = guessBrainWordLetter(attempt, attempt.word[0], new Date());
    expect(brainWordGuessProblem(attempt, attempt.word[0])).toBe("already-guessed");
    const resigned = resignBrainWordGuess(attempt, new Date());
    expect(brainWordGuessProblem(resigned, "a")).toBe("finished");
  });

  it("keeps the word hidden behind underscores while active, revealed once the run ends", () => {
    const attempt = startBrainWordGuess(fixedRandom(0), 1000, new Date());
    const live = toBrainWordGuessSnapshot(attempt, { id: "x", version: 1 });
    expect(live.word).toBeNull();
    expect(live.revealed.every((c) => c === "_")).toBe(true);
    const resigned = resignBrainWordGuess(attempt, new Date());
    const settled = toBrainWordGuessSnapshot(resigned, { id: "x", version: 1 });
    expect(settled.word).toBe(attempt.word);
  });
});
