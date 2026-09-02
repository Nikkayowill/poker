import type { CSSProperties } from "react";
import type { ArcadeGameId } from "@/lib/arcade/games";

/**
 * A tiny, hand-drawn preview of the actual board or mechanic, shown at the
 * top of every arcade card. Not a screenshot -- a small CSS grid/glyph
 * rendering that says "this is a nonogram" or "this is chess" at a glance,
 * so a card reads as more than a name and a one-line blurb. Cheap to keep
 * in sync: there is no image to regenerate when a board's real look
 * changes, and it themes with the rest of the chrome for free.
 *
 * One function per game rather than a data table -- the shapes are too
 * different (a grid, a card pair, a row of tiles, a peg track) to fit one
 * schema without it becoming harder to read than 13 small functions.
 */
export function GamePreview({ id }: { id: ArcadeGameId }) {
  return <div className="game-preview" aria-hidden="true">{renderPreview(id)}</div>;
}

type Tone = "empty" | "purple" | "purple-bright" | "gold" | "gold-bright" | "chalk" | "red" | "black" | "white";

function Cell({ tone = "empty", glyph }: { tone?: Tone; glyph?: string }) {
  return (
    <span className={`pv-cell pv-tone-${tone}`}>
      {glyph}
    </span>
  );
}

function Board({ cols, cells }: { cols: number; cells: { tone?: Tone; glyph?: string }[] }) {
  return (
    <div className="pv-grid" style={{ "--pv-cols": cols } as CSSProperties}>
      {cells.map((cell, i) => (
        <Cell key={i} tone={cell.tone} glyph={cell.glyph} />
      ))}
    </div>
  );
}

function renderPreview(id: ArcadeGameId) {
  switch (id) {
    case "blackjack-21":
      // Two overlapping cards: the dealer's back card behind a face card of
      // your own, the exact pair a player sees the instant a hand deals.
      return (
        <div className="pv-cards">
          <span className="pv-card pv-card-back" />
          <span className="pv-card pv-card-face pv-tone-red">A♦</span>
        </div>
      );

    case "daily-word-stack":
      // A guess row: two correct, one present, two absent, the same three
      // states the real board colors.
      return (
        <div className="pv-tiles">
          <Cell tone="gold" glyph="W" />
          <Cell tone="purple-bright" glyph="O" />
          <Cell tone="empty" glyph="R" />
          <Cell tone="gold" glyph="D" />
          <Cell tone="empty" glyph="S" />
        </div>
      );

    case "connections":
      // Four solved rows, one solid tone each -- the four found groups.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "gold" }, { tone: "gold" }, { tone: "gold" }, { tone: "gold" },
            { tone: "purple" }, { tone: "purple" }, { tone: "purple" }, { tone: "purple" },
            { tone: "purple-bright" }, { tone: "purple-bright" }, { tone: "purple-bright" }, { tone: "purple-bright" },
            { tone: "chalk" }, { tone: "chalk" }, { tone: "chalk" }, { tone: "chalk" },
          ]}
        />
      );

    case "daily-sudoku":
      // A 4x4 corner of a grid, mostly blank -- a puzzle, not a solution.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "chalk", glyph: "4" }, { tone: "empty" }, { tone: "empty" }, { tone: "chalk", glyph: "2" },
            { tone: "empty" }, { tone: "gold", glyph: "1" }, { tone: "empty" }, { tone: "empty" },
            { tone: "empty" }, { tone: "empty" }, { tone: "gold", glyph: "3" }, { tone: "empty" },
            { tone: "chalk", glyph: "1" }, { tone: "empty" }, { tone: "empty" }, { tone: "chalk", glyph: "4" },
          ]}
        />
      );

    case "memory-match":
      // Six face-down cards, one matched pair turned up gold.
      return (
        <Board
          cols={3}
          cells={[
            { tone: "gold", glyph: "♣" }, { tone: "purple" }, { tone: "purple" },
            { tone: "purple" }, { tone: "purple" }, { tone: "gold", glyph: "♣" },
          ]}
        />
      );

    case "minesweeper":
      // A cleared corner: numbers, one still-hidden cell, one flagged.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "chalk", glyph: "1" }, { tone: "chalk" }, { tone: "chalk", glyph: "1" }, { tone: "purple" },
            { tone: "chalk", glyph: "1" }, { tone: "chalk", glyph: "2" }, { tone: "chalk", glyph: "1" }, { tone: "red", glyph: "⚑" },
            { tone: "chalk" }, { tone: "chalk", glyph: "1" }, { tone: "chalk" }, { tone: "purple" },
          ]}
        />
      );

    case "nonogram":
      // A run of clue numbers beside a partly-filled grid -- the one detail
      // that tells this apart from a plain checkerboard.
      return (
        <div className="pv-nonogram">
          <div className="pv-clues">
            <span>2</span>
            <span>1 2</span>
            <span>3</span>
          </div>
          <Board
            cols={4}
            cells={[
              { tone: "purple" }, { tone: "purple" }, { tone: "empty" }, { tone: "empty" },
              { tone: "purple" }, { tone: "empty" }, { tone: "purple" }, { tone: "purple" },
              { tone: "purple" }, { tone: "purple" }, { tone: "purple" }, { tone: "empty" },
            ]}
          />
        </div>
      );

    case "chess-duel":
      // A checkered corner with a rook, a knight and two pawns -- enough
      // to read as chess without drawing sixty-four squares.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "purple", glyph: "♜" }, { tone: "empty" }, { tone: "purple", glyph: "♞" }, { tone: "empty" },
            { tone: "empty" }, { tone: "chalk", glyph: "♟" }, { tone: "empty" }, { tone: "chalk", glyph: "♟" },
          ]}
        />
      );

    case "checkers-duel":
      // Two red discs facing two chalk discs across a checkered board.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "empty" }, { tone: "white", glyph: "●" }, { tone: "empty" }, { tone: "white", glyph: "●" },
            { tone: "red", glyph: "●" }, { tone: "empty" }, { tone: "red", glyph: "●" }, { tone: "empty" },
          ]}
        />
      );

    case "othello-duel":
      // A flat board, not checkered -- Othello has no board pattern, only
      // discs -- with the real four-disc opening position at its centre.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "empty" }, { tone: "empty" }, { tone: "empty" }, { tone: "empty" },
            { tone: "empty" }, { tone: "white", glyph: "●" }, { tone: "black", glyph: "●" }, { tone: "empty" },
            { tone: "empty" }, { tone: "black", glyph: "●" }, { tone: "white", glyph: "●" }, { tone: "empty" },
            { tone: "empty" }, { tone: "empty" }, { tone: "empty" }, { tone: "empty" },
          ]}
        />
      );

    case "trivia-showdown":
      // A question card over two answer bars -- first right answer wins.
      return (
        <div className="pv-trivia">
          <span className="pv-trivia-mark">?</span>
          <span className="pv-trivia-bar pv-tone-gold" />
          <span className="pv-trivia-bar pv-tone-purple" />
        </div>
      );

    case "word-race": {
      // The same tile row as Word Stack, jumbled -- unscramble it before
      // they do.
      const letters: { glyph: string; tilt: number }[] = [
        { glyph: "R", tilt: -8 },
        { glyph: "A", tilt: 6 },
        { glyph: "C", tilt: -4 },
        { glyph: "E", tilt: 9 },
      ];
      return (
        <div className="pv-tiles">
          {letters.map((letter) => (
            <span
              key={letter.glyph}
              className="pv-cell pv-tone-purple-bright"
              style={{ transform: `rotate(${letter.tilt}deg)` }}
            >
              {letter.glyph}
            </span>
          ))}
        </div>
      );
    }

    case "cribbage-table":
      // A peg track: two pegs at different points along the race to 121.
      return (
        <div className="pv-pegtrack">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className={
                i === 3 ? "pv-peg pv-tone-gold" : i === 6 ? "pv-peg pv-tone-purple-bright" : "pv-peg"
              }
            />
          ))}
        </div>
      );

    default:
      return null;
  }
}
