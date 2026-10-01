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
  // -> 4x, 3 -> 2.5x, 4 -> 1.8x, 5 -> 1.4x, 6 -> 1.15x. Every rung is above
  // 1x; see that table's own comment.
  it.each([
    [1, 4],
    [2, 4],
    [3, 2.5],
    [4, 1.8],
    [5, 1.4],
    [6, 1.15],
  ])("pays wager * the tier for a %i-guess win", (guessCount, multiplier) => {
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", guessCount) })).toBe(Math.round(1000 * multiplier));
  });

  it("rounds wager * multiplier to a whole Gold amount", () => {
    // 1-guess win, 4x -> 1332
    expect(anteUpWordStackPayout({ wager: 333, word: round("won", 1) })).toBe(Math.round(333 * 4));
  });

  it("returns more than the wager for a win on the last legal guess, but less than a 2-guess win", () => {
    const sixth = anteUpWordStackPayout({ wager: 1000, word: round("won", 6) });
    expect(sixth).toBeGreaterThan(1000);
    expect(sixth).toBeLessThan(anteUpWordStackPayout({ wager: 1000, word: round("won", 2) }));
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
    [24_999, false, 0],
    [25_000, true, 1],
    [100_000, true, 2],
    [500_000, true, 3],
    [1_000_000, true, 4],
  ] as const)("a %i wager: hard mode %s, band %i ladder", (wager, hardMode, band) => {
    expect(wordStackStakeRules(wager)).toEqual({ hardMode, ladder: WORD_STACK_LADDER_BY_PRESSURE[band] });
  });

  it("uses the reference table as Medium's ladder", () => {
    expect(WORD_STACK_LADDER_BY_PRESSURE[1]).toEqual(WAGER_MULTIPLIER_BY_GUESSES);
  });

  it("pays more than the stake on every win in every band, and more in every band up", () => {
    const bands = ([0, 1, 2, 3, 4] as const).map((band) => WORD_STACK_LADDER_BY_PRESSURE[band]);
    for (const ladder of bands) {
      for (const guesses of [1, 2, 3, 4, 5, 6]) expect(ladder[guesses]).toBeGreaterThan(1);
      expect(ladder[6]).toBeLessThan(ladder[2]);
    }
    for (let i = 1; i < bands.length; i++) {
      for (const guesses of [1, 2, 3, 4, 5, 6]) {
        expect(bands[i][guesses]).toBeGreaterThanOrEqual(bands[i - 1][guesses]);
      }
    }
  });

  it("barely pays on Easy and pays well on Expert", () => {
    expect(WORD_STACK_LADDER_BY_PRESSURE[0][1]).toBeLessThanOrEqual(2.5);
    expect(WORD_STACK_LADDER_BY_PRESSURE[0][6]).toBeLessThan(1.1);
    expect(WORD_STACK_LADDER_BY_PRESSURE[4][1]).toBeGreaterThanOrEqual(5);
  });

  it("pays a 1M round from its stored ladder", () => {
    const ladder = WORD_STACK_LADDER_BY_PRESSURE[4];
    expect(anteUpWordStackPayout({ wager: 1_000_000, word: round("won", 3), ladder })).toBe(3_330_000);
    expect(anteUpWordStackPayout({ wager: 1_000_000, word: round("won", 4), ladder })).toBe(2_240_000);
    expect(anteUpWordStackPayout({ wager: 1_000_000, word: round("won", 6), ladder })).toBe(1_230_000);
  });

  it("floors an unnamed rung at the least any win pays", () => {
    const ladder = WORD_STACK_LADDER_BY_PRESSURE[4];
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", 7), ladder })).toBe(1050);
    expect(anteUpWordStackPayout({ wager: 1000, word: round("won", 7) })).toBe(1050);
  });
});
