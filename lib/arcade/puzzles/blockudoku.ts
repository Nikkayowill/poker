/**
 * Blockudoku: the board rules on their own, no wager and no storage.
 *
 * Same split as lib/arcade/puzzles/minesweeper.ts and lib/arcade/ante-up-
 * minesweeper.ts -- this file is only the puzzle, lib/arcade/ante-up-
 * blockudoku.ts is the wager on top of it.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 * 1. **The draw stream is resumable, not restartable.** A round redraws its
 *    3-piece inventory every time all three slots empty out, which can happen
 *    any number of times in one game. `mulberry32(seed)` always starts the
 *    same sequence from the top, so if every draw re-seeded from it the
 *    second refill would hand back the exact same three pieces as the first.
 *    `rngState` carries the PRNG's own accumulator forward across draws (via
 *    `mulberry32Step`, the resumable form `lib/seeded-random.ts` documents for
 *    exactly this case), so the whole game is still reproducible from the
 *    starting seed while never repeating a draw.
 *
 * 2. **`rngState` must never reach the browser while a round is live.** It is
 *    the seed for every piece not yet drawn; a client holding it could predict
 *    its own next inventory. `blockudokuView` is the only shape that may cross
 *    the wire, same rule minesweeper's mine positions follow.
 *
 * 3. **A wagered refill mixes in fresh entropy.** The pieces already dealt say
 *    enough about a 32-bit accumulator to recover it and read every later
 *    deal. `placeBlockudokuPiece` takes an `entropy` the server draws from its
 *    CSPRNG, XORed in before a refill, so nothing seen so far predicts the
 *    next three. Left at 0 the stream is still fully reproducible for tests.
 */

import { mulberry32Step } from "@/lib/seeded-random";

export type BlockudokuRoundStatus = "active" | "over";

/** Why a placement cannot be made, or null if it can. */
export type BlockudokuMoveProblem =
  | "finished"
  | "invalid-slot"
  | "empty-slot"
  | "out-of-bounds"
  | "occupied";

export interface BlockudokuShape {
  readonly id: string;
  /** Offsets from an anchor cell, [row, col]. No rotation: a shape is always played as drawn. */
  readonly cells: readonly (readonly [number, number])[];
}

/**
 * The fixed set of pieces a round ever draws from. Single block up through
 * the four-cell tetrominoes, the same family a classic block-puzzle deals --
 * no five-or-more piece, which is what keeps a jammed board recoverable by a
 * careful player instead of routinely impossible near the end of a round.
 */
export const BLOCKUDOKU_SHAPES: readonly BlockudokuShape[] = [
  { id: "single", cells: [[0, 0]] },
  { id: "domino-h", cells: [[0, 0], [0, 1]] },
  { id: "domino-v", cells: [[0, 0], [1, 0]] },
  { id: "tromino-i-h", cells: [[0, 0], [0, 1], [0, 2]] },
  { id: "tromino-i-v", cells: [[0, 0], [1, 0], [2, 0]] },
  { id: "tromino-l-1", cells: [[0, 0], [0, 1], [1, 0]] },
  { id: "tromino-l-2", cells: [[0, 0], [0, 1], [1, 1]] },
  { id: "tromino-l-3", cells: [[0, 0], [1, 0], [1, 1]] },
  { id: "tromino-l-4", cells: [[0, 1], [1, 0], [1, 1]] },
  { id: "tetromino-i-h", cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { id: "tetromino-i-v", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: "tetromino-o", cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { id: "tetromino-t", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { id: "tetromino-s", cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  { id: "tetromino-z", cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  { id: "tetromino-l", cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
  { id: "tetromino-j", cells: [[0, 1], [1, 1], [2, 1], [2, 0]] },
];

export const GRID_SIDE = 9;
export const GRID_CELLS = GRID_SIDE * GRID_SIDE;
export const INVENTORY_SIZE = 3;

/** One point per cell placed -- the baseline every piece earns just for fitting. */
const PLACEMENT_POINT_PER_CELL = 1;

/** Per line/region cleared, before the escalation below. */
const CLEAR_BONUS_PER_LINE = 18;

export interface BlockudokuRound {
  /** GRID_CELLS entries, row-major: index = row * GRID_SIDE + col. 0 empty, 1 occupied. */
  board: number[];
  /** Always 3 slots. null marks a slot already played, empty until the next refill. */
  inventory: (BlockudokuShape | null)[];
  score: number;
  status: BlockudokuRoundStatus;
  /** The PRNG's own accumulator, carried forward so a refill never repeats a past draw. See the file header. */
  rngState: number;
  moves: number;
  /** Null until the first placement; the clock starts there, same as Minesweeper's first click. */
  startedAt: string | null;
  endedAt: string | null;
}

function drawShape(rngState: number): { shape: BlockudokuShape; nextState: number } {
  const [nextState, value] = mulberry32Step(rngState);
  const index = Math.min(
    BLOCKUDOKU_SHAPES.length - 1,
    Math.floor(value * BLOCKUDOKU_SHAPES.length),
  );
  return { shape: BLOCKUDOKU_SHAPES[index], nextState };
}

function drawInventory(rngState: number): { inventory: BlockudokuShape[]; nextState: number } {
  const inventory: BlockudokuShape[] = [];
  let state = rngState;
  for (let i = 0; i < INVENTORY_SIZE; i += 1) {
    const drawn = drawShape(state);
    inventory.push(drawn.shape);
    state = drawn.nextState;
  }
  return { inventory, nextState: state };
}

export function startBlockudokuRound(seed: number): BlockudokuRound {
  const { inventory, nextState } = drawInventory(seed >>> 0);
  return {
    board: new Array(GRID_CELLS).fill(0),
    inventory,
    score: 0,
    status: "active",
    rngState: nextState,
    moves: 0,
    startedAt: null,
    endedAt: null,
  };
}

/** Board indices a shape would occupy anchored at (row, col), or null if any cell falls off the grid. */
function targetCells(
  shape: BlockudokuShape,
  anchorRow: number,
  anchorCol: number,
): number[] | null {
  const indices: number[] = [];
  for (const [dr, dc] of shape.cells) {
    const row = anchorRow + dr;
    const col = anchorCol + dc;
    if (row < 0 || row >= GRID_SIDE || col < 0 || col >= GRID_SIDE) return null;
    indices.push(row * GRID_SIDE + col);
  }
  return indices;
}

function canPlaceAt(
  board: readonly number[],
  shape: BlockudokuShape,
  anchorRow: number,
  anchorCol: number,
): boolean {
  const indices = targetCells(shape, anchorRow, anchorCol);
  if (indices === null) return false;
  return indices.every((index) => board[index] === 0);
}

function canPlaceAnywhere(board: readonly number[], shape: BlockudokuShape): boolean {
  for (let row = 0; row < GRID_SIDE; row += 1) {
    for (let col = 0; col < GRID_SIDE; col += 1) {
      if (canPlaceAt(board, shape, row, col)) return true;
    }
  }
  return false;
}

export function blockudokuPlacementProblem(
  round: BlockudokuRound,
  slot: number,
  anchorRow: number,
  anchorCol: number,
): BlockudokuMoveProblem | null {
  if (round.status !== "active") return "finished";
  if (!Number.isInteger(slot) || slot < 0 || slot >= INVENTORY_SIZE) return "invalid-slot";
  const shape = round.inventory[slot];
  if (!shape) return "empty-slot";
  if (!Number.isInteger(anchorRow) || !Number.isInteger(anchorCol)) return "out-of-bounds";

  const indices = targetCells(shape, anchorRow, anchorCol);
  if (indices === null) return "out-of-bounds";
  if (indices.some((index) => round.board[index] !== 0)) return "occupied";
  return null;
}

function rowIndices(row: number): number[] {
  const out: number[] = [];
  for (let col = 0; col < GRID_SIDE; col += 1) out.push(row * GRID_SIDE + col);
  return out;
}

function colIndices(col: number): number[] {
  const out: number[] = [];
  for (let row = 0; row < GRID_SIDE; row += 1) out.push(row * GRID_SIDE + col);
  return out;
}

function regionIndices(regionRow: number, regionCol: number): number[] {
  const out: number[] = [];
  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      out.push((regionRow * 3 + dr) * GRID_SIDE + (regionCol * 3 + dc));
    }
  }
  return out;
}

/**
 * Every full row, column and 3x3 region clears at once. A cell shared by two
 * of them (a row and a region both full through the same corner) is cleared
 * once, since it is one cell, but each line/region it belonged to still
 * counts toward `linesCleared` -- the bonus is for how many lines came down
 * together, not how many cells were emptied.
 */
function clearCompletedLines(board: readonly number[]): { board: number[]; linesCleared: number } {
  const toClear = new Set<number>();
  let linesCleared = 0;

  for (let row = 0; row < GRID_SIDE; row += 1) {
    const indices = rowIndices(row);
    if (indices.every((index) => board[index] === 1)) {
      linesCleared += 1;
      for (const index of indices) toClear.add(index);
    }
  }
  for (let col = 0; col < GRID_SIDE; col += 1) {
    const indices = colIndices(col);
    if (indices.every((index) => board[index] === 1)) {
      linesCleared += 1;
      for (const index of indices) toClear.add(index);
    }
  }
  for (let regionRow = 0; regionRow < 3; regionRow += 1) {
    for (let regionCol = 0; regionCol < 3; regionCol += 1) {
      const indices = regionIndices(regionRow, regionCol);
      if (indices.every((index) => board[index] === 1)) {
        linesCleared += 1;
        for (const index of indices) toClear.add(index);
      }
    }
  }

  const next = board.slice() as number[];
  for (const index of toClear) next[index] = 0;
  return { board: next, linesCleared };
}

/**
 * Triangular escalation, so clearing several lines in one placement pays more
 * than clearing them one at a time would: 1 line is 18, 2 at once is 54 (not
 * 36), 3 at once is 108 (not 54). Rewards setting up a multi-clear on
 * purpose, the way the real game does.
 */
function clearBonus(linesCleared: number): number {
  if (linesCleared <= 0) return 0;
  return (CLEAR_BONUS_PER_LINE * linesCleared * (linesCleared + 1)) / 2;
}

/** Places a piece, clears whatever it completes, and checks whether the resulting inventory can still move. */
export function placeBlockudokuPiece(
  round: BlockudokuRound,
  slot: number,
  anchorRow: number,
  anchorCol: number,
  now: Date,
  entropy = 0,
): BlockudokuRound {
  if (blockudokuPlacementProblem(round, slot, anchorRow, anchorCol)) return round;

  const shape = round.inventory[slot] as BlockudokuShape;
  const indices = targetCells(shape, anchorRow, anchorCol) as number[];
  const placedBoard = round.board.slice();
  for (const index of indices) placedBoard[index] = 1;

  const { board, linesCleared } = clearCompletedLines(placedBoard);
  const points = shape.cells.length * PLACEMENT_POINT_PER_CELL + clearBonus(linesCleared);

  const afterPlay = round.inventory.slice();
  afterPlay[slot] = null;

  let inventory = afterPlay;
  let rngState = round.rngState;
  if (inventory.every((entry) => entry === null)) {
    const refill = drawInventory((rngState ^ entropy) >>> 0);
    inventory = refill.inventory;
    rngState = refill.nextState;
  }

  const jammed = !inventory.some((piece) => piece !== null && canPlaceAnywhere(board, piece));

  return {
    ...round,
    board,
    inventory,
    score: round.score + points,
    status: jammed ? "over" : "active",
    rngState,
    moves: round.moves + 1,
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: jammed ? now.toISOString() : null,
  };
}

// Score-attack has no "lost" board state the way a mine or a jam does, so
// giving up is the only way an attempt ends without hitting the target score
// or the clock -- see the wager wrapper's resignAnteUpBlockudoku for the
// payout consequence.
export function resignBlockudokuRound(round: BlockudokuRound, now: Date): BlockudokuRound {
  if (round.status !== "active") return round;
  return {
    ...round,
    status: "over",
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: now.toISOString(),
  };
}

export interface BlockudokuView {
  board: readonly number[];
  inventory: readonly (BlockudokuShape | null)[];
  score: number;
  status: BlockudokuRoundStatus;
  moves: number;
  startedAt: string | null;
  endedAt: string | null;
}

/** The only shape that may cross the wire; see the file header on why `rngState` never does. */
export function blockudokuView(round: BlockudokuRound): BlockudokuView {
  return {
    board: round.board,
    inventory: round.inventory,
    score: round.score,
    status: round.status,
    moves: round.moves,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
  };
}

/** Milliseconds from the first placement to the last, or to `now` while live. */
export function blockudokuElapsedMs(round: BlockudokuRound, now: Date): number {
  if (!round.startedAt) return 0;
  const end = round.endedAt ? Date.parse(round.endedAt) : now.getTime();
  return Math.max(0, end - Date.parse(round.startedAt));
}
