import { describe, expect, it } from "vitest";
import { seededRandomInt } from "@/lib/pvp/secure-random";
import { shuffleDeck, standardDeck } from "./deck";

describe("deck", () => {
  it("standardDeck holds all 52 cards", () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map((card) => `${card.rank}${card.suit}`));
    expect(ids.size).toBe(52);
  });

  it("shuffleDeck is repeatable for a repeatable RandomInt", () => {
    const a = shuffleDeck(standardDeck(), seededRandomInt(12345));
    const b = shuffleDeck(standardDeck(), seededRandomInt(12345));
    expect(a).toEqual(b);
    expect(a).not.toEqual(standardDeck());
  });

  it("shuffleDeck asks for one draw per swap, over a shrinking range", () => {
    const ranges: number[] = [];
    shuffleDeck(standardDeck(), (max) => {
      ranges.push(max);
      return 0;
    });
    expect(ranges).toEqual(Array.from({ length: 51 }, (_, index) => 52 - index));
  });

  it("shuffleDeck never drops or duplicates a card", () => {
    const shuffled = shuffleDeck(standardDeck(), seededRandomInt(999));
    const ids = new Set(shuffled.map((card) => `${card.rank}${card.suit}`));
    expect(ids.size).toBe(52);
  });
});
