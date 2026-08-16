import type { GameSnapshot, PlayerAction, PublicSeat } from "./types";

/**
 * A narrow, client-only prediction of the acting player's own action -- not
 * a client-side copy of the engine, and never treated as authoritative. It
 * only ever touches the caller's own seat (streetBet/committed/stack) and
 * the pot total those numbers must stay consistent with (poker-table.tsx
 * renders the centre pile as `pot - Σ streetBet`, so the two have to move
 * together or that pile visibly jumps). The amounts it uses --
 * `legal.callAmount`, a raise's own target -- are exactly what the
 * ActionBar already shows the player before they click; this doesn't add
 * any new betting logic, it just applies that same arithmetic one round
 * trip earlier so the chip layer's streetBet-delta animation
 * (poker-table.tsx) starts on the tap instead of on the response.
 *
 * Everything else -- whose turn is next, the street, other seats, showdown
 * -- is left exactly as the last confirmed snapshot; those only ever change
 * once the real response arrives. Callers must apply this through
 * useOptimistic inside a transition, never through setState directly: React
 * discards the prediction the moment the underlying game state actually
 * updates (success) or the transition settles without one (failure), so a
 * declined action never sticks.
 */
export function applyOptimisticAction(
  game: GameSnapshot | null,
  action: PlayerAction,
): GameSnapshot | null {
  if (!game) return game;
  const legal = game.legalActions;
  const mySeatIndex = game.seats.findIndex((seat) => seat.isMine);
  if (!legal || mySeatIndex === -1) return game;
  const mySeat = game.seats[mySeatIndex];

  const commit = (paid: number): PublicSeat => {
    const stack = mySeat.stack - paid;
    return {
      ...mySeat,
      streetBet: mySeat.streetBet + paid,
      committed: mySeat.committed + paid,
      stack,
      status: stack <= 0 ? "all-in" : mySeat.status,
    };
  };

  let nextSeat: PublicSeat;
  let paid: number;
  switch (action.type) {
    case "fold":
      nextSeat = { ...mySeat, status: "folded" };
      paid = 0;
      break;
    case "call":
      paid = legal.callAmount;
      nextSeat = commit(paid);
      break;
    case "raise":
      paid = Math.max(0, Math.min(action.amount, legal.maxRaiseTo) - mySeat.streetBet);
      nextSeat = commit(paid);
      break;
    case "all-in":
      paid = legal.maxRaiseTo - mySeat.streetBet;
      nextSeat = commit(paid);
      break;
    // "check" moves no chips -- nothing to predict. Everything else
    // (rebuy, leave-seat, next-hand) either isn't the acting-on-your-turn
    // family this exists for, or has effects (Gold spend, profile updates)
    // not worth guessing at.
    default:
      return game;
  }

  const seats = game.seats.slice();
  seats[mySeatIndex] = nextSeat;
  return { ...game, seats, pot: game.pot + paid, legalActions: null };
}
