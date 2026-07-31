import type { Card, Winner } from "./types";

/**
 * Which cards on the table made the winning hand.
 *
 * The set is carried around as a single sorted string rather than a Set or an
 * array on purpose. PlayerSeat is memoised with a hand-written comparator, and
 * a fresh collection every render either defeats the memo entirely or -- if it
 * is left out of the comparator -- silently freezes on whatever the seat first
 * saw. A string compares by value with `===`, so neither trap is available.
 *
 * Five cards, three times a session; the cost of splitting a short string is
 * not worth a more clever representation.
 */

const SEPARATOR = " ";

export function cardKey(card: Card): string {
  return `${card.rank}of${card.suit}`;
}

/**
 * Every card involved in any winner's hand, or null when there is nothing to
 * highlight. Null rather than an empty string so callers can tell "the hand is
 * not over" and "the pot was won without a showdown" from "these five cards
 * won" -- an uncontested pot has no bestFive, because nobody saw the cards.
 */
export function winningCardKeys(winners: Winner[]): string | null {
  const keys = new Set<string>();
  winners.forEach((winner) => {
    winner.bestFive?.forEach((card) => keys.add(cardKey(card)));
  });
  if (keys.size === 0) return null;
  return [...keys].sort().join(SEPARATOR);
}

export function isWinningCard(keys: string | null, card: Card | null | undefined): boolean {
  if (!keys || !card) return false;
  return keys.split(SEPARATOR).includes(cardKey(card));
}
