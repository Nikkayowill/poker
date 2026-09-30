/**
 * The deck, and the shuffle every cribbage deal goes through.
 *
 * The shuffle takes a RandomInt rather than a seed: the engine hands it the
 * CSPRNG at the moment of each deal, and tests hand it a seeded one. Deals
 * used to come from a mulberry32 accumulator carried on the state, which a
 * player could reconstruct from the hands a count reveals.
 */

import type { RandomInt } from "@/lib/game/deck";
import type { Card, Rank, Suit } from "./types";

const SUITS: Suit[] = ["S", "H", "D", "C"];
const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export function standardDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

/** Fisher-Yates over a fresh copy. */
export function shuffleDeck(deck: readonly Card[], randomInt: RandomInt): Card[] {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
