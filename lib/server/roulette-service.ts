import "server-only";
import { randomInt } from "crypto";
import {
  isLegalBet,
  roulettePayout,
  spinRoulette,
  startRouletteRound,
  toRouletteSnapshot,
  type RouletteBet,
  type RouletteRound,
  type RouletteSnapshot,
} from "@/lib/arcade/roulette";
import type { StakesTier } from "@/lib/game/tiers";
import {
  openCasinoRound,
  readCasinoRound,
  settleCasinoRound,
  type CasinoGame,
  type CasinoView,
} from "./casino-round-service";

/**
 * Roulette's wiring into the wallet.
 *
 * Every rule about the order Gold moves in lives once, in
 * lib/server/casino-round-service.ts. What is here is the shape of a round:
 * the bet is placed and debited first, and the wheel is not spun until a
 * second, version-guarded request arrives.
 *
 * ## Why the bet and the spin are two requests
 *
 * They could be one. Placing the bet and drawing the pocket in a single
 * handler would be simpler and would still be honest. It would also mean a
 * double-clicked Spin button is two bets and two debits, because a round that
 * settles the moment it is created never blocks the next one -- the unique
 * index in arcade_rounds is partial on `status = 'active'`.
 *
 * Splitting them puts both guards in the player's favour. A second "place bet"
 * resumes the bet already on the layout instead of taking more Gold, and a
 * second "spin" loses the version race and changes nothing. It is also simply
 * what a roulette table does: you put a chip down, and then the wheel goes.
 *
 * The pocket is drawn on the spin request, not when the bet is placed, so
 * before the wheel turns there is no result anywhere on the server for a
 * client to reach for. That is a stronger guarantee than redacting one.
 */

export const ROULETTE_GAME = "roulette";

export type RouletteView = CasinoView<RouletteSnapshot>;

const table: CasinoGame<RouletteRound, RouletteSnapshot, RouletteBet> = {
  id: ROULETTE_GAME,
  label: "Roulette",
  snapshot: (stored) => toRouletteSnapshot(stored.round, { id: stored.id, version: stored.version }),
  // Checked before the wallet is touched. The route's zod schema has already
  // refused a malformed bet; this refuses a well-formed one that is not on the
  // layout, which is the difference between a shape and a meaning.
  validate: (bet) => (isLegalBet(bet) ? null : "That is not a bet this layout offers."),
  deal: (stake, bet) => startRouletteRound({ stake, bet }),
  payout: roulettePayout,
};

/** The caller's live bet, or null. Restores the layout after a refresh. */
export function readRouletteRound(token: string): Promise<RouletteView> {
  return readCasinoRound(table, token);
}

/** Places a bet at the tier's stake. A caller who already has one gets it back. */
export function placeRouletteBet(
  token: string,
  tier: StakesTier,
  bet: RouletteBet,
): Promise<RouletteView & { resumed: boolean }> {
  return openCasinoRound(table, token, tier, bet);
}

/**
 * Spins the wheel and settles.
 *
 * node:crypto's randomInt, not Math.random: this single draw decides the whole
 * round, and it happens here rather than in the browser precisely so it is not
 * something a player can reach or replay.
 */
export function spinRouletteWheel(
  token: string,
  input: { roundId: string; version: number },
): Promise<RouletteView> {
  return settleCasinoRound(table, token, input, (round) => {
    if (round.phase !== "bet") return { reject: "That wheel has already been spun." };
    return { next: spinRoulette(round, randomInt), settled: true };
  });
}
