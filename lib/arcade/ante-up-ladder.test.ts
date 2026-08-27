import { describe, expect, it } from "vitest";
import { ladderMultiplier, type WagerLadder } from "./ante-up-ladder";
import {
  WAGER_MULTIPLIER_BY_GUESSES,
  WORD_STACK_LADDER_FLOOR,
  anteUpWordStackPayout,
} from "./ante-up-word-stack";
import {
  CONNECTIONS_LADDER_FLOOR,
  WAGER_MULTIPLIER_BY_MISTAKES,
  anteUpConnectionsPayout,
} from "./ante-up-connections";
import type { WordStackRound } from "./puzzles/word-stack";
import type { ConnectionsRound } from "./puzzles/connections";

/**
 * A daily board can be opened in the morning and finished at night, so the
 * terms it was opened under have to survive a retune landing in between.
 * These pin that: the stored ladder wins over the live table, always.
 */

/** The ladder as it stood before the 2026-08-27 retune, the one that moved. */
const OLD_WORD_STACK: WagerLadder = { 1: 8, 2: 8, 3: 5, 4: 3, 5: 2, 6: 1.5 };
const OLD_CONNECTIONS: WagerLadder = { 0: 8, 1: 5, 2: 3, 3: 1.5 };

function word(status: WordStackRound["status"], guesses: number) {
  return { status, guesses: Array.from({ length: guesses }, () => "crane") } as Pick<
    WordStackRound,
    "status" | "guesses"
  >;
}

function puzzle(status: ConnectionsRound["status"], mistakes: number) {
  return { status, mistakes } as Pick<ConnectionsRound, "status" | "mistakes">;
}

describe("ladderMultiplier", () => {
  it("prefers the stored ladder over the live table", () => {
    expect(ladderMultiplier({ 3: 5 }, { 3: 2.5 }, 3, 0.7)).toBe(5);
  });

  it("falls back to the live table when no ladder was stored", () => {
    expect(ladderMultiplier(undefined, { 3: 2.5 }, 3, 0.7)).toBe(2.5);
  });

  it("falls to the floor for a rung neither table names", () => {
    expect(ladderMultiplier({ 1: 4 }, { 1: 4 }, 99, 0.7)).toBe(0.7);
  });

  it("uses the stored ladder's own gap, not the live table's value", () => {
    // The stored ladder is the authority end to end. A rung it does not name
    // must not quietly resolve through today's table.
    expect(ladderMultiplier({ 1: 4 }, { 1: 4, 6: 99 }, 6, 0.7)).toBe(0.7);
  });
});

describe("anteUpWordStackPayout", () => {
  it("pays a pre-retune round at the rate it was opened under", () => {
    // 6-guess win: 1.5x then, 0.7x now. Profit or loss on the same board.
    expect(anteUpWordStackPayout({ wager: 1000, word: word("won", 6), ladder: OLD_WORD_STACK })).toBe(1500);
    expect(anteUpWordStackPayout({ wager: 1000, word: word("won", 6) })).toBe(700);
  });

  it("pays a round with no stored ladder at today's rate", () => {
    const live = WAGER_MULTIPLIER_BY_GUESSES[3];
    expect(anteUpWordStackPayout({ wager: 1000, word: word("won", 3) })).toBe(Math.round(1000 * live));
  });

  it("still pays nothing on a loss, whatever ladder is stored", () => {
    expect(anteUpWordStackPayout({ wager: 1000, word: word("lost", 6), ladder: OLD_WORD_STACK })).toBe(0);
  });

  it("names its floor as the lowest rung it has", () => {
    // The floor must never be the cheap way to a big payout.
    const rungs = Object.values(WAGER_MULTIPLIER_BY_GUESSES);
    expect(WORD_STACK_LADDER_FLOOR).toBe(Math.min(...rungs));
  });
});

describe("anteUpConnectionsPayout", () => {
  it("pays a pre-retune round at the rate it was opened under", () => {
    // 3-mistake win: 1.5x then, 0.6x now.
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3), ladder: OLD_CONNECTIONS })).toBe(1500);
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 3) })).toBe(600);
  });

  it("pays a round with no stored ladder at today's rate", () => {
    const live = WAGER_MULTIPLIER_BY_MISTAKES[0];
    expect(anteUpConnectionsPayout({ wager: 1000, puzzle: puzzle("won", 0) })).toBe(Math.round(1000 * live));
  });

  it("names its floor as the lowest rung it has", () => {
    const rungs = Object.values(WAGER_MULTIPLIER_BY_MISTAKES);
    expect(CONNECTIONS_LADDER_FLOOR).toBe(Math.min(...rungs));
  });
});
