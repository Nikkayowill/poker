import "server-only";
import { randomInt } from "crypto";
import {
  bankCoinFlip,
  canBank,
  canCall,
  coinFlipPayout,
  flipCoin,
  startCoinFlipRound,
  toCoinFlipSnapshot,
  type CoinFlipRound,
  type CoinFlipSnapshot,
  type CoinSide,
} from "@/lib/arcade/coin-flip";
import type { StakesTier } from "@/lib/game/tiers";
import {
  openCasinoRound,
  readCasinoRound,
  settleCasinoRound,
  type CasinoGame,
  type CasinoView,
} from "./casino-round-service";

/**
 * Coin Flip's wiring into the wallet.
 *
 * The ordering rules live once, in lib/server/casino-round-service.ts. Coin
 * Flip is the first game here that takes more than one action per round, and
 * that is the only thing worth saying about it:
 *
 *   - A **call** either ends the run (a miss settles it) or leaves it live,
 *     with the pot compounded, waiting on a decision. So `settled` is read off
 *     the round the engine returns rather than assumed.
 *   - A **bank** always settles.
 *
 * Both go through the same version-guarded write, so a double-clicked Ride
 * cannot flip twice off one decision, and a double-clicked Bank cannot pay a
 * pot twice. That is not belt-and-braces here: the pot compounds, so a
 * duplicate flip is a materially different amount of Gold, not a repeated one.
 */

export const COIN_FLIP_GAME = "coin-flip";

export type CoinFlipView = CasinoView<CoinFlipSnapshot>;

const table: CasinoGame<CoinFlipRound, CoinFlipSnapshot> = {
  id: COIN_FLIP_GAME,
  label: "Coin Flip",
  snapshot: (stored) => toCoinFlipSnapshot(stored.round, { id: stored.id, version: stored.version }),
  deal: (stake) => startCoinFlipRound({ stake }),
  payout: coinFlipPayout,
};

/** The caller's live run, or null. Restores the coin after a refresh. */
export function readCoinFlipRound(token: string): Promise<CoinFlipView> {
  return readCasinoRound(table, token);
}

/** Buys a run at the tier's stake. A caller who already has one gets it back. */
export function startCoinFlipRun(
  token: string,
  tier: StakesTier,
): Promise<CoinFlipView & { resumed: boolean }> {
  return openCasinoRound(table, token, tier, undefined);
}

/**
 * Calls a side and flips.
 *
 * node:crypto's randomInt, drawn here rather than in the browser. The coin is
 * a true 50/50 -- the house's margin is entirely in what a win pays, so there
 * is nothing about this draw that needs to be anything other than fair.
 */
export function callCoinFlip(
  token: string,
  input: { roundId: string; version: number; call: CoinSide },
): Promise<CoinFlipView> {
  return settleCasinoRound(table, token, input, (round) => {
    if (!canCall(round)) return { reject: "That run is already over." };
    const next = flipCoin(round, input.call, randomInt);
    // A win leaves the run live; only a miss or the cap ends it. Read off the
    // engine's answer rather than restated, so the two cannot disagree about
    // whether Gold is owed.
    return { next, settled: next.phase === "settled" };
  });
}

/** Takes the pot and ends the run. */
export function bankCoinFlipRun(
  token: string,
  input: { roundId: string; version: number },
): Promise<CoinFlipView> {
  return settleCasinoRound(table, token, input, (round) => {
    if (!canBank(round)) return { reject: "There is nothing to bank yet." };
    return { next: bankCoinFlip(round), settled: true };
  });
}
