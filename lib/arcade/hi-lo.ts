/**
 * Hi-Lo.
 *
 * A base card is dealt face up; the player calls whether the next card off
 * the deck is higher or lower. One call, one draw, settled.
 *
 * Pure and synchronous like lib/arcade/blackjack.ts and lib/game/engine.ts:
 * every function takes a round and returns the next one. Nothing here reads a
 * clock, a store or a request, which is what puts the whole rule set --
 * including the payout table, the part worth getting right -- inside
 * `npm test`.
 *
 * ## The two rules that make the odds work
 *
 * **Aces are high** and the order is `RANKS` from lib/game/deck.ts, which is
 * already 2..A. Using that rather than restating an order means the arcade
 * cannot disagree with the deck it draws from.
 *
 * **A tie loses.** This is not house greed, it is what makes the game exist.
 * Pay attention to the degenerate case: with ties pushing, calling "higher"
 * on a 2 is a *certainty* -- every other card in the deck beats it -- so fair
 * odds would pay exactly zero and the player would be staking Gold to win
 * nothing. Counting the three remaining same-rank cards as a loss makes even
 * the safest call a real 48/51 bet that can pay something. The felt says
 * "Ties lose" in as many words; a rule this load-bearing must not be
 * discovered.
 *
 * ## The payout
 *
 * Odds are derived from the actual remaining deck, never fixed. Fixed even
 * money would be catastrophic here: calling "higher" on a 2 wins 94% of the
 * time, so a flat 1:1 table is a money pump pointed at the house's own
 * balance. For a call that wins on `w` of the 51 unseen cards, the fair net
 * multiplier is `(51 - w) / w`, and the house takes HI_LO_HOUSE_EDGE off it.
 *
 * Because exactly one card leaves the deck before the draw, `w` depends only
 * on the base card's rank -- so the multiplier is fully determined by the
 * face-up card and can honestly be shown to the player *before* they call.
 */

import { makeDeck, RANKS, type RandomInt } from "@/lib/game/deck";
import type { Card, Rank } from "@/lib/game/types";

export type HiLoCall = "higher" | "lower";
export type HiLoPhase = "call" | "settled";
/** `tie` pays like a miss; it is separate only so the felt can say which happened. */
export type HiLoOutcome = "win" | "miss" | "tie";

/** The house's cut of the fair price, as a fraction. */
export const HI_LO_HOUSE_EDGE = 0.03;
/** Cards left after the base card is dealt. */
export const HI_LO_UNSEEN = 51;

export interface HiLoRound {
  /** Undealt cards. Dealt from the end with pop(), like every other deck here. */
  deck: Card[];
  baseCard: Card;
  /** Null until the player calls -- there is nothing to draw before then. */
  drawnCard: Card | null;
  stake: number;
  call: HiLoCall | null;
  phase: HiLoPhase;
  outcome: HiLoOutcome | null;
  /** Net change in Gold, settled only. Negative is a loss. */
  netGold: number;
}

export interface HiLoSide {
  /** How many of the 51 unseen cards win this call. */
  winners: number;
  /** Net multiplier on the stake: a win pays `floor(stake * multiplier)`. */
  multiplier: number;
  /**
   * False when no card can win it -- "lower" on a 2, "higher" on an ace.
   * Offering a call that cannot be won at any price would be a button that
   * only ever takes money.
   */
  available: boolean;
}

export interface HiLoOdds {
  higher: HiLoSide;
  lower: HiLoSide;
  /** Same-rank cards left. Always 3, and they lose -- surfaced so the UI need not restate the rule. */
  ties: number;
}

/** Ace-high ordinal, 0 for a 2 through 12 for an ace. */
export function rankOrdinal(rank: Rank): number {
  return RANKS.indexOf(rank);
}

function side(winners: number): HiLoSide {
  if (winners <= 0) return { winners: 0, multiplier: 0, available: false };
  const fair = (HI_LO_UNSEEN - winners) / winners;
  return { winners, multiplier: fair * (1 - HI_LO_HOUSE_EDGE), available: true };
}

/**
 * What each call is worth against a given base card.
 *
 * One deck, one card face up, so the counts are pure arithmetic on the rank
 * rather than a scan of the remaining deck -- and being a function of the
 * rank alone is exactly why the player can be shown the price before they
 * commit.
 */
export function hiLoOdds(baseCard: Card): HiLoOdds {
  const ordinal = rankOrdinal(baseCard.rank);
  // Four of every rank; one card of the base rank is already face up.
  return {
    higher: side(4 * (RANKS.length - 1 - ordinal)),
    lower: side(4 * ordinal),
    ties: 3,
  };
}

/** What a settled round pays back, given the stake was debited when it opened. */
export function hiLoPayout(round: HiLoRound): number {
  if (round.phase !== "settled") return 0;
  return round.stake + round.netGold;
}

export function legalHiLoCalls(round: HiLoRound): Record<HiLoCall, boolean> {
  if (round.phase !== "call") return { higher: false, lower: false };
  const odds = hiLoOdds(round.baseCard);
  return { higher: odds.higher.available, lower: odds.lower.available };
}

/** Opens a round against a supplied deck. Tests pass an exact deck; the app calls dealHiLoRound. */
export function startHiLoRound({ stake, deck }: { stake: number; deck: Card[] }): HiLoRound {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("A round needs a positive stake.");
  const cards = [...deck];
  const baseCard = cards.pop();
  if (!baseCard) throw new Error("The deck ran out of cards.");
  return {
    deck: cards,
    baseCard,
    drawnCard: null,
    stake: Math.floor(stake),
    call: null,
    phase: "call",
    outcome: null,
    netGold: 0,
  };
}

/** A shuffled round from the shared 52-card deck. randomInt is injected, as in lib/game/deck.ts. */
export function dealHiLoRound(stake: number, randomInt: RandomInt): HiLoRound {
  return startHiLoRound({ stake, deck: makeDeck(randomInt) });
}

/**
 * The player's one decision. Draws, compares, settles.
 *
 * Inert on a call that is not open or not winnable, rather than throwing: the
 * service re-checks legality before this and a thrown error there would be a
 * 500 where a 409 belongs.
 */
export function callHiLo(round: HiLoRound, call: HiLoCall): HiLoRound {
  if (!legalHiLoCalls(round)[call]) return round;
  const deck = [...round.deck];
  const drawnCard = deck.pop();
  if (!drawnCard) throw new Error("The deck ran out of cards.");

  const base = rankOrdinal(round.baseCard.rank);
  const drawn = rankOrdinal(drawnCard.rank);
  const outcome: HiLoOutcome =
    drawn === base ? "tie"
      : (call === "higher") === (drawn > base) ? "win"
        : "miss";

  const multiplier = hiLoOdds(round.baseCard)[call].multiplier;
  // Rounded down, so a fractional Gold always falls to the house -- the same
  // direction blackjack's 3:2 rounds on an odd stake.
  const netGold = outcome === "win" ? Math.floor(round.stake * multiplier) : -round.stake;

  return { ...round, deck, drawnCard, call, phase: "settled", outcome, netGold };
}

export function hiLoOutcomeLabel(outcome: HiLoOutcome): string {
  switch (outcome) {
    case "win":
      return "Called it";
    case "miss":
      return "Missed";
    case "tie":
      return "Tie — house takes it";
  }
}

/**
 * The round as the browser may see it.
 *
 * `deck` is gone, which is the entire point of the server holding the round:
 * the next card is sitting on top of it, and a client that could read it
 * would never lose. Everything else is already public -- the base card is
 * face up and the odds are derived from it.
 */
export interface HiLoSnapshot {
  id: string;
  version: number;
  baseCard: Card;
  drawnCard: Card | null;
  stake: number;
  call: HiLoCall | null;
  phase: HiLoPhase;
  outcome: HiLoOutcome | null;
  netGold: number;
  odds: HiLoOdds;
  legal: Record<HiLoCall, boolean>;
}

export function toHiLoSnapshot(round: HiLoRound, meta: { id: string; version: number }): HiLoSnapshot {
  return {
    id: meta.id,
    version: meta.version,
    baseCard: { ...round.baseCard },
    drawnCard: round.drawnCard ? { ...round.drawnCard } : null,
    stake: round.stake,
    call: round.call,
    phase: round.phase,
    outcome: round.outcome,
    netGold: round.netGold,
    odds: hiLoOdds(round.baseCard),
    legal: legalHiLoCalls(round),
  };
}
