import { describe, expect, it } from "vitest";
import { anteUpWordStackPayout, wordStackDailyBonusMultiplier } from "./ante-up-word-stack";
import type { WordStackRound } from "./puzzles/word-stack";

function round(status: WordStackRound["status"], guessCount: number): Pick<WordStackRound, "status" | "guesses"> {
  return { status, guesses: Array(guessCount).fill("stone") };
}

describe("anteUpWordStackPayout", () => {
  it("pays nothing on anything but a win", () => {
    expect(anteUpWordStackPayout({ wager: 1000, word: round("active", 1) })).toBe(0);
    expect(anteUpWordStackPayout({ wager: 1000, word: round("lost", 6) })).toBe(0);
  });

  it("pays nothing on a zero (free) wager, even on a win", () => {
    expect(anteUpWordStackPayout({ wager: 0, word: round("won", 1) })).toBe(0);
  });

  // Mirrors WAGER_MULTIPLIER_BY_GUESSES in ante-up-word-stack.ts: 1/2 guesses
  // -> 8x, 3 -> 5x, 4 -> 3x, 5 -> 2x, 6 -> 1.5x.
  it.each([
    [1, 8],
    [2, 8],
    [3, 5],
    [4, 3],
    [5, 2],
    [6, 1.5],
  ])("pays wager * the tier for a %i-guess win", (guessCount, multiplier) => {
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", guessCount) })).toBe(Math.round(1000 * multiplier));
  });

  it("rounds wager * multiplier to a whole Gold amount", () => {
    // 1-guess win, 8x -> 2664
    expect(anteUpWordStackPayout({ wager: 333, word: round("won", 1) })).toBe(Math.round(333 * 8));
  });
});

describe("wordStackDailyBonusMultiplier", () => {
  it("floors a loss at 1.0x", () => {
    expect(wordStackDailyBonusMultiplier(round("lost", 6))).toBe(1.0);
  });

  // Mirrors DAILY_BONUS_MULTIPLIER_BY_GUESSES: 1/2 -> 3.0x, 3 -> 2.2x,
  // 4 -> 1.6x, 5 -> 1.2x, 6 -> 1.0x, all on a win.
  it.each([
    [1, 3.0],
    [2, 3.0],
    [3, 2.2],
    [4, 1.6],
    [5, 1.2],
    [6, 1.0],
  ])("pays %ix for a win taking %i guesses", (guessCount, multiplier) => {
    expect(wordStackDailyBonusMultiplier(round("won", guessCount))).toBe(multiplier);
  });
});
