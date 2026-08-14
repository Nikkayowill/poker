/**
 * Which poker action a chip flight is, and therefore how fast it moves.
 *
 * The snapshot does not say "that was a raise". It says what each seat has
 * committed this street, and the client derives the flight from an increase
 * against the previous snapshot (see `poker-table.tsx`). That increase alone
 * cannot set a timing — a 200 committed by the first aggressor and a 200
 * committed by the player calling them are the same number and completely
 * different gestures — so the classification happens here, from the table's
 * state at the moment the chips left.
 *
 * Deliberately derived on the client rather than added to the wire. It is
 * presentation: nothing about what the bet *is* depends on it, no server
 * validation reads it, and a client that got it wrong would show a call at a
 * raise's tempo, which is a cosmetic error. Putting it in the snapshot would
 * mean a schema change, a migration of every stored game, and a new field the
 * engine has to keep truthful, for a difference of 100 milliseconds.
 *
 * In `lib/` so `npm test` can reach it, and so both rooms and the parent share
 * one definition instead of three ternaries that drift.
 */

import type { ChipMoveKind } from "./chip-motion";

/** One bet's worth of chips on their way to a seat's bet spot. */
export interface BetFlight {
  /** Deduped by the scene: the parent keeps a flight queued for ~900ms. */
  id: string;
  /** Ring slot, not seat id — the scene rings from the local player's chair. */
  slot: number;
  /** What this seat just put in, not its whole street. */
  amount: number;
  /** What the chips are doing, which is what sets their timing. */
  kind: ChipMoveKind;
}

export interface BetFlightContext {
  /** The seat has no chips left behind this bet. */
  allIn: boolean;
  /** The highest amount any seat had committed this street before this action. */
  previousHighBet: number;
  /** This seat's committed-this-street total after it. */
  streetBet: number;
}

/**
 * Classify one flight.
 *
 * All-in wins over everything else: a shove is a shove whether it happens to
 * land on the current bet or past it, and it is the one action at the table
 * that has earned a slower, heavier animation.
 *
 * Below that, the split is aggression versus response — matching the standing
 * bet is a call, going past it is a raise, and going past nothing is an
 * opening bet. Posted blinds fall into that last case, which is right: a blind
 * is an opening bet that the rules made for you.
 */
export function betFlightKind(context: BetFlightContext): ChipMoveKind {
  if (context.allIn) return "all_in";
  if (context.streetBet > context.previousHighBet) {
    return context.previousHighBet > 0 ? "raise" : "bet";
  }
  return "call";
}
