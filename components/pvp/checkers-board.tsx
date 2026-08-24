"use client";

import { useState } from "react";
import clsx from "clsx";
import type { DuelBoardProps } from "./duel-shell";
import {
  BOARD_SIDE,
  BOARD_SQUARES,
  cellOwner,
  colOf,
  isKingCell,
  isPlayableSquare,
  rowOf,
  type CheckersCell,
  type CheckersSnapshot,
} from "@/lib/pvp/checkers";

/**
 * The checkers board.
 *
 * Renders the snapshot and assembles a move out of clicks; it decides nothing.
 * Every question about legality is answered by `state.legalMoves`, which the
 * engine generated on the server -- a second, client-side rule set would be a
 * second definition of checkers, and the two would disagree on exactly the
 * cases that are hard (forced jumps, chains, crowning).
 *
 * A whole turn is one request, so a jump chain is assembled here and sent only
 * once it matches a legal move end to end. The player clicks the piece, then
 * each landing square in turn; the move goes the moment the assembled path IS
 * a legal move. No legal move is a prefix of another from the same square --
 * a chain that can continue must continue -- so that match is unambiguous.
 */

/** Files and ranks from seat 0's side, for the screen-reader label. */
const FILES = "abcdefgh";

function squareName(square: number): string {
  return `${FILES[colOf(square)]}${BOARD_SIDE - rowOf(square)}`;
}

function pieceName(cell: CheckersCell): string {
  const owner = cellOwner(cell);
  if (owner === null) return "empty";
  return `${owner === 0 ? "red" : "black"} ${isKingCell(cell) ? "king" : "man"}`;
}

/**
 * mm:ss.
 *
 * Ceiling rather than floor, so a clock reads "0:01" until the second it
 * actually runs out -- a display that shows 0:00 while a move is still legal
 * is the kind of thing a player reports as a lost game.
 */
function clockLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((square, index) => square === b[index]);
}

function startsWith(path: number[], prefix: number[]): boolean {
  return prefix.length <= path.length && prefix.every((square, index) => square === path[index]);
}

export function CheckersBoard({ state, yourSeat, busy, onMove }: DuelBoardProps<CheckersSnapshot>) {
  /**
   * The half-assembled turn: the piece picked up and the landings clicked so
   * far. Deliberately NOT reconciled against a new snapshot by an effect --
   * `candidates` below re-derives everything from whatever the server last
   * said, so a selection that no longer describes a legal move simply stops
   * being one on the next render. An effect would be a second source of truth
   * for a value that is already derivable.
   */
  const [from, setFrom] = useState<number | null>(null);
  const [path, setPath] = useState<number[]>([]);

  const legal = state.legalMoves;
  const candidates = legal.filter(
    (move) => move.from === from && startsWith(move.path, path),
  );
  const active = candidates.length > 0;
  const selected = active ? from : null;
  const chosen = active ? path : [];

  // Your turn is exactly "the server sent me moves" -- there is no second
  // opinion about whose turn it is, and there must not be.
  const yourTurn = legal.length > 0;
  const interactive = yourTurn && !busy;

  const origins = new Set(legal.map((move) => move.from));
  const nextSteps = new Set(candidates.map((move) => move.path[chosen.length]));
  const doomed = new Set(candidates.flatMap((move) => move.captures));

  function handleSquare(square: number) {
    if (!interactive) return;

    // Origins hold one of your pieces and landings are always empty, so these
    // two cases can never be the same square and the order does not matter.
    if (origins.has(square)) {
      setFrom(square === selected && chosen.length === 0 ? null : square);
      setPath([]);
      return;
    }

    if (!active || !nextSteps.has(square)) {
      setFrom(null);
      setPath([]);
      return;
    }

    const extended = [...chosen, square];
    const complete = candidates.find((move) => samePath(move.path, extended));
    if (complete) {
      onMove({ from: complete.from, path: complete.path });
      setFrom(null);
      setPath([]);
      return;
    }
    setPath(extended);
  }

  // Seat 1 plays from the top of the stored board, so their view is turned
  // through 180 degrees -- both axes, not just the rows, or the board would be
  // mirrored rather than rotated and the diagonals would read wrong.
  const flipped = yourSeat === 1;
  const order: number[] = [];
  for (let index = 0; index < BOARD_SQUARES; index += 1) {
    order.push(flipped ? BOARD_SQUARES - 1 - index : index);
  }

  const yourClock = state.clocks[yourSeat];
  const theirClock = state.clocks[yourSeat === 0 ? 1 : 0];
  const yourPieces = state.pieces[yourSeat];
  const theirPieces = state.pieces[yourSeat === 0 ? 1 : 0];
  // Seat 0 is always red (lib/pvp/checkers.ts's own comment) -- restated here
  // only for the clock-row labels, not as a second copy of the rule.
  const yourColor = yourSeat === 0 ? "Red" : "Black";
  const opponentColor = yourSeat === 0 ? "Black" : "Red";

  return (
    <div className="ck">
      <div className="ck-clock-row">
        <span className="ck-side">Opponent · {opponentColor}</span>
        <span className="ck-pieces">{theirPieces} left</span>
        <span className={clsx("ck-clock", !yourTurn && "ck-clock-running")}>
          {clockLabel(theirClock)}
        </span>
      </div>

      <div className="ck-board" aria-label="Checkers board">
        {order.map((square) => {
          const cell = state.board[square] as CheckersCell;
          const dark = isPlayableSquare(square);
          const owner = cellOwner(cell);
          const clickable = interactive && (origins.has(square) || nextSteps.has(square));

          return (
            <button
              key={square}
              type="button"
              className={clsx(
                "ck-square",
                dark ? "ck-square-dark" : "ck-square-light",
                selected === square && "ck-selected",
                chosen.includes(square) && "ck-stepped",
                interactive && origins.has(square) && "ck-origin",
                nextSteps.has(square) && "ck-target",
                doomed.has(square) && "ck-doomed",
              )}
              disabled={!clickable}
              onClick={() => handleSquare(square)}
              aria-label={`${squareName(square)}, ${pieceName(cell)}`}
            >
              {owner !== null && (
                <span
                  className={clsx(
                    "ck-piece",
                    owner === 0 ? "ck-piece-red" : "ck-piece-black",
                    owner === yourSeat && "ck-piece-yours",
                  )}
                  aria-hidden="true"
                >
                  {isKingCell(cell) ? "♔" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="ck-clock-row">
        <span className="ck-side">You · {yourColor}</span>
        <span className="ck-pieces">{yourPieces} left</span>
        <span className={clsx("ck-clock", yourTurn && "ck-clock-running")}>
          {clockLabel(yourClock)}
        </span>
      </div>

      {/* A refused move with no stated reason reads as a broken game, and the
          forced jump is the rule players are surprised by. Say it before they
          try, not after. */}
      <p className={clsx("ck-status", yourTurn && state.mustJump && "ck-status-forced")}>
        {state.outcome
          ? state.outcome.reason
          : !yourTurn
            ? "Waiting for your opponent…"
            : state.mustJump
              ? "A jump is available -- you have to take it."
              : chosen.length > 0
                ? "Keep going -- that piece can take again."
                : "Your move."}
      </p>
    </div>
  );
}
