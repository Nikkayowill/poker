import "server-only";
import { NextResponse } from "next/server";

/**
 * The rejection-and-response layer every arcade service shares.
 *
 * Blackjack, Hi-Lo, Wordle and Connections each carried their own copy of an
 * identical error class and an all-but-identical response mapper. Four copies
 * of one contract is four places to fix a bug in it, and they had already
 * started to drift: two of them dropped the `reason` field entirely, so a
 * puzzle service could not have distinguished ordinary play from a fault if it
 * had been written against the wager games' version.
 *
 * The games keep their own subclasses rather than sharing one error type,
 * because the tests and the services both narrow on `instanceof` per game, and
 * because the snapshot a rejection carries back is the one thing that really is
 * game-specific.
 */

/**
 * A rejection the caller can act on, as opposed to a fault.
 *
 * `round` is the state of play at the moment of refusal. It is sent with the
 * error so a client that fell out of sync re-renders from truth instead of
 * guessing -- which is what makes a 409 recoverable rather than a dead end.
 *
 * `reason` separates the rejections that are ordinary play from the ones that
 * are faults: a player typing a non-word at Wordle, or re-trying a group at
 * Connections, costs nothing and the board should shrug rather than raise a
 * banner. The type parameter keeps each game's vocabulary its own, so a
 * service cannot emit a reason its own client has never heard of.
 */
export class ArcadeRequestError<TSnapshot, TReason extends string = never> extends Error {
  readonly status: number;
  readonly reason?: TReason;
  readonly round?: TSnapshot;

  constructor(
    message: string,
    status: number,
    options: { reason?: TReason; round?: TSnapshot } = {},
  ) {
    super(message);
    this.status = status;
    this.reason = options.reason;
    this.round = options.round;
  }
}

/**
 * Maps a thrown error to the response an arcade route sends.
 *
 * Lives in lib/server rather than beside the handlers for the reason
 * lib/server/api-auth.ts already established: every other file under app/api is
 * a route.ts, and a lib/server module may hand back a NextResponse.
 *
 * `fallbackMessage` is the only thing that varies between games, and it is only
 * ever reached by a non-Error throw -- "that hand", "that round", "that puzzle"
 * is the whole difference.
 */
export function toArcadeErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof ArcadeRequestError) {
    return NextResponse.json(
      {
        error: error.message,
        ...(error.reason ? { reason: error.reason } : {}),
        ...(error.round ? { round: error.round } : {}),
      },
      { status: error.status },
    );
  }
  // "Not enough Gold." comes back from spendGold's own guard, which is the
  // authority -- any balance check before it is only ever a stale read. The
  // free puzzles never spend, so for them this branch is unreachable rather
  // than wrong.
  const message = error instanceof Error ? error.message : fallbackMessage;
  const status = message === "Not enough Gold." ? 400 : 500;
  return NextResponse.json({ error: message }, { status });
}
