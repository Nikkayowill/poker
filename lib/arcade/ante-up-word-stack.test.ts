import { describe, expect, it } from "vitest";
import {
  WAGER_MULTIPLIER_BY_GUESSES,
  WORD_STACK_LADDER_BY_PRESSURE,
  anteUpWordStackPayout,
  wordStackDailyBonusMultiplier,
  wordStackStakeRules,
} from "./ante-up-word-stack";
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
  // -> 4x, 3 -> 2.5x, 4 -> 1.6x, 5 -> 1.1x, 6 -> 0.7x. The last rung is below
  // 1x on purpose; see that table's own comment.
  it.each([
    [1, 4],
    [2, 4],
    [3, 2.5],
    [4, 1.6],
    [5, 1.1],
    [6, 0.7],
  ])("pays wager * the tier for a %i-guess win", (guessCount, multiplier) => {
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", guessCount) })).toBe(Math.round(1000 * multiplier));
  });

  it("rounds wager * multiplier to a whole Gold amount", () => {
    // 1-guess win, 4x -> 1332
    expect(anteUpWordStackPayout({ wager: 333, word: round("won", 1) })).toBe(Math.round(333 * 4));
  });

  it("returns less than the wager for a win on the last legal guess", () => {
    // The rung that used to pay 1.5x. Scraping it on guess 6 is the outcome
    // closest to losing, so it must cost the player something -- a table where
    // every win profits is what made the wager risk-free.
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", 6) })).toBeLessThan(1000);
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

describe("wordStackStakeRules", () => {
  it.each([
    [0, false, 0],
    [9_999, false, 0],
    [10_000, true, 1],
    [100_000, true, 2],
    [1_000_000, true, 3],
  ] as const)("a %i wager: hard mode %s, band %i ladder", (wager, hardMode, band) => {
    expect(wordStackStakeRules(wager)).toEqual({ hardMode, ladder: WORD_STACK_LADDER_BY_PRESSURE[band] });
  });

  it("keeps today's ladder for small stakes", () => {
    expect(WORD_STACK_LADDER_BY_PRESSURE[0]).toBe(WAGER_MULTIPLIER_BY_GUESSES);
  });

  it("profits only on a 3-guess solve or better from 10k up, with the top multiple shrinking by band", () => {
    const tops = ([1, 2, 3] as const).map((band) => {
      const ladder = WORD_STACK_LADDER_BY_PRESSURE[band];
      for (const guesses of [1, 2, 3]) expect(ladder[guesses]).toBeGreaterThan(1);
      for (const guesses of [4, 5, 6]) expect(ladder[guesses]).toBeLessThan(1);
      expect(ladder[6]).toBe(0);
      return ladder[1];
    });
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
  });

  it("pays a 1M round from its stored ladder", () => {
    const ladder = WORD_STACK_LADDER_BY_PRESSURE[3];
    expect(anteUpWordStackPayout({ wager: 1_000_000, word: round("won", 3), ladder })).toBe(1_700_000);
    expect(anteUpWordStackPayout({ wager: 1_000_000, word: round("won", 4), ladder })).toBe(300_000);
    expect(anteUpWordStackPayout({ wager: 1_000_000, word: round("won", 6), ladder })).toBe(0);
  });

  it("floors an unnamed rung at the stored ladder's lowest value", () => {
    const ladder = WORD_STACK_LADDER_BY_PRESSURE[3];
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", 7), ladder })).toBe(0);
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", 7) })).toBe(700);
  });
});
