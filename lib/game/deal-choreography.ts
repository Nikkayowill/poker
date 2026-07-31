/**
 * When each hole card leaves the deck.
 *
 * A dealer puts one card in front of every player, then goes round again --
 * so the schedule is nothing more than the position of a card in that
 * sequence. Expressing it that way rather than as separate per-seat and
 * per-card offsets is what makes the second round provably land after the
 * first: with independent offsets the two overlap the moment a table has
 * enough seats, and seat 0's second card arrives before seat 5 has been
 * dealt at all.
 *
 * WHY THIS IS A MODULE AND NOT THREE NUMBERS IN A STYLE OBJECT
 *
 * The server starts the turn clock when the hand is dealt, and it does not
 * wait for CSS. Every millisecond spent here is a millisecond of a real
 * countdown in which a player cannot yet see their own hand, so the total is
 * a number that has to stay honest as the animation is tuned -- hence
 * dealSettledByMs() and the bound asserted over it in the tests.
 *
 * Slot, not seat position: slot 0 is the near edge of the ring, which is
 * where the local player always sits (see orderedSeats in poker-table.tsx).
 * Dealing by slot therefore deals to *you* first. That is both what the
 * sweep should look like from the camera's chair and the defensive choice --
 * previously the schedule keyed off the engine's seat position, so a player
 * in seat 5 waited 1,195ms for a card they were already on the clock for.
 */

/** Before the first card moves, so a new hand does not start mid-blink. */
export const DEAL_LEAD_MS = 80;

/** Between one card leaving the deck and the next. */
export const DEAL_STEP_MS = 60;

/** How long a single card spends in the air; matches deal-to-seat in 08-seat.css. */
export const DEAL_FLIGHT_MS = 500;

/**
 * The delay for the card at `cardIndex` belonging to the seat at `slot`, on a
 * ring of `seatCount`. Round-robin: every seat gets card 0 before any seat
 * gets card 1.
 */
export function dealDelayMs(
  slot: number,
  cardIndex: number,
  seatCount: number,
): number {
  const sequence = cardIndex * Math.max(1, seatCount) + slot;
  return DEAL_LEAD_MS + sequence * DEAL_STEP_MS;
}

/** When the last card of the deal has finished moving. */
export function dealSettledByMs(seatCount: number, cardsPerSeat = 2): number {
  const lastSequence = Math.max(0, cardsPerSeat * Math.max(1, seatCount) - 1);
  return DEAL_LEAD_MS + lastSequence * DEAL_STEP_MS + DEAL_FLIGHT_MS;
}
