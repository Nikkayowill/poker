/**
 * Shared shapes for the cribbage engine.
 *
 * Plain numbers/strings throughout, same discipline lib/pvp/word-race.ts
 * documents: the whole state round-trips through a jsonb column and
 * structuredClone, so nothing here may be a Map, a Set or undefined.
 */

/** A single letter, matching lib/pvp/checkers.ts's one-character-per-piece style. */
export type Suit = "S" | "H" | "D" | "C";

/** 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. Cribbage never plays Ace high. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  rank: Rank;
  suit: Suit;
}

/** A seat at the table, 0..playerCount-1. Cribbage tables are 3 or 4 seats, never 2. */
export type CribbageSeat = number;

/**
 * A card's point value for 15s/pegging: face cards are worth 10, everything
 * else is its own rank. Never used for identifying a card -- pairs and runs
 * compare `rank` itself, where a Jack and a Queen are different ranks worth
 * the same 10 points.
 */
export function pointValue(rank: Rank): number {
  return Math.min(rank, 10);
}

/**
 * "discard" -- everyone has cards, nobody has sent a card to the crib yet.
 * "pegging" -- the crib is set, the starter is cut, cards go down one at a
 * time. There is no separate "counting" phase: counting has no player
 * decisions in it, so it happens automatically the instant pegging ends (see
 * engine.ts's concludeHand) rather than waiting on a move nobody would send.
 * "done" -- the match is over. `result()` is just this field.
 */
export type CribbagePhase = "discard" | "pegging" | "done";

/** One breakdown line for a scored hand, crib, or pegging play. */
export interface ScoreEntry {
  label: string;
  points: number;
}

/** What one hand/crib was worth, for the reveal after a deal concludes. */
export interface CribbageHandEntry {
  /** Whose points these are. "crib" still credits the dealer -- see engine.ts. */
  subject: CribbageSeat | "crib";
  owner: CribbageSeat;
  cards: Card[];
  breakdown: ScoreEntry[];
  points: number;
  /** The owner's total score immediately after this entry, for a running tally. */
  runningScoreAfter: number;
}

/** The full reveal of one completed deal -- public the instant it happens. */
export interface CribbageHandSummary {
  handNumber: number;
  dealerSeat: CribbageSeat;
  starter: Card;
  /** Heels (2, if the starter was a Jack), scored to the dealer at the cut. */
  heelsPoints: number;
  entries: CribbageHandEntry[];
}

export type CribbageMove =
  | { type: "discard"; card: Card }
  | { type: "peg"; card: Card }
  | { type: "go" };
