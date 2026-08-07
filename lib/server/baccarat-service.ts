import "server-only";
import { randomInt } from "crypto";
import {
  baccaratPayout,
  dealBaccaratCoup,
  isLegalSide,
  startBaccaratRound,
  toBaccaratSnapshot,
  type BaccaratRound,
  type BaccaratSide,
  type BaccaratSnapshot,
} from "@/lib/arcade/baccarat";
import type { StakesTier } from "@/lib/game/tiers";
import {
  openCasinoRound,
  readCasinoRound,
  settleCasinoRound,
  type CasinoGame,
  type CasinoView,
} from "./casino-round-service";

/**
 * Baccarat's wiring into the wallet.
 *
 * The ordering rules live once, in lib/server/casino-round-service.ts. What is
 * particular to this table is that the shoe is built inside `dealBaccaratCoup`
 * and thrown away: a round waiting to be dealt holds no cards, and a settled
 * one holds only the cards already face up. So there is nothing in the stored
 * state a client could learn anything from -- which is a stronger position
 * than redaction, and the reason `toBaccaratSnapshot` is a boundary rather
 * than a filter.
 *
 * The bet and the deal are two requests for the same reason roulette's bet and
 * spin are: a coup that settled on creation would never block the next one, so
 * a double-clicked Deal would be two coups and two stakes.
 */

export const BACCARAT_GAME = "baccarat";

export type BaccaratView = CasinoView<BaccaratSnapshot>;

const table: CasinoGame<BaccaratRound, BaccaratSnapshot, BaccaratSide> = {
  id: BACCARAT_GAME,
  label: "Baccarat",
  snapshot: (stored) => toBaccaratSnapshot(stored.round, { id: stored.id, version: stored.version }),
  validate: (side) => (isLegalSide(side) ? null : "That is not a side this table offers."),
  deal: (stake, bet) => startBaccaratRound({ stake, bet }),
  payout: baccaratPayout,
};

/** The caller's live bet, or null. Restores the felt after a refresh. */
export function readBaccaratRound(token: string): Promise<BaccaratView> {
  return readCasinoRound(table, token);
}

/** Backs a side at the tier's stake. A caller who already has a bet down gets it back. */
export function placeBaccaratBet(
  token: string,
  tier: StakesTier,
  bet: BaccaratSide,
): Promise<BaccaratView & { resumed: boolean }> {
  return openCasinoRound(table, token, tier, bet);
}

/**
 * Deals the coup and settles.
 *
 * Nobody chooses anything after this point -- punto banco's tableau decides
 * every card -- so this one request plays the hand out end to end. The shoe is
 * shuffled here from node:crypto's randomInt rather than in the browser, for
 * the same reason every other deal in the arcade is.
 */
export function dealBaccarat(
  token: string,
  input: { roundId: string; version: number },
): Promise<BaccaratView> {
  return settleCasinoRound(table, token, input, (round) => {
    if (round.phase !== "bet") return { reject: "That coup has already been dealt." };
    return { next: dealBaccaratCoup(round, randomInt), settled: true };
  });
}
