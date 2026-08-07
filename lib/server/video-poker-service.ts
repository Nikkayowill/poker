import "server-only";
import { randomInt } from "crypto";
import {
  dealVideoPokerRound,
  drawVideoPoker,
  isLegalHold,
  toVideoPokerSnapshot,
  videoPokerPayout,
  type VideoPokerRound,
  type VideoPokerSnapshot,
} from "@/lib/arcade/video-poker";
import type { StakesTier } from "@/lib/game/tiers";
import {
  openCasinoRound,
  readCasinoRound,
  settleCasinoRound,
  type CasinoGame,
  type CasinoView,
} from "./casino-round-service";

/**
 * Video Poker's wiring into the wallet.
 *
 * Short on purpose. Every rule about the order Gold moves in lives once, in
 * lib/server/casino-round-service.ts; what is left here is the three things
 * genuinely specific to this machine -- which deck it deals from, how a round
 * is redacted, and what a settled hand pays.
 *
 * The randomness is node:crypto's `randomInt`, not Math.random, and it is
 * drawn here rather than in the browser precisely so the deck is not something
 * a player can reach. That matters more at video poker than at Hi-Lo: the five
 * cards behind the draw are already sitting in the round when the hand is
 * dealt, so a client that could see the round state would know what to hold
 * before it held anything.
 */

export const VIDEO_POKER_GAME = "video-poker";

export type VideoPokerView = CasinoView<VideoPokerSnapshot>;

const machine: CasinoGame<VideoPokerRound, VideoPokerSnapshot> = {
  id: VIDEO_POKER_GAME,
  label: "Video Poker",
  snapshot: (stored) => toVideoPokerSnapshot(stored.round, { id: stored.id, version: stored.version }),
  deal: (stake) => dealVideoPokerRound(stake, randomInt),
  payout: videoPokerPayout,
};

/** The caller's live hand, or null. Restores the machine after a refresh. */
export function readVideoPokerRound(token: string): Promise<VideoPokerView> {
  return readCasinoRound(machine, token);
}

/** Deals five cards at the tier's stake. A caller who already has a hand gets it back. */
export function dealVideoPokerHand(
  token: string,
  tier: StakesTier,
): Promise<VideoPokerView & { resumed: boolean }> {
  // No `input`: the only thing a player picks before the cards come out is the
  // stake. Roulette and Baccarat choose a bet here.
  return openCasinoRound(machine, token, tier, undefined);
}

/**
 * Takes the draw and settles.
 *
 * The hold array arrives with this request rather than being toggled against
 * the server card by card. That is deliberate: a hold is a change of mind, not
 * a wager, and making each toggle a version-bumping round trip would put five
 * chances to lose a race in front of every draw. The array is re-validated
 * here, so what the client believes it held has no authority.
 */
export function drawVideoPokerHand(
  token: string,
  input: { roundId: string; version: number; held: boolean[] },
): Promise<VideoPokerView> {
  return settleCasinoRound(machine, token, input, (round) => {
    if (!isLegalHold(round, input.held)) {
      return { reject: "That hold does not match the hand on the machine." };
    }
    return { next: drawVideoPoker(round, input.held), settled: true };
  });
}
