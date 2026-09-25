"use client";

import clsx from "clsx";
import type { DuelBoardProps } from "./duel-shell";
import { otherSeat, type DuelSeat } from "@/lib/pvp/match-contract";
import {
  oppositePit,
  seatPits,
  storeOf,
  type MancalaLastMove,
  type MancalaSnapshot,
} from "@/lib/pvp/mancala";

/**
 * The Mancala board.
 *
 * Renders the snapshot and sends one pit; it decides nothing. Which pits are
 * playable is `state.legalPits` from the server, and what the last move did
 * is `state.lastMove`, so there is no sowing or capture logic in here.
 *
 * Your row is always the bottom one, sown left to right into your store on
 * the right. Their row runs back along the top, so each top pit sits over the
 * pit it would capture from.
 */

/**
 * More dots than this stop reading as a count, so the number takes over.
 * Three rows of four, which is the fixed seed area 58-mancala.css reserves.
 */
const MAX_DOTS = 12;

function Seeds({ count }: { count: number }) {
  const dots = Math.min(count, MAX_DOTS);
  return (
    <span className="mc-seeds" aria-hidden="true">
      {Array.from({ length: dots }, (_, index) => (
        <span key={index} className="mc-seed" />
      ))}
    </span>
  );
}

/** mm:ss, rounded up so "0:00" only ever means the flag fell. */
function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function seedWord(count: number): string {
  return `${count} seed${count === 1 ? "" : "s"}`;
}

function statusLine(
  state: MancalaSnapshot,
  yourSeat: DuelSeat,
  yourTurn: boolean,
): string {
  const outcome = state.outcome;
  if (outcome) {
    // The result card already says who won. This line says why the board
    // looks the way it does: a resign leaves seeds in the pits, and the
    // sweep at the end empties every pit at once.
    if (outcome.reason === "Timeout") {
      return outcome.winner === yourSeat ? "They ran out of time." : "You ran out of time.";
    }
    // A played-out game always ends with every pit swept empty, so seeds
    // still on the board mean somebody resigned.
    const resigned = state.pits.some((count, pit) => pit !== storeOf(0) && pit !== storeOf(1) && count > 0);
    if (resigned) {
      return outcome.winner === yourSeat ? "They resigned." : "You resigned.";
    }
    const yours = state.stores[yourSeat];
    const theirs = state.stores[otherSeat(yourSeat)];
    return `A row ran dry, so the seeds left on each side went to that side's store. You ${yours}, them ${theirs}.`;
  }

  const last: MancalaLastMove | null = state.lastMove;
  const mine = last !== null && last.seat === yourSeat;
  const next = yourTurn ? "Your move." : "Waiting for your opponent…";

  if (last === null) return yourTurn ? "Your move. Tap one of your pits." : next;
  if (last.extraTurn) {
    return mine
      ? "Your last seed landed in your store. Go again."
      : "Their last seed landed in their store, so they go again.";
  }
  if (last.captured > 0) {
    // `captured` counts the landing seed too, so the victim lost one fewer.
    return mine
      ? `You captured ${last.captured} seeds. ${next}`
      : `They captured ${last.captured - 1} of your seeds. ${next}`;
  }
  return next;
}

export function MancalaBoard({ state, yourSeat, busy, onMove }: DuelBoardProps<MancalaSnapshot>) {
  const legal = new Set(state.legalPits);

  // Your turn is exactly "the server sent me pits", same as the Othello board.
  const yourTurn = legal.size > 0;
  const interactive = yourTurn && !busy;

  const theirSeat = otherSeat(yourSeat);
  const bottom = seatPits(yourSeat);
  const top = [...seatPits(theirSeat)].reverse();
  const yourStore = storeOf(yourSeat);
  const theirStore = storeOf(theirSeat);

  const last = state.lastMove;
  // A capture empties the landing pit, so the pit it took from is marked too.
  const capturedFrom = last && last.captured > 0 ? oppositePit(last.lastPit) : null;

  function pitClass(pit: number) {
    return clsx(
      last?.pit === pit && "mc-pit-sown",
      last?.lastPit === pit && "mc-pit-landed",
      capturedFrom === pit && "mc-pit-captured",
    );
  }

  function renderPit(pit: number, yours: boolean) {
    const count = state.pits[pit];
    const playable = legal.has(pit);
    const label =
      `${yours ? "Your" : "Their"} pit, ${seedWord(count)}` + (playable ? ", playable" : "");
    return (
      <button
        key={pit}
        type="button"
        className={clsx(
          "mc-pit",
          yours ? "mc-pit-yours" : "mc-pit-theirs",
          playable && "mc-pit-legal",
          pitClass(pit),
        )}
        disabled={!interactive || !playable}
        onClick={() => onMove({ pit })}
        aria-label={label}
      >
        <Seeds count={count} />
        <span className="mc-count">{count}</span>
      </button>
    );
  }

  function renderStore(yours: boolean) {
    const pit = yours ? yourStore : theirStore;
    const count = state.pits[pit];
    // A capture drops its seeds into the capturer's store, so light that too.
    const filled = last !== null && (last.lastPit === pit || (last.captured > 0 && storeOf(last.seat) === pit));
    return (
      <div
        className={clsx(
          "mc-store",
          yours ? "mc-store-yours" : "mc-store-theirs",
          filled && "mc-store-landed",
        )}
        role="img"
        aria-label={`${yours ? "Your" : "Their"} store, ${seedWord(count)}`}
      >
        <span className="mc-store-name">{yours ? "You" : "Them"}</span>
        <span className="mc-store-count">{count}</span>
      </div>
    );
  }

  const theirTurn = !state.outcome && state.turn === theirSeat;
  const lastWasCapture = last !== null && last.captured > 0;

  return (
    <div className="mc">
      <div className={clsx("mc-side", theirTurn && "mc-side-active")}>
        <span>Opponent</span>
        <span className="mc-side-turn">
          {theirTurn ? "to move · " : ""}{clockLabel(state.clocks[theirSeat])}
        </span>
      </div>

      <div className="mc-board" role="group" aria-label="Mancala board">
        {renderStore(false)}
        <div className="mc-row mc-row-top">{top.map((pit) => renderPit(pit, false))}</div>
        <div className="mc-row mc-row-bottom">{bottom.map((pit) => renderPit(pit, true))}</div>
        {renderStore(true)}
      </div>

      <div className={clsx("mc-side", yourTurn && "mc-side-active")}>
        <span>You</span>
        <span className="mc-side-turn">
          {yourTurn ? "to move · " : ""}{clockLabel(state.clocks[yourSeat])}
        </span>
      </div>

      <p
        className={clsx(
          "mc-status",
          !state.outcome && (last?.extraTurn || lastWasCapture) && "mc-status-event",
        )}
        aria-live="polite"
      >
        {statusLine(state, yourSeat, yourTurn)}
      </p>
    </div>
  );
}
