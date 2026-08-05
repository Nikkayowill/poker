/**
 * Single-player Blackjack.
 *
 * Pure and synchronous, like lib/game/engine.ts: every function takes a round
 * and returns the next one, nothing here reads a clock, a store or a request.
 * That is what makes the whole rule set reachable from `npm test`, and it is
 * also what would let a server route own the round later without rewriting
 * any of it -- see the note on settlement at the bottom of this file.
 *
 * House rules, fixed and deliberately few (this is the fast arcade game, not
 * a casino simulator):
 *
 *   - One deck, reshuffled every round. Nothing to count.
 *   - Dealer STANDS on soft 17 (S17): hits while the total is under 17, and
 *     stands on any 17 including A-6.
 *   - A natural pays 3:2. Two naturals push.
 *   - Double down is offered on the opening two cards only, draws exactly one
 *     card, and doubles the wager.
 *   - No splitting, no insurance, no surrender.
 */

import { makeDeck, type RandomInt } from "@/lib/game/deck";
import type { Card, Rank } from "@/lib/game/types";

export type BlackjackPhase = "player-turn" | "dealer-turn" | "settled";

export type BlackjackOutcome =
  | "player-blackjack"
  | "player-win"
  | "dealer-bust"
  | "dealer-win"
  | "player-bust"
  | "push";

export interface HandTotal {
  /** The best total that is not a bust, or the hard total once it busts. */
  total: number;
  /** True when an ace is still counted as 11 -- the hand cannot bust on the next card. */
  soft: boolean;
  busted: boolean;
}

export interface BlackjackRound {
  /** Undealt cards. Dealt from the end with pop(), the same way the poker engine does. */
  deck: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  /** What the player opened for. Kept separate so the UI can show "500 doubled to 1,000". */
  baseStake: number;
  /** What is actually at risk now -- twice baseStake after a double. */
  stake: number;
  doubled: boolean;
  phase: BlackjackPhase;
  outcome: BlackjackOutcome | null;
  /**
   * Net change in Gold for the round, settled only. Negative is a loss, zero
   * is a push, and a natural is +1.5x rounded down (a half-unit only exists
   * on odd stakes, and rounding the house's way is the honest default).
   */
  netGold: number;
}

export interface LegalBlackjackActions {
  hit: boolean;
  stand: boolean;
  double: boolean;
}

/** Dealer stands on this, hard or soft. */
export const DEALER_STANDS_ON = 17;
export const BLACKJACK = 21;
/** A natural pays 3:2. */
export const BLACKJACK_PAYOUT = 1.5;

const cardValues: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  J: 10, Q: 10, K: 10, A: 11,
};

/**
 * Aces count 11 until that would bust, then 1. Counting down from all-elevens
 * rather than up handles multiple aces for free: A-A-9 demotes exactly one ace
 * and lands on 21, not 12 or 31.
 */
export function handTotal(cards: readonly Card[]): HandTotal {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValues[card.rank];
    if (card.rank === "A") aces += 1;
  }
  while (total > BLACKJACK && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0, busted: total > BLACKJACK };
}

/** A natural: 21 on the opening two cards. A 21 built over three cards is not one and does not pay 3:2. */
export function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === BLACKJACK;
}

function draw(round: BlackjackRound): Card {
  const card = round.deck.pop();
  // One deck against one player tops out around twenty cards, so this is a
  // guard against a caller reusing a spent round, not a real deal path.
  if (!card) throw new Error("The deck ran out of cards.");
  return card;
}

/** Rounds toward the house on a half-unit, which only an odd stake can produce. */
function naturalPayout(stake: number): number {
  return Math.floor(stake * BLACKJACK_PAYOUT);
}

function settle(round: BlackjackRound, outcome: BlackjackOutcome): BlackjackRound {
  const netGold = (() => {
    switch (outcome) {
      case "player-blackjack":
        return naturalPayout(round.stake);
      case "player-win":
      case "dealer-bust":
        return round.stake;
      case "player-bust":
      case "dealer-win":
        return -round.stake;
      case "push":
        return 0;
    }
  })();
  return { ...round, phase: "settled", outcome, netGold };
}

/**
 * The dealer's whole turn, played out in one call. There is no decision to
 * surface -- S17 is deterministic -- so exposing it a card at a time would be
 * a state machine that exists only for the animation, which the view can pace
 * from the finished hand instead.
 */
function playDealer(round: BlackjackRound): BlackjackRound {
  const next: BlackjackRound = { ...round, dealerHand: [...round.dealerHand], phase: "dealer-turn" };
  // `< DEALER_STANDS_ON`, not `<= 16`: the same expression stands on a soft 17
  // and on a hard one, which is the rule this table advertises.
  while (handTotal(next.dealerHand).total < DEALER_STANDS_ON) {
    next.dealerHand.push(draw(next));
  }

  const dealer = handTotal(next.dealerHand);
  const player = handTotal(next.playerHand);
  if (dealer.busted) return settle(next, "dealer-bust");
  if (dealer.total > player.total) return settle(next, "dealer-win");
  if (dealer.total < player.total) return settle(next, "player-win");
  return settle(next, "push");
}

/**
 * Open a round against a supplied deck. Tests pass an exact deck; the app
 * calls dealRound() below. Cards come off the end, so the last entry is the
 * player's first card.
 */
export function startRound({ stake, deck }: { stake: number; deck: Card[] }): BlackjackRound {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("A round needs a positive stake.");

  const round: BlackjackRound = {
    deck: [...deck],
    playerHand: [],
    dealerHand: [],
    baseStake: Math.floor(stake),
    stake: Math.floor(stake),
    doubled: false,
    phase: "player-turn",
    outcome: null,
    netGold: 0,
  };

  // Alternating, player first -- the order a real table deals in, and the
  // order the view animates.
  round.playerHand.push(draw(round));
  round.dealerHand.push(draw(round));
  round.playerHand.push(draw(round));
  round.dealerHand.push(draw(round));

  const playerNatural = isNatural(round.playerHand);
  const dealerNatural = isNatural(round.dealerHand);
  if (playerNatural && dealerNatural) return settle(round, "push");
  if (playerNatural) return settle(round, "player-blackjack");
  if (dealerNatural) return settle(round, "dealer-win");
  return round;
}

/** A shuffled round from the shared 52-card deck. randomInt is injected for the same reason it is in lib/game/deck.ts. */
export function dealRound(stake: number, randomInt: RandomInt): BlackjackRound {
  return startRound({ stake, deck: makeDeck(randomInt) });
}

export function hit(round: BlackjackRound): BlackjackRound {
  if (round.phase !== "player-turn") return round;
  const next: BlackjackRound = { ...round, deck: [...round.deck], playerHand: [...round.playerHand] };
  next.playerHand.push(draw(next));
  if (handTotal(next.playerHand).busted) return settle(next, "player-bust");
  // Standing for them on a drawn 21 saves a click that has exactly one sane
  // answer, and cannot cost anything: there is no card that improves 21.
  if (handTotal(next.playerHand).total === BLACKJACK) return playDealer(next);
  return next;
}

export function stand(round: BlackjackRound): BlackjackRound {
  if (round.phase !== "player-turn") return round;
  return playDealer(round);
}

/**
 * Double down: twice the wager, exactly one card, turn over. Busting on that
 * card settles at the doubled stake -- which is the risk being taken, and is
 * why the caller has to check the wallet covers it before offering it.
 */
export function doubleDown(round: BlackjackRound): BlackjackRound {
  if (!legalBlackjackActions(round).double) return round;
  const next: BlackjackRound = {
    ...round,
    deck: [...round.deck],
    playerHand: [...round.playerHand],
    stake: round.stake * 2,
    doubled: true,
  };
  next.playerHand.push(draw(next));
  if (handTotal(next.playerHand).busted) return settle(next, "player-bust");
  return playDealer(next);
}

export function legalBlackjackActions(round: BlackjackRound): LegalBlackjackActions {
  const live = round.phase === "player-turn";
  return {
    hit: live,
    stand: live,
    // Opening two cards only. After a hit the wager is locked.
    double: live && round.playerHand.length === 2,
  };
}

/**
 * What the dealer is showing. The hole card is the second one dealt, and it
 * stays hidden until the dealer's turn -- so the view renders from this rather
 * than from dealerHand, and a player poking at the client state during their
 * own turn finds a hand that genuinely does not contain the hole card yet.
 */
export function dealerUpCards(round: BlackjackRound): Card[] {
  return round.phase === "player-turn" ? round.dealerHand.slice(0, 1) : round.dealerHand;
}

export function outcomeLabel(outcome: BlackjackOutcome): string {
  switch (outcome) {
    case "player-blackjack":
      return "Blackjack!";
    case "player-win":
      return "You win";
    case "dealer-bust":
      return "Dealer busts";
    case "dealer-win":
      return "Dealer wins";
    case "player-bust":
      return "Bust";
    case "push":
      return "Push";
  }
}

/**
 * Whether a wallet can open at this stake, and whether it could still cover a
 * double on top of it.
 *
 * This is a *display* predicate. Nothing here debits anyone -- netGold is a
 * number a settled round reports, not one it applies. A round played in the
 * browser cannot be allowed to move real Gold (the client would simply report
 * whatever result it liked), so wiring this to the wallet means a server route
 * that owns the deck and returns the round, exactly as
 * app/api/games/[id]/actions does for poker. Until that exists the arcade
 * table is play-money and says so.
 */
export function canCoverStake(
  stake: number,
  wallet: { goldBalance: number; unlimitedGold: boolean },
): { open: boolean; double: boolean } {
  if (wallet.unlimitedGold) return { open: true, double: true };
  return {
    open: wallet.goldBalance >= stake,
    double: wallet.goldBalance >= stake * 2,
  };
}
