"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { squareName, type ChessMove, type ChessSnapshot, type ChessSquare } from "@/lib/pvp/chess";
import type { DuelBoardProps } from "./duel-shell";

/**
 * The chess board: eight ranks of buttons, and nothing that decides a rule.
 *
 * Every legal destination on screen comes from `state.legalMoves`, which the
 * engine computed server-side for the seat to move. The board never asks
 * whether a move is legal, it asks which moves the server already said were.
 * That's the same split the poker table holds, and it's what stops a second
 * copy of the rules drifting from the one that owns the Gold.
 *
 * Interaction is click-a-piece then click-a-square. Drag would need pointer
 * capture, a ghost layer and a touch story, and buys nothing a duel needs.
 */

/**
 * The solid glyphs for BOTH colours, coloured by CSS rather than by picking the
 * outline set for white.
 *
 * The outline glyphs (♔♕♖) render at a different weight from the solid ones in
 * most system fonts, so a board built from both reads as two different piece
 * sets. One shape per kind plus a fill and an outline is legible at the ~40px
 * a phone gets, which is the size this has to survive.
 */
const GLYPHS: Record<Exclude<ChessSquare, "">, string> = {
  K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const PIECE_NAMES: Record<string, string> = {
  k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn",
};

const PROMOTION_CHOICES = ["q", "r", "b", "n"] as const;

/** A clock is worth reading at a glance, so it's mm:ss and rounds up: "0:00" must mean flagged. */
function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function describeSquare(square: number, piece: ChessSquare): string {
  if (piece === "") return `${squareName(square)}, empty`;
  const color = piece === piece.toUpperCase() ? "white" : "black";
  return `${squareName(square)}, ${color} ${PIECE_NAMES[piece.toLowerCase()]}`;
}

export function ChessBoard({ state, yourSeat, status, busy, onMove }: DuelBoardProps<ChessSnapshot>) {
  const [selected, setSelected] = useState<number | null>(null);
  /** A promotion the player has committed the squares of but not yet the piece. */
  const [promoting, setPromoting] = useState<{ from: number; to: number } | null>(null);

  const moves: ChessMove[] = state.legalMoves ?? [];
  // `legalMoves` is null for the seat that is not to move, so it doubles as the
  // turn test; there is no second source of truth about whose turn it is.
  const yourTurn = state.legalMoves !== null;
  const live = status === "active" && state.over === null;
  const interactive = live && yourTurn && !busy;

  const opponentSeat = yourSeat === 0 ? 1 : 0;
  const flipped = yourSeat === 1;
  // Seat 0 is always white (lib/pvp/chess.ts's seatColor), restated here only
  // for the clock labels below, not as a second copy of the rule.
  const yourColor = yourSeat === 0 ? "White" : "Black";
  const opponentColor = yourSeat === 0 ? "Black" : "White";

  const movable = new Set(moves.map((move) => move.from));
  const destinations = new Set(
    selected === null ? [] : moves.filter((move) => move.from === selected).map((move) => move.to),
  );

  const choose = (square: number) => {
    if (!interactive) return;

    if (selected !== null && destinations.has(square)) {
      // Four moves share one from/to pair on a promotion, so the piece has to
      // be asked for before anything is sent.
      const needsPromotion = moves.some(
        (move) => move.from === selected && move.to === square && move.promotion !== undefined,
      );
      if (needsPromotion) {
        setPromoting({ from: selected, to: square });
        setSelected(null);
        return;
      }
      setSelected(null);
      onMove({ from: selected, to: square });
      return;
    }

    // Clicking anything else either picks up a new piece or puts the old one
    // down; either way the previous selection is spent.
    setSelected(movable.has(square) ? square : null);
  };

  // Seat 1 plays black and reads the board from the other end, so the flip is
  // in the index arithmetic and nowhere else; rotating the grid with CSS
  // would rotate every glyph with it.
  const squares = Array.from({ length: 64 }, (_unused, cell) => {
    const rank = flipped ? (cell / 8) | 0 : 7 - ((cell / 8) | 0);
    const file = flipped ? 7 - (cell % 8) : cell % 8;
    return rank * 8 + file;
  });

  return (
    <div className="chess-board-wrap">
      <ChessClock
        // Re-keyed on the value so the child re-anchors its local countdown to
        // whatever the server just said, rather than drifting from it.
        key={`opponent-${state.clock[opponentSeat]}`}
        ms={state.clock[opponentSeat]}
        running={live && state.turn === opponentSeat}
        label={`Opponent · ${opponentColor}`}
      />

      <div className="chess-grid" role="group" aria-label="Chess board">
        {squares.map((square) => {
          const piece = state.board[square];
          const file = square % 8;
          const rank = (square / 8) | 0;
          const isLast =
            state.lastMove !== null &&
            (state.lastMove.from === square || state.lastMove.to === square);
          // The king that is standing in check, which is the one belonging to
          // the side to move.
          const checked =
            state.check &&
            piece !== "" &&
            piece.toLowerCase() === "k" &&
            (state.turn === 0) === (piece === piece.toUpperCase());

          return (
            <button
              key={square}
              type="button"
              className={clsx(
                "chess-square",
                (file + rank) % 2 === 0 ? "chess-square-dark" : "chess-square-light",
                selected === square && "chess-square-selected",
                destinations.has(square) && (piece === "" ? "chess-square-move" : "chess-square-take"),
                isLast && "chess-square-last",
                checked && "chess-square-check",
              )}
              disabled={!interactive}
              onClick={() => choose(square)}
              aria-label={describeSquare(square, piece)}
            >
              {piece !== "" && (
                <span
                  className={clsx(
                    "chess-piece",
                    piece === piece.toUpperCase() ? "chess-piece-white" : "chess-piece-black",
                    (piece === piece.toUpperCase()) === (yourSeat === 0) && "chess-piece-yours",
                  )}
                  aria-hidden="true"
                >
                  {GLYPHS[piece]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <ChessClock
        key={`you-${state.clock[yourSeat]}`}
        ms={state.clock[yourSeat]}
        running={live && state.turn === yourSeat}
        label={`You · ${yourColor}`}
      />

      {promoting ? (
        <div className="chess-promotion" role="group" aria-label="Promote to">
          <span className="chess-status">Promote to</span>
          {PROMOTION_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className="chess-promotion-pick"
              onClick={() => {
                onMove({ ...promoting, promotion: choice });
                setPromoting(null);
              }}
              aria-label={PIECE_NAMES[choice]}
            >
              <span
                className={clsx("chess-piece", flipped ? "chess-piece-black" : "chess-piece-white")}
                aria-hidden="true"
              >
                {GLYPHS[(flipped ? choice : choice.toUpperCase()) as Exclude<ChessSquare, "">]}
              </span>
            </button>
          ))}
          <button type="button" className="chess-promotion-cancel" onClick={() => setPromoting(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <p className="chess-status">
          {!live
            ? state.over?.reason ?? "Match over"
            : !yourTurn
              ? "Opponent to move"
              : state.check
                ? "You are in check"
                : busy
                  ? "Sending…"
                  : "Your move"}
        </p>
      )}
    </div>
  );
}

/**
 * One side's clock.
 *
 * The value arrives from the server every poll, two seconds apart, which would
 * make a blitz clock jump in two-second steps. So it counts down locally from
 * whatever the last poll said, and the parent re-keys this component whenever
 * that value changes; a remount re-reads the wall clock in a lazy state
 * initialiser, which is both the simplest way to re-anchor and the one that
 * doesn't set state from inside an effect. The server remains the only
 * authority: nothing here is ever sent anywhere.
 */
function ChessClock({ ms, running, label }: { ms: number; running: boolean; label: string }) {
  const [anchor] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - anchor), 250);
    return () => window.clearInterval(timer);
  }, [running, anchor]);

  const left = Math.max(0, ms - (running ? elapsed : 0));
  return (
    <div className={clsx("chess-clock", running && "chess-clock-live", left <= 30_000 && "chess-clock-low")}>
      <small>{label}</small>
      <strong>{formatClock(left)}</strong>
    </div>
  );
}
