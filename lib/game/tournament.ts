import type { GameState } from "./types";

/**
 * Turbo hand-count blind schedule for a Sit & Go.
 *
 * Purely multiplicative against the table's own tier blinds rather than a
 * fixed absolute ladder: every stakes tier's minBuyIn is exactly 100x its
 * bigBlind (see tiers.ts), so a starting stack is always 100 effective big
 * blinds at level 1 no matter which tier a table registered at, and the
 * schedule's shape -- how many effective big blinds are left at each level --
 * is identical across every tier with no rounding ever needed.
 *
 * `atHand` is the first hand a level takes effect on (inclusive); the
 * schedule holds at its final entry indefinitely once reached, so a game
 * that somehow runs long never has an undefined level to fall off of.
 *
 * By level 5 (hand 21, 6x) a full starting stack is ~16.7 effective big
 * blinds; by level 9 (hand 41, 24x) it's ~4.2 -- that's what forces a table
 * to conclude within roughly 40-50 hands at realistic human hand speed,
 * matching the turbo, ~20-30 minute pace the format is built for.
 */
const BLIND_LEVELS: ReadonlyArray<{ atHand: number; multiplier: number }> = [
  { atHand: 1, multiplier: 1 },
  { atHand: 6, multiplier: 2 },
  { atHand: 11, multiplier: 3 },
  { atHand: 16, multiplier: 4 },
  { atHand: 21, multiplier: 6 },
  { atHand: 26, multiplier: 8 },
  { atHand: 31, multiplier: 12 },
  { atHand: 36, multiplier: 16 },
  { atHand: 41, multiplier: 24 },
  { atHand: 46, multiplier: 32 },
];

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
}

/**
 * The blind level active on a given hand number, and the actual small/big
 * blind at that level against a table's own base (tier) blinds.
 *
 * Recomputed fresh every hand from `handNumber` rather than tracked as a
 * counter that increments on its own, so the level can never drift out of
 * sync with the hand it's supposed to describe -- see engine.ts's setupHand,
 * the one caller.
 */
export function blindLevelForHand(
  handNumber: number,
  base: { smallBlind: number; bigBlind: number },
): BlindLevel {
  let level = 0;
  for (let i = 0; i < BLIND_LEVELS.length; i += 1) {
    if (handNumber >= BLIND_LEVELS[i].atHand) level = i;
    else break;
  }
  const { multiplier } = BLIND_LEVELS[level];
  return { level, smallBlind: base.smallBlind * multiplier, bigBlind: base.bigBlind * multiplier };
}

/**
 * Ends a Sit & Go seat's tournament early, by the seat's own choice, between
 * hands.
 *
 * Zeroes the stack and marks it "out" -- the same terminal state a bust
 * already leaves a seat in -- without touching `ownerToken`/`isHuman`.
 * Unlike a cash table's `vacateSeat`, a tournament seat is never handed to a
 * bot (there is no bot fill in this format, ever) and nothing is credited
 * back here: the entry fee already paid for a shot at the whole prize pool,
 * and leaving early forfeits what's left of it, the same way standing up
 * from a live tournament table forfeits the chips still in front of you.
 */
export function forfeitTournamentSeat(state: GameState, seatIndex: number): void {
  const seat = state.seats[seatIndex];
  seat.stack = 0;
  seat.status = "out";
}
