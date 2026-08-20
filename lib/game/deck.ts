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
  return makeShoe(1, randomInt);
}

/**
 * A shuffled shoe of `decks` packs combined into one -- the way a real
 * multi-deck casino game deals from a shoe rather than a single deck.
 *
 * One Fisher-Yates over the whole shoe, not `decks` shuffled packs stacked --
 * those are different distributions, and the stacked one cannot put two copies
 * of the same card near each other, which is precisely what a multi-deck shoe
 * is for. `makeDeck` is this with `decks = 1`, so there is one shuffle in the
 * codebase rather than two that must stay in step.
 */
export function makeShoe(decks: number, randomInt: RandomInt): Card[] {
  if (!Number.isInteger(decks) || decks < 1) throw new Error("A shoe needs at least one deck.");
  const shoe: Card[] = [];
  for (let pack = 0; pack < decks; pack += 1) {
    for (const card of DECK_TEMPLATE) shoe.push({ ...card });
  }
  for (let index = shoe.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(index + 1);
    [shoe[index], shoe[swapWith]] = [shoe[swapWith], shoe[index]];
  }
  return shoe;
}
