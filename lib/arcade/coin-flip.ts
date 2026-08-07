/**
 * Coin Flip -- call it, then bank it or let it ride.
 *
 * Pure and synchronous like every other engine here. One stake buys a run: you
 * call heads or tails, and every win compounds the pot and offers the choice
 * again. Bank and it is yours; miss and the whole run is gone.
 *
 * ## Why this is not "double or nothing"
 *
 * That is what the catalogue used to promise, and it is a game the house
 * cannot offer. A fair coin paying exactly 2x gross returns
 * `0.5 x 2 = 1.00` -- a house edge of precisely zero. Every other game in this
 * arcade is priced at a real margin, so a break-even one is not a generous
 * game, it is a hole: unlimited variance with no sink, which is how a Gold
 * economy is farmed rather than played.
 *
 * The fix is the one Hi-Lo already uses, and it is applied the same way for
 * the same reason: the coin stays honest -- genuinely 50/50, drawn from
 * node:crypto -- and the *price* carries the margin. Fair net odds on a coin
 * are 1 to 1; the house takes COIN_FLIP_HOUSE_EDGE off that, so a win pays
 * 1.97x gross. Rigging the coin instead would be the dishonest way to reach
 * the same number, and the felt could not then state its own rules truthfully.
 *
 * Note what that arithmetic actually costs a player: a 3% cut of the *fair
 * price* is a 1.5% house edge per flip, because the cut only applies to the
 * half of the time they win. That is the cheapest game in the arcade, which is
 * the right thing for the one with the smallest decision in it.
 *
 * ## Letting it ride is the game
 *
 * A single flip is a coin toss and nothing more. The run is what makes it
 * worth sitting down for: after each win the pot is compounded and the player
 * decides again, so the interesting question is never "heads or tails" -- it
 * is "is this enough". The cap exists so that question always has an answer.
 */

import type { RandomInt } from "@/lib/game/deck";

export type CoinSide = "heads" | "tails";
export type CoinFlipPhase = "call" | "decide" | "settled";

/** The house's cut of the fair price, as a fraction. Same convention as HI_LO_HOUSE_EDGE. */
export const COIN_FLIP_HOUSE_EDGE = 0.03;

/**
 * What the pot is multiplied by on a win. Fair even money, less the cut.
 *
 * Gross: 1.97 means the pot becomes 1.97x, not that 1.97x is added.
 */
export const COIN_FLIP_MULTIPLIER = 2 * (1 - COIN_FLIP_HOUSE_EDGE / 2);

/**
 * How many wins a run can hold before it is banked automatically.
 *
 * Six, which is about 58x the stake. Not an arbitrary tidiness limit: without
 * it the pot compounds without bound, and at the 500k tier a long run would
 * mint tens of millions of Gold out of a game with a 1.5% edge. The cap is
 * announced on the felt, because a run that ends without the player choosing
 * to end it must never be a surprise.
 */
export const MAX_STREAK = 6;

export interface CoinFlipRound {
  stake: number;
  /** What is riding right now. Starts at the stake and compounds on each win. */
  pot: number;
  streak: number;
  /** Every flip so far, oldest first. Public -- these have all been shown. */
  results: CoinSide[];
  /** The side called on the flip that just happened. */
  call: CoinSide | null;
  phase: CoinFlipPhase;
  /** True when the run ended by choice (or by the cap) rather than by a miss. */
  banked: boolean;
  /** Net change in Gold, settled only. Negative is a loss. */
  netGold: number;
}

/** What the pot becomes after one more win. Floored, so a fractional Gold falls to the house. */
export function nextPot(pot: number): number {
  return Math.floor(pot * COIN_FLIP_MULTIPLIER);
}

/** What a settled round pays back, GROSS. A banked run pays its pot; a miss pays nothing. */
export function coinFlipPayout(round: CoinFlipRound): number {
  if (round.phase !== "settled" || !round.banked) return 0;
  return round.pot;
}

export function startCoinFlipRound({ stake }: { stake: number }): CoinFlipRound {
  if (!Number.isFinite(stake) || stake <= 0) throw new Error("A round needs a positive stake.");
  const floored = Math.floor(stake);
  return {
    stake: floored,
    pot: floored,
    streak: 0,
    results: [],
    call: null,
    phase: "call",
    banked: false,
    netGold: 0,
  };
}

export function canCall(round: CoinFlipRound): boolean {
  return round.phase === "call" || round.phase === "decide";
}

export function canBank(round: CoinFlipRound): boolean {
  // Only after a win. Banking before the first flip would be a way to take a
  // stake out of the wallet and put it straight back, which is not a game.
  return round.phase === "decide";
}

/**
 * Calls a side and flips.
 *
 * The coin is drawn here from an injected `randomInt`, exactly like every
 * other deal in the arcade -- the route hands it node:crypto's. It is a true
 * 50/50; the margin is in COIN_FLIP_MULTIPLIER, not in the coin.
 *
 * Inert on a round that cannot be called rather than throwing: the service
 * re-checks first, and a throw there would be a 500 where a 409 belongs.
 */
export function flipCoin(round: CoinFlipRound, call: CoinSide, randomInt: RandomInt): CoinFlipRound {
  if (!canCall(round)) return round;

  const landed: CoinSide = randomInt(2) === 0 ? "heads" : "tails";
  const results = [...round.results, landed];

  if (landed !== call) {
    // The whole run, not just the last win. That is what makes riding a
    // decision rather than a formality.
    return { ...round, results, call, pot: 0, phase: "settled", banked: false, netGold: -round.stake };
  }

  const streak = round.streak + 1;
  const pot = nextPot(round.pot);

  // At the cap the run banks itself. Leaving it in `decide` with no legal ride
  // would be a screen offering a choice that does not exist.
  if (streak >= MAX_STREAK) {
    return { ...round, results, call, pot, streak, phase: "settled", banked: true, netGold: pot - round.stake };
  }

  return { ...round, results, call, pot, streak, phase: "decide", banked: false, netGold: 0 };
}

/**
 * Takes the money.
 *
 * Inert unless the run is sitting on a win, for the same reason as above.
 */
export function bankCoinFlip(round: CoinFlipRound): CoinFlipRound {
  if (!canBank(round)) return round;
  return { ...round, phase: "settled", banked: true, netGold: round.pot - round.stake };
}

export function coinFlipOutcomeLabel(round: Pick<CoinFlipRound, "phase" | "banked" | "streak" | "results">): string {
  if (round.phase === "call") return "Call it";
  if (round.phase === "decide") return `${round.streak} in a row`;
  if (!round.banked) {
    const landed = round.results[round.results.length - 1];
    return landed ? `${landed === "heads" ? "Heads" : "Tails"} — run over` : "Run over";
  }
  return round.streak >= MAX_STREAK ? `${MAX_STREAK} in a row — capped out` : `Banked on ${round.streak}`;
}

/**
 * The round as the browser may see it.
 *
 * Unusually for this arcade there is nothing to redact: no deck, and the coin
 * for the *next* flip has not been drawn yet, so it does not exist to leak.
 * The snapshot still exists rather than sending the round straight out,
 * because "there is nothing secret in here today" is a fact about the current
 * rules, and the boundary is what keeps it true when they change.
 */
export interface CoinFlipSnapshot {
  id: string;
  version: number;
  stake: number;
  pot: number;
  streak: number;
  results: CoinSide[];
  call: CoinSide | null;
  phase: CoinFlipPhase;
  banked: boolean;
  netGold: number;
  /** What the pot becomes on one more win -- shown on the Ride button before it is pressed. */
  potIfWon: number;
  maxStreak: number;
}

export function toCoinFlipSnapshot(
  round: CoinFlipRound,
  meta: { id: string; version: number },
): CoinFlipSnapshot {
  return {
    id: meta.id,
    version: meta.version,
    stake: round.stake,
    pot: round.pot,
    streak: round.streak,
    results: [...round.results],
    call: round.call,
    phase: round.phase,
    banked: round.banked,
    netGold: round.netGold,
    potIfWon: nextPot(round.pot),
    maxStreak: MAX_STREAK,
  };
}
