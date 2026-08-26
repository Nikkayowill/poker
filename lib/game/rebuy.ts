import type { GameStatus, SeatStatus } from "./types";

/**
 * Whether a zero-stack seat can rebuy right now.
 *
 * The single source of truth for a rule that used to be three separate,
 * silently-agreeing copies: applyPlayerAction's enforcement (engine.ts),
 * the /actions route's own guard on the same check, and action-bar.tsx's
 * decision about whether to even show the button. The third copy drifted --
 * it offered Rebuy the instant `stack` hit zero, with no look at `status`,
 * so a player who just busted all-in mid-hand saw a Rebuy button the other
 * two would reject until that hand actually finished deciding their seat.
 * That gap is what "have to perfectly time it" was.
 *
 * A seat that lost its last chips this same hand reads status "all-in", not
 * "out" -- only the *next* hand's setup pass relabels a zero-stack seat
 * "out". Once the hand resolves (status leaves "playing" for "complete"),
 * the seat is eligible immediately, whether or not that relabeling has run
 * yet -- see applyPlayerAction's rebuy branch, which treats "complete" as
 * license to refill and deal straight back in.
 */
export function isSeatRebuyEligible(gameStatus: GameStatus, seatStatus: SeatStatus): boolean {
  return !(gameStatus === "playing" && seatStatus !== "out");
}
