import "server-only";

/**
 * Where a Nonogram board comes from.
 *
 * Split out of ./nonogram.ts and marked `server-only` because it reaches
 * ./nonogram-pictures.ts, which is the answer key to every hand-drawn board in
 * the game. The engine takes a dealt picture rather than importing one, the
 * same arrangement ./connections.ts has with ./connections-puzzles.ts.
 *
 * Two sources, on purpose:
 *
 *   - **Drawings**, at 5x5, 10x10 and 15x15. A nonogram is a picture you
 *     cannot see yet, and the moment it resolves into a cat is the reward the
 *     whole genre is built on. Random static has no such moment. Every
 *     mainstream picross ships hand-drawn art and so does this.
 *
 *   - **Grown shapes**, at 20x20 and 25x25, where 400 and 625 squares are past
 *     what hand-drawn art can carry. These are not the old uniform noise
 *     either: a half-grid is drawn, mirrored, and then smoothed by a majority
 *     rule until it settles into blobs. Symmetry plus solid regions is what
 *     makes a big board read as an object rather than television snow, and it
 *     is also what makes it *solvable in a sane amount of time* -- a 58%
 *     random 25x25 is a wall of one-square runs and cross-referencing every
 *     one of them inside 40 minutes is not a bet, it is a formality nobody
 *     wins.
 *
 * Both paths end at the same guarantee: what leaves this file can be finished
 * by line logic alone, no guessing, because lib/arcade/ante-up-nonogram.ts
 * stakes real Gold on it. Drawings are checked by the test suite once, up
 * front, so nothing has to be repaired at deal time; grown shapes are checked
 * here and repaired until they pass.
 */

import { mulberry32 } from "@/lib/seeded-random";
import {
  SOLUTION_EMPTY,
  SOLUTION_FILLED,
  isNoGuessNonogram,
  nonogramClues,
  nonogramConfig,
  solveNonogram,
  type NonogramDeal,
  type NonogramDifficulty,
} from "./nonogram";
import { nonogramPicturesFor } from "./nonogram-pictures";

/** Matches the line solver's own UNKNOWN. Restated rather than exported: it is one number. */
const UNKNOWN = 0;

/**
 * How full a grown grid starts, before smoothing.
 *
 * Half, not the 58% the old uniform generator used. Smoothing is what makes
 * the shapes, and it needs roughly a coin flip to have anything to work with;
 * starting denser just smooths to a solid block.
 */
const SEED_DENSITY = 0.5;

/** How many majority-rule passes. Two is blobs; four is a blob. */
const SMOOTHING_PASSES = 3;

/** Mirrors a row-major grid left to right. Keeps a drawing upright, which a rotation would not. */
function mirrorRows(cells: readonly string[], size: number): string[] {
  const out: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) out.push(cells[row * size + (size - 1 - col)]);
  }
  return out;
}

/**
 * A drawing from the library, mirrored half the time.
 *
 * Mirroring is the only transform used. Rotating would double the variety
 * again, but a cat on its side is not a cat, and the reveal is the point.
 */
function dealPicture(random: () => number, size: number): NonogramDeal | null {
  const library = nonogramPicturesFor(size);
  if (library.length === 0) return null;

  const picture = library[Math.floor(random() * library.length)];
  const cells = [...picture.cells];
  const solution = random() < 0.5 ? mirrorRows(cells, size).join("") : cells.join("");
  return { solution, title: picture.name };
}

/**
 * One majority-rule pass: a square joins whichever side its own neighbourhood
 * is mostly on. The classic cave-smoothing rule, and the reason a grown board
 * has runs in it rather than confetti. Edges count as empty, which pulls the
 * shape away from the border and leaves the quiet margin a picture wants.
 */
function smooth(cells: readonly number[], size: number): number[] {
  const out = new Array<number>(size * size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      let filled = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const r = row + dr;
          const c = col + dc;
          if (r >= 0 && r < size && c >= 0 && c < size && cells[r * size + c] === 1) filled += 1;
        }
      }
      out[row * size + col] = filled >= 5 ? 1 : 0;
    }
  }
  return out;
}

/** A mirror-symmetric, smoothed shape. Not yet checked for solvability; see dealGrown. */
function growShape(random: () => number, size: number): string[] {
  const half = Math.ceil(size / 2);
  let cells = new Array<number>(size * size).fill(0);

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < half; col += 1) {
      const on = random() < SEED_DENSITY ? 1 : 0;
      cells[row * size + col] = on;
      cells[row * size + (size - 1 - col)] = on;
    }
  }

  for (let pass = 0; pass < SMOOTHING_PASSES; pass += 1) {
    const next = smooth(cells, size);
    // Smoothing is symmetric on a symmetric input, but the odd middle column
    // of an odd-width board can drift; re-mirroring costs nothing and pins it.
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < half; col += 1) {
        next[row * size + (size - 1 - col)] = next[row * size + col];
      }
    }
    cells = next;
  }

  return cells.map((cell) => (cell === 1 ? SOLUTION_FILLED : SOLUTION_EMPTY));
}

/**
 * A grown board, repaired until line logic alone finishes it.
 *
 * The repair is the same one the old generator used and terminates for the
 * same reason: when the solver stalls, a filled square is *added* somewhere it
 * stalled, which strictly increases the filled count, and the completely
 * filled grid (every clue a single run the width of the board) is trivially
 * solvable. So the loop cannot run past `size * size` repairs. Smoothing
 * means it usually runs none.
 *
 * Symmetry is not preserved by the repair, and deliberately so: a board that
 * has to be solvable and a board that has to be pretty are not always the same
 * board, and this one stakes Gold.
 */
function dealGrown(random: () => number, size: number): NonogramDeal {
  const cells = growShape(random, size);

  for (let repair = 0; repair <= size * size; repair += 1) {
    const solved = solveNonogram(nonogramClues(cells.join(""), size), size);
    if (solved !== null) {
      const stuck: number[] = [];
      for (let index = 0; index < solved.length; index += 1) {
        if (solved[index] === UNKNOWN) stuck.push(index);
      }
      if (stuck.length === 0) return { solution: cells.join(""), title: null };

      const addable = stuck.filter((index) => cells[index] === SOLUTION_EMPTY);
      if (addable.length > 0) {
        cells[addable[Math.floor(random() * addable.length)]] = SOLUTION_FILLED;
        continue;
      }
      // Every undetermined square is already filled, so there is nothing to
      // add one at a time. Filling that square's whole row still adds squares:
      // a row holding an undetermined square is never already full, since a
      // full row's clue is one run the width of the board and the line solver
      // settles that immediately.
      const row = Math.floor(stuck[0] / size);
      for (let col = 0; col < size; col += 1) cells[row * size + col] = SOLUTION_FILLED;
      continue;
    }

    // A contradiction can only come from a malformed clue set, which clues
    // read off a real grid cannot be. Filling a row is still the way forward:
    // it moves toward the trivially solvable all-filled grid rather than
    // looping on the same board.
    for (let col = 0; col < size; col += 1) cells[col] = SOLUTION_FILLED;
  }

  return { solution: cells.join(""), title: null };
}

/**
 * The picture a fresh round is dealt, reproducible from its seed.
 *
 * A drawing where the library has one for this width, a grown shape otherwise.
 * The seed is stored on the round, so a board can always be rebuilt from its
 * own state.
 */
export function dealNonogram(seed: number, difficulty: NonogramDifficulty): NonogramDeal {
  const { size } = nonogramConfig(difficulty);
  const random = mulberry32(seed >>> 0);
  return dealPicture(random, size) ?? dealGrown(random, size);
}

/**
 * Whether a dealt board is finishable by line logic alone.
 *
 * The deal path already guarantees this -- drawings are checked once by the
 * test suite, grown shapes are repaired here until they pass -- so this exists
 * for the tests to assert it directly rather than infer it.
 */
export function isDealSolvable(deal: NonogramDeal, size: number): boolean {
  return isNoGuessNonogram(deal.solution, size);
}
