import { describe, expect, it } from "vitest";
import { shuffle, standardDeck } from "./deck";

describe("deck", () => {
  it("standardDeck holds all 52 cards", () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map((card) => `${card.rank}${card.suit}`));
    expect(ids.size).toBe(52);
  });

  /**
   * Pins the exact shuffle a fixed seed produces. This is a determinism
   * guarantee, not an incidental snapshot: a cribbage match's dealt hands
   * must be reproducible from its stored `rngState` alone (replay, and a
   * test elsewhere pinning a specific dealt hand). If this test ever needs
   * to change, the RNG's actual output changed and every stored match
   * replay changes with it -- that is a real behavior change, not a
   * refactor, and must not happen silently.
   */
  it("shuffle is deterministic for a fixed seed", () => {
    const [shuffled, finalState] = shuffle(standardDeck(), 12345);
    expect(shuffled.map((card) => `${card.rank}${card.suit}`)).toEqual([
      "5D", "10H", "13H", "6D", "2H", "8C", "4D", "5S", "3C", "11D",
      "1H", "8S", "13C", "12S", "6C", "1S", "7C", "9H", "1C", "2D",
      "8D", "7S", "3S", "7D", "6S", "9S", "2S", "13S", "6H", "10C",
      "9C", "8H", "3D", "1D", "11S", "5H", "10S", "11H", "12D", "4C",
      "13D", "7H", "10D", "5C", "9D", "4S", "4H", "11C", "2C", "12H",
      "3H", "12C",
    ]);
    expect(finalState).toBe(3215555592);
  });

  it("shuffle never drops or duplicates a card", () => {
    const [shuffled] = shuffle(standardDeck(), 999);
    const ids = new Set(shuffled.map((card) => `${card.rank}${card.suit}`));
    expect(ids.size).toBe(52);
  });
});
