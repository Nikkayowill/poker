/**
 * Baccarat -- punto banco.
 *
 * The one casino game with no decisions in it. You pick a side, the cards come
 * out, and a fixed tableau decides everything else; nobody at the table --
 * player, dealer or house -- chooses anything after the bet. That is what
 * makes it a good fit for this arcade: the whole game is a pure function of
 * the shoe, so the whole game is reachable from `npm test`.
 *
 * ## The tableau is the game, and it is not intuitive
 *
 * Punto banco's third-card rules look arbitrary and are not negotiable -- they
 * are what produce the house edges below. They are transcribed once, in
 * `bankerDraws`, from the standard table:
 *
 *   - A **natural** (8 or 9 in two cards, either side) ends the coup at once.
 *   - Otherwise the **player** draws on 0-5 and stands on 6-7.
 *   - The **banker** then draws by a table that depends on whether the player
 *     drew and, if so, on the value of the card they drew.
 *
 * Getting one cell of that table wrong is not a visible bug -- the game still
 * plays, still pays, and is quietly mispriced -- so every cell is asserted.
 *
 * ## The commission, and the one number that is not standard
 *
 * Banker wins slightly more often than player (it acts last), so a banker bet
 * pays 0.95 to 1 rather than even money. That 5% commission is the whole
 * reason the bet is not free money, and it leaves the classic edges: banker
 * 1.06%, player 1.24%.
 *
 * The tie is paid **9 to 1, not the more common 8 to 1**, and that is a
 * deliberate departure. At 8:1 a tie carries a 14.4% house edge -- five times
 * anything else in this arcade and roughly a trap. At 9:1 it is 4.8%: still
 * clearly the worst bet on the felt, which it should be, without being a
 * different game's worth of margin hiding on the same layout. The felt quotes
 * every price.
 */

import { makeShoe, type RandomInt } from "@/lib/game/deck";
import type { Card } from "@/lib/game/types";

/** Packs in the shoe. Eight is the casino standard. */
export const BACCARAT_DECKS = 8;

/** The banker's cut on a winning banker bet. */
export const BANKER_COMMISSION = 0.05;
/** What a winning tie pays, to one. See the note above on why this is 9 and not 8. */
export const TIE_ODDS = 9;

export type BaccaratSide = "player" | "banker" | "tie";
export type BaccaratPhase = "bet" | "settled";

/**
 * A card's point value: ace 1, pips at face, every ten and court card zero.
 *
 * The zeros are why baccarat totals behave the way they do, and why "a
 * picture" is worthless rather than valuable.
 */
export function cardPoints(card: Card): number {
  switch (card.rank) {
    case "A":
      return 1;
    case "10":
    case "J":
    case "Q":
    case "K":
      return 0;
    default:
      return Number(card.rank);
  }
}

/** A hand's total, modulo ten -- so 7 + 8 is 5, not 15. */
export function handTotal(cards: Card[]): number {
  return cards.reduce((total, card) => total + cardPoints(card), 0) % 10;
}

/** An 8 or a 9 in the opening two cards. Ends the coup where it stands. */
export function isNatural(cards: Card[]): boolean {
  return cards.length === 2 && (handTotal(cards) === 8 || handTotal(cards) === 9);
}

/** The player draws on 0-5 and stands on 6-7. The simple half of the tableau. */
export function playerDraws(total: number): boolean {
  return total <= 5;
}

/**
 * The banker's half of the tableau -- the part nobody remembers.
 *
 * `playerThird` is the point value of the card the player drew, or null if
 * they stood. When they stood, the banker plays the player's own rule; when
 * they drew, this is the standard table, cell for cell.
 */
export function bankerDraws(total: number, playerThird: number | null): boolean {
  if (playerThird === null) return total <= 5;
  switch (total) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return playerThird !== 8;
    case 4:
      return playerThird >= 2 && playerThird <= 7;
    case 5:
      return playerThird >= 4 && playerThird <= 7;
    case 6:
      return playerThird === 6 || playerThird === 7;
    default:
      // 7 stands; 8 and 9 are naturals and never reach here.
      return false;
  }
}

export interface BaccaratRound {
  stake: number;
  bet: BaccaratSide;
  playerHand: Card[];
  bankerHand: Card[];
  phase: BaccaratPhase;
  /** Who won the coup. Null until the cards are out. */
  result: BaccaratSide | null;
  /** Net change in Gold, settled only. Negative is a loss; a tie pushes a side bet to zero. */
  netGold: number;
}

/**
 * Gross return per Gold staked on each side, given the coup's result.
 *
 * Gross, so 1 is a push -- which is exactly what a tie does to a player or
 * banker bet, and getting that backwards would either eat those stakes or pay
 * them twice. Returns 0 for a loss.
 */
export function payoutMultiplier(bet: BaccaratSide, result: BaccaratSide): number {
  if (result === "tie") {
    // A tie pays the tie bet and returns everything else. Punto banco does not
    // take a stake on a tie -- a house that did would be charging for a hand
    // nobody lost.
    return bet === "tie" ? TIE_ODDS + 1 : 1;
  }
  if (bet !== result) return 0;
  return bet === "banker" ? 2 - BANKER_COMMISSION : 2;
}

/** What a settled round pays back, GROSS. */
export function baccaratPayout(round: BaccaratRound): number {
  if (round.phase !== "settled" || !round.result) return 0;
  return Math.floor(round.stake * payoutMultiplier(round.bet, round.result));
}

export function isLegalSide(side: string): side is BaccaratSide {
  return side === "player" || side === "banker" || side === "tie";
}

/** Opens a round with the bet placed and no cards out. */
export function startBaccaratRound({ stake, bet }: { stake: number; bet: BaccaratSide }): BaccaratRound {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("A round needs a positive stake.");
  if (!isLegalSide(bet)) throw new Error("That is not a side this table offers.");
  return {
    stake: Math.floor(stake),
    bet,
    playerHand: [],
    bankerHand: [],
    phase: "bet",
    result: null,
    netGold: 0,
  };
}

/**
 * Plays the whole coup against a supplied shoe. Tests pass an exact shoe; the
 * app calls dealBaccaratCoup.
 *
 * Cards come off the end with pop(), like every other deal here, and are dealt
 * in the real order -- player, banker, player, banker -- because the hands are
 * shown being dealt and an order that only looks right is one more thing that
 * can quietly stop looking right.
 */
export function playBaccaratCoup(round: BaccaratRound, shoe: Card[]): BaccaratRound {
  if (round.phase !== "bet") return round;

  const cards = [...shoe];
  const take = (): Card => {
    const card = cards.pop();
    if (!card) throw new Error("The shoe ran out of cards.");
    return card;
  };

  const playerHand = [take()];
  const bankerHand = [take()];
  playerHand.push(take());
  bankerHand.push(take());

  // Either natural ends it. Checked before any draw, which is the whole point
  // of the rule -- a natural 9 must not be given a third card.
  if (!isNatural(playerHand) && !isNatural(bankerHand)) {
    let playerThird: number | null = null;
    if (playerDraws(handTotal(playerHand))) {
      const card = take();
      playerHand.push(card);
      playerThird = cardPoints(card);
    }
    if (bankerDraws(handTotal(bankerHand), playerThird)) {
      bankerHand.push(take());
    }
  }

  const player = handTotal(playerHand);
  const banker = handTotal(bankerHand);
  const result: BaccaratSide = player === banker ? "tie" : player > banker ? "player" : "banker";
  const gross = Math.floor(round.stake * payoutMultiplier(round.bet, result));

  return {
    ...round,
    playerHand,
    bankerHand,
    phase: "settled",
    result,
    // Gross minus what was already taken. A tie on a player bet nets exactly
    // zero, which is what a push is.
    netGold: gross - round.stake,
  };
}

/**
 * Plays a coup from a fresh shoe.
 *
 * The shoe is built here and thrown away, so it is never stored: a round that
 * has not been dealt yet contains no cards at all, which is a stronger
 * guarantee than redacting them. Nothing about the outcome exists on the
 * server until this request runs.
 */
export function dealBaccaratCoup(round: BaccaratRound, randomInt: RandomInt): BaccaratRound {
  return playBaccaratCoup(round, makeShoe(BACCARAT_DECKS, randomInt));
}

export function baccaratOutcomeLabel(round: Pick<BaccaratRound, "phase" | "result" | "playerHand" | "bankerHand">): string {
  if (round.phase !== "settled" || !round.result) return "Place your bet";
  const player = handTotal(round.playerHand);
  const banker = handTotal(round.bankerHand);
  if (round.result === "tie") return `Tie on ${player}`;
  return round.result === "player" ? `Player ${player} beats ${banker}` : `Banker ${banker} beats ${player}`;
}

/** How a side reads on the felt, with the price it is offered at. */
export function sideLabel(side: BaccaratSide): string {
  switch (side) {
    case "player":
      return "Player";
    case "banker":
      return "Banker";
    case "tie":
      return "Tie";
  }
}

/** Net odds, for the layout: "1:1", "0.95:1", "9:1". */
export function sideOdds(side: BaccaratSide): string {
  switch (side) {
    case "player":
      return "1:1";
    case "banker":
      return `${(1 - BANKER_COMMISSION).toFixed(2)}:1`;
    case "tie":
      return `${TIE_ODDS}:1`;
  }
}

/**
 * The round as the browser may see it.
 *
 * There is nothing here to redact and, unusually, nothing anywhere to redact:
 * the shoe is built inside `dealBaccaratCoup` and discarded, so before the
 * deal there are no cards on the server and after it there are only the ones
 * already face up. The boundary still exists because "there is no secret
 * today" is a fact about the current rules, not a property of the type.
 */
export interface BaccaratSnapshot {
  id: string;
  version: number;
  stake: number;
  bet: BaccaratSide;
  playerHand: Card[];
  bankerHand: Card[];
  playerTotal: number;
  bankerTotal: number;
  phase: BaccaratPhase;
  result: BaccaratSide | null;
  netGold: number;
}

export function toBaccaratSnapshot(
  round: BaccaratRound,
  meta: { id: string; version: number },
): BaccaratSnapshot {
  return {
    id: meta.id,
    version: meta.version,
    stake: round.stake,
    bet: round.bet,
    playerHand: round.playerHand.map((card) => ({ ...card })),
    bankerHand: round.bankerHand.map((card) => ({ ...card })),
    playerTotal: handTotal(round.playerHand),
    bankerTotal: handTotal(round.bankerHand),
    phase: round.phase,
    result: round.result,
    netGold: round.netGold,
  };
}
