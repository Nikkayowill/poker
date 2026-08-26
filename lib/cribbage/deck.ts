/**
 * The deck and the one seeded RNG that deals every hand of a match.
 *
 * A cribbage match runs an unbounded number of deals (however many it takes
 * to reach 121), unlike Word Race's fixed five rounds, so the state can't
 * pre-generate every deal up front the way createState(seed, now) does
 * there. Instead the mulberry32 accumulator itself (`rngState` on
 * CribbageState) is carried in the state and advanced one step at a time,
 * keeping the same promise the contract makes: nothing here ever calls
 * Math.random(), a match can be replayed from its stored row, and the
 * client is handed no way to predict what is coming.
 */

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

/**
 * One mulberry32 step: the accumulator in, the next accumulator and a float
 * in [0, 1) out. A local copy rather than a shared util, matching
 * lib/pvp/trivia.ts's own precedent: there's no shared RNG module in this
 * codebase yet, and one PRNG isn't worth introducing one for.
 */
export function stepRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [a, value];
}

/** Fisher-Yates over a fresh copy, returning the shuffled deck and the RNG's next state. */
export function shuffle(deck: Card[], rngState: number): [Card[], number] {
  const cards = [...deck];
  let a = rngState;
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const [next, value] = stepRandom(a);
    a = next;
    const j = Math.floor(value * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return [cards, a];
}
