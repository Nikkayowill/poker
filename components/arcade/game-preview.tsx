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
 * different (a grid, a row of tiles, a peg track) to fit one schema without
 * it becoming harder to read than 12 small functions.
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

    case "word-fill-in":
      // A filled crossword corner with black squares and no clue numbers,
      // beside the word list with the placed words struck off.
      return (
        <div className="pv-wordfill">
          <Board
            cols={4}
            cells={[
              { tone: "chalk", glyph: "C" }, { tone: "chalk", glyph: "A" }, { tone: "chalk", glyph: "T" }, { tone: "black" },
              { tone: "chalk", glyph: "O" }, { tone: "black" }, { tone: "chalk", glyph: "O" }, { tone: "black" },
              { tone: "chalk", glyph: "W" }, { tone: "black" }, { tone: "empty" }, { tone: "black" },
            ]}
          />
          <div className="pv-wordlist">
            <s>CAT</s>
            <s>COW</s>
            <span>TOE</span>
          </div>
        </div>
      );

    case "blockudoku":
      // A corner of the board: placed blocks, with one full row lit gold as it clears.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "purple" }, { tone: "empty" }, { tone: "purple" }, { tone: "purple" },
            { tone: "gold" }, { tone: "gold" }, { tone: "gold" }, { tone: "gold" },
            { tone: "empty" }, { tone: "purple" }, { tone: "empty" }, { tone: "purple" },
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

    case "liars-dice-duel":
      // Your two dice face up, two of theirs face down: the bid rides on
      // what you can't see.
      return (
        <div className="pv-tiles">
          <Cell tone="chalk" glyph="4" />
          <Cell tone="gold" glyph="4" />
          <Cell tone="purple" glyph="?" />
          <Cell tone="purple" glyph="?" />
        </div>
      );

    case "mancala-duel": {
      // Two rows of six pits between the two stores, a few pits holding seeds.
      const seeded = new Set([1, 3, 4, 8, 10]);
      return (
        <div className="pv-mancala">
          <span className="pv-mancala-store pv-mancala-store-left" />
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={seeded.has(i) ? "pv-mancala-pit pv-mancala-seeded" : "pv-mancala-pit"} />
          ))}
          <span className="pv-mancala-store pv-mancala-store-right" />
        </div>
      );
    }

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

    case "sequence-recall":
      // Four flash pads, one lit -- the Simon-style watch-and-repeat cue.
      return (
        <Board
          cols={2}
          cells={[
            { tone: "gold-bright" }, { tone: "empty" },
            { tone: "empty" }, { tone: "purple" },
          ]}
        />
      );

    case "quick-math":
      return (
        <div className="pv-tiles">
          <Cell tone="chalk" glyph="7" />
          <Cell tone="empty" glyph="+" />
          <Cell tone="chalk" glyph="5" />
          <Cell tone="empty" glyph="=" />
          <Cell tone="gold" glyph="?" />
        </div>
      );

    case "pattern-predictor":
      return (
        <div className="pv-tiles">
          <Cell tone="chalk" glyph="2" />
          <Cell tone="chalk" glyph="4" />
          <Cell tone="chalk" glyph="6" />
          <Cell tone="gold" glyph="?" />
        </div>
      );

    case "trivia-blitz":
      return (
        <div className="pv-tiles">
          <Cell tone="gold" glyph="T" />
          <Cell tone="empty" glyph="F" />
        </div>
      );

    case "lights-out":
      // A 4x4 corner, half lit -- the board mid-solve, not the win state.
      return (
        <Board
          cols={4}
          cells={[
            { tone: "gold-bright" }, { tone: "empty" }, { tone: "gold-bright" }, { tone: "empty" },
            { tone: "empty" }, { tone: "gold-bright" }, { tone: "empty" }, { tone: "gold-bright" },
            { tone: "gold-bright" }, { tone: "empty" }, { tone: "empty" }, { tone: "empty" },
            { tone: "empty" }, { tone: "gold-bright" }, { tone: "empty" }, { tone: "gold-bright" },
          ]}
        />
      );

    case "word-guess":
      return (
        <div className="pv-tiles">
          <Cell tone="chalk" glyph="_" />
          <Cell tone="gold" glyph="A" />
          <Cell tone="chalk" glyph="_" />
          <Cell tone="chalk" glyph="_" />
        </div>
      );

    default:
      return null;
  }
}
