/**
 * The 52-card deck, shared by every game in the app.
 *
 * Lifted out of engine.ts unchanged so the arcade games can deal from the
 * same deck the poker table does rather than restating the suits, the ranks
 * and Fisher-Yates a second time. engine.ts is the only consumer that also
 * needs DECK_TEMPLATE (its equity sampler enumerates unseen cards from it).
 *
 * The shuffle takes its randomness as an argument instead of importing it.
 * engine.ts runs server-side and passes node:crypto's randomInt; a client
 * page has no such module, and importing it here would drag it into the
 * browser bundle of anything that wants a deck. Passing it in also means a
 * test can hand over a counter and get a deterministic shuffle.
 */

import type { Card, Rank, Suit } from "./types";

export const SUITS: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const RANKS: readonly Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
];

/** Every card exactly once, in a fixed order. Never deal from this directly -- copy it. */
export const DECK_TEMPLATE: readonly Card[] = SUITS.flatMap(
  (suit) => RANKS.map((rank) => ({ rank, suit })),
);

/** `(maxExclusive) => integer in [0, maxExclusive)` -- the shape of node:crypto's randomInt. */
export type RandomInt = (maxExclusive: number) => number;

/** A fresh, shuffled 52-card deck. Cards are copies, so a caller can never mutate the template. */
export function makeDeck(randomInt: RandomInt): Card[] {
  const deck = DECK_TEMPLATE.map((card) => ({ ...card }));
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [deck[index], deck[swapWith]] = [deck[swapWith], deck[index]];
  }
  return deck;
}
