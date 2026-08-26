/**
 * Cribbage scoring, isolated from turn order and pegging state on purpose:
 * this is the one place a wrong number costs a player real Gold, so it is
 * tested exhaustively in complete isolation (scoring.test.ts) before anything
 * that moves money can reach it.
 *
 * Every function here is pure: cards in, points out, nothing read from a
 * clock or a store.
 */

import { type Card, pointValue, type ScoreEntry } from "./types";

/* ------------------------------------------------------------- 15s -------- */

/**
 * Every subset of two or more cards whose point values sum to 15, 2 points
 * each. A brute-force walk over every subset is fine here: hand scoring only
 * ever sees 5 cards (2^5 - 1 = 31 subsets), and pegging never scores a
 * "fifteen" against more than the cards currently on the table, which is
 * bounded by the same 31-count ceiling that ends a pegging round.
 */
export function countFifteens(cards: Card[]): number {
  let combinations = 0;
  const values = cards.map((card) => pointValue(card.rank));
  const n = values.length;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) sum += values[i];
    }
    if (sum === 15) combinations += 1;
  }
  return combinations * 2;
}

/* ------------------------------------------------------------ pairs ------- */

/**
 * Pairs, scored as combinations: among k cards of the same rank there are
 * k*(k-1)/2 distinct pairs, each worth 2, so a rank appearing k times is
 * worth k*(k-1) points outright (2 for a pair, 6 for three of a kind, 12 for
 * all four).
 */
export function countPairs(cards: Card[]): number {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  let points = 0;
  for (const count of counts.values()) points += count * (count - 1);
  return points;
}

/* -------------------------------------------------------------- runs ------ */

/**
 * The longest run(s) of three or more consecutive ranks, scored over the
 * whole set (hand + starter, or crib + starter).
 *
 * A "double run" (a duplicated rank inside an otherwise-consecutive block,
 * e.g. 3-3-4-5-6) is worth the run's length once for every combination the
 * duplicate produces, which is exactly the product of how many times each
 * rank in the block appears. Five cards cannot hold two separate qualifying
 * runs (that needs six distinct ranks at minimum), so finding the single
 * longest consecutive block of distinct ranks and multiplying by that
 * product is the whole algorithm; there is no second block to find.
 */
export function scoreRuns(cards: Card[]): number {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const distinctRanks = [...counts.keys()].sort((a, b) => a - b);

  let bestLength = 0;
  let bestMultiplier = 1;
  let runStart = 0;
  for (let i = 0; i <= distinctRanks.length; i += 1) {
    const broke = i === distinctRanks.length || distinctRanks[i] !== distinctRanks[i - 1] + 1;
    if (!broke) continue;
    const length = i - runStart;
    if (length >= 3 && length > bestLength) {
      bestLength = length;
      bestMultiplier = 1;
      for (let j = runStart; j < i; j += 1) bestMultiplier *= counts.get(distinctRanks[j])!;
    }
    runStart = i;
  }
  return bestLength >= 3 ? bestLength * bestMultiplier : 0;
}

/* ------------------------------------------------------------- flush ------ */

/**
 * 4 if the four dealt cards share a suit and the starter does not also match,
 * 5 if it does. A crib's flush is 5-or-nothing: it never scores for 4, the
 * one real rule difference between a hand's flush and a crib's.
 */
export function scoreFlush(hand: Card[], starter: Card, isCrib: boolean): number {
  if (hand.length === 0) return 0;
  const suit = hand[0].suit;
  if (!hand.every((card) => card.suit === suit)) return 0;
  const starterMatches = starter.suit === suit;
  if (isCrib) return starterMatches ? 5 : 0;
  return starterMatches ? 5 : 4;
}

/* -------------------------------------------------------------- nobs ------ */

/** "His nobs": a Jack in the hand (or crib) matching the starter's suit, 1 point. */
export function scoreNobs(hand: Card[], starter: Card): number {
  return hand.some((card) => card.rank === 11 && card.suit === starter.suit) ? 1 : 0;
}

/** "His heels": the dealer scores 2 immediately if the cut starter is a Jack. */
export function heelsBonus(starter: Card): number {
  return starter.rank === 11 ? 2 : 0;
}

/* --------------------------------------------------------- full hand ------ */

/**
 * A hand (or crib) plus the shared starter, scored in the fixed presentation
 * order players expect to see it counted in: 15s, pairs, runs, flush, nobs.
 */
export function scoreHand(
  hand: Card[],
  starter: Card,
  isCrib: boolean,
): { total: number; breakdown: ScoreEntry[] } {
  const all = [...hand, starter];
  const breakdown: ScoreEntry[] = [];

  const fifteens = countFifteens(all);
  if (fifteens > 0) breakdown.push({ label: "15s", points: fifteens });

  const pairs = countPairs(all);
  if (pairs > 0) breakdown.push({ label: "Pairs", points: pairs });

  const runs = scoreRuns(all);
  if (runs > 0) breakdown.push({ label: "Runs", points: runs });

  const flush = scoreFlush(hand, starter, isCrib);
  if (flush > 0) breakdown.push({ label: "Flush", points: flush });

  const nobs = scoreNobs(hand, starter);
  if (nobs > 0) breakdown.push({ label: "His Nobs", points: nobs });

  const total = fifteens + pairs + runs + flush + nobs;
  return { total, breakdown };
}

/* ------------------------------------------------------------ pegging ----- */

/**
 * What playing `card` onto `pile` (the cards played since the count last
 * reset, oldest first, not including `card`) is worth, given the running
 * count after this play.
 *
 * Pairs during pegging are the trailing run of identical ranks in play
 * order: 5-5-6 scores nothing for the 6, but 5-5-5 scores 6 (a triple) on
 * the third five. Runs are the longest trailing window whose ranks, sorted,
 * are consecutive and distinct; a duplicate rank inside the window breaks
 * it, which is the one real difference from a hand's runs: pegging has no
 * double runs, because a repeated value can never sort into a gap-free
 * sequence.
 */
export function scorePeggingPlay(pile: Card[], card: Card, count: number): { total: number; breakdown: ScoreEntry[] } {
  const played = [...pile, card];
  const breakdown: ScoreEntry[] = [];

  if (count === 15) breakdown.push({ label: "15", points: 2 });
  if (count === 31) breakdown.push({ label: "31", points: 2 });

  let pairRun = 1;
  for (let i = played.length - 2; i >= 0 && played[i].rank === card.rank; i -= 1) pairRun += 1;
  if (pairRun >= 2) breakdown.push({ label: pairRun === 2 ? "Pair" : "Pairs", points: pairRun * (pairRun - 1) });

  // A trailing pair (pairRun >= 2) and a trailing run can never both fire on
  // the same play: any window long enough to check for a run would have to
  // include those two equal ranks, which fails the distinctness check below
  // on its own. No special-casing needed; the two loops are naturally
  // exclusive, so both can run unconditionally.
  let runLength = 0;
  for (let length = played.length; length >= 3; length -= 1) {
    const window = played.slice(played.length - length);
    const ranks = window.map((c) => c.rank);
    const distinct = new Set(ranks);
    if (distinct.size !== length) continue;
    if (Math.max(...ranks) - Math.min(...ranks) === length - 1) {
      runLength = length;
      break;
    }
  }
  if (runLength >= 3) breakdown.push({ label: "Run", points: runLength });

  const total = breakdown.reduce((sum, entry) => sum + entry.points, 0);
  return { total, breakdown };
}
