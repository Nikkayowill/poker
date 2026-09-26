/**
 * Sudoku.
 *
 * A grid per difficulty, generated from a seed string rather than stored, so
 * there is no puzzle bank to run out. Pure and clock-free like the rest of
 * lib/arcade/puzzles: the seed comes in as a string and `now` comes in as a
 * Date, so the whole thing is reachable from `npm test`. This file has no
 * opinion on where a seed comes from; a fresh random string per attempt is
 * supplied by the caller (see lib/arcade/ante-up.ts).
 *
 * The solution never leaves the server. A sudoku's answer is the entire
 * game: if the client held it, every board would be one console command
 * from solved, and the shared result would mean nothing (the same argument
 * lib/arcade/puzzles/connections.ts makes about withholding which group
 * each word is in). So `toSudokuSnapshot` drops `solution` outright, and a
 * fill is validated by the server one cell at a time: a correct digit is
 * written, a wrong one is refused and counted.
 *
 * A determined player can therefore find any single cell by trying digits
 * until one is accepted. That's intentional: the alternative, no feedback
 * until the grid is full, turns an honest mistake into a silent,
 * unrecoverable waste of twenty minutes. Brute force isn't free either;
 * every wrong digit is counted, the count is in the share text, and
 * "Sudoku #128 hard, 46 mistakes" tells the whole story by itself. There's
 * no Gold on this board, so the only thing at stake is a claim, and the
 * counter is what keeps the claim honest.
 *
 * Generation walks from a solved grid rather than searching for one:
 * building a full solution first and carving clues out of it is the
 * standard approach and the only one with a bounded running time. A solved
 * grid comes from shuffling a known-valid pattern, which cannot fail, and
 * carving only ever removes a clue when the board provably still has
 * exactly one solution. Searching for a puzzle directly can and does run
 * long.
 *
 * Everything random here comes from a seeded PRNG over `day:difficulty`,
 * never Math.random: two calls for the same day must return the same grid,
 * or two players wouldn't be sharing a puzzle at all.
 */

import { hashString, mulberry32 } from "@/lib/seeded-random";

export const SUDOKU_SIZE = 9;
export const SUDOKU_CELLS = SUDOKU_SIZE * SUDOKU_SIZE;

export type SudokuDifficulty = "easy" | "medium" | "hard" | "expert";

export const SUDOKU_DIFFICULTIES = ["easy", "medium", "hard", "expert"] as const;

/**
 * How many clues each difficulty leaves on the board.
 *
 * These are targets, not guarantees: carving stops early if no further
 * clue can come out without the board admitting a second solution. 17 is
 * the proven minimum for any unique sudoku, so nothing here goes near it.
 * An "expert" that's merely a guessing exercise isn't harder, it's worse.
 */
export const DIFFICULTY_CLUES: Record<SudokuDifficulty, number> = {
  easy: 42,
  medium: 34,
  hard: 29,
  expert: 25,
};

export function isSudokuDifficulty(value: string): value is SudokuDifficulty {
  return (SUDOKU_DIFFICULTIES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ random */

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

/* ------------------------------------------------------------------- rules */

export function rowOf(index: number): number {
  return Math.floor(index / SUDOKU_SIZE);
}
export function columnOf(index: number): number {
  return index % SUDOKU_SIZE;
}
/** 0..8, reading left to right then top to bottom. */
export function boxOf(index: number): number {
  return Math.floor(rowOf(index) / 3) * 3 + Math.floor(columnOf(index) / 3);
}

/** Whether `value` may go in `index` without clashing with the grid as it stands. */
export function isPlacementLegal(grid: readonly number[], index: number, value: number): boolean {
  const row = rowOf(index);
  const column = columnOf(index);
  const boxRow = Math.floor(row / 3) * 3;
  const boxColumn = Math.floor(column / 3) * 3;

  for (let step = 0; step < SUDOKU_SIZE; step += 1) {
    const inRow = row * SUDOKU_SIZE + step;
    if (inRow !== index && grid[inRow] === value) return false;
    const inColumn = step * SUDOKU_SIZE + column;
    if (inColumn !== index && grid[inColumn] === value) return false;
    const inBox = (boxRow + Math.floor(step / 3)) * SUDOKU_SIZE + boxColumn + (step % 3);
    if (inBox !== index && grid[inBox] === value) return false;
  }
  return true;
}

function bitCount(mask: number): number {
  let count = 0;
  for (let bits = mask; bits !== 0; bits &= bits - 1) count += 1;
  return count;
}

/**
 * How many solutions a grid has, counted up to `limit`.
 *
 * Capped rather than exhaustive because the only question ever asked of it is
 * "exactly one?", and an empty-ish grid has billions. It picks the most
 * constrained empty cell first, which is what keeps the search from walking
 * into a corner and backtracking through it.
 */
export function countSolutions(grid: readonly number[], limit = 2): number {
  const working = [...grid];

  // A grid whose filled cells already clash has no solutions; saying so
  // here isn't just an optimisation. The search below only ever inspects
  // empty cells, so it would never notice the contradiction on its own: it
  // would enumerate the whole remaining space looking for a completion
  // that can't exist, which on a nearly-empty board doesn't finish in any
  // useful time.
  for (let index = 0; index < SUDOKU_CELLS; index += 1) {
    const value = working[index];
    if (value !== 0 && !isPlacementLegal(working, index, value)) return 0;
  }

  // Bitmasks of the digits already used in each row, column and box, so a
  // cell's options are three ORs rather than a scan of its 20 peers.
  const rows = new Array<number>(SUDOKU_SIZE).fill(0);
  const columns = new Array<number>(SUDOKU_SIZE).fill(0);
  const boxes = new Array<number>(SUDOKU_SIZE).fill(0);
  const empty: number[] = [];
  for (let index = 0; index < SUDOKU_CELLS; index += 1) {
    const value = working[index];
    if (value === 0) {
      empty.push(index);
      continue;
    }
    rows[rowOf(index)] |= 1 << value;
    columns[columnOf(index)] |= 1 << value;
    boxes[boxOf(index)] |= 1 << value;
  }

  const search = (depth: number): number => {
    // No empty cell left: this is a complete, legal grid.
    if (depth === empty.length) return 1;

    let bestAt = -1;
    let bestOptions = 0;
    let bestCount = 10;
    for (let at = depth; at < empty.length; at += 1) {
      const index = empty[at];
      const options = ~(rows[rowOf(index)] | columns[columnOf(index)] | boxes[boxOf(index)]) & 0b1111111110;
      const count = bitCount(options);
      // A cell with nothing legal in it kills the branch immediately.
      if (count === 0) return 0;
      if (count < bestCount) {
        bestAt = at;
        bestOptions = options;
        bestCount = count;
        if (count === 1) break;
      }
    }

    // Move the chosen cell to the front of the unfilled part of the list.
    [empty[depth], empty[bestAt]] = [empty[bestAt], empty[depth]];
    const index = empty[depth];
    const row = rowOf(index);
    const column = columnOf(index);
    const box = boxOf(index);

    let found = 0;
    for (let value = 1; value <= SUDOKU_SIZE && found < limit; value += 1) {
      const bit = 1 << value;
      if ((bestOptions & bit) === 0) continue;
      rows[row] |= bit;
      columns[column] |= bit;
      boxes[box] |= bit;
      found += search(depth + 1);
      rows[row] &= ~bit;
      columns[column] &= ~bit;
      boxes[box] &= ~bit;
    }
    [empty[depth], empty[bestAt]] = [empty[bestAt], empty[depth]];
    return found;
  };

  return search(0);
}

export function hasUniqueSolution(grid: readonly number[]): boolean {
  return countSolutions(grid, 2) === 1;
}

/* ----------------------------------------------------------------- grading */

/**
 * The hardest kind of step a person needs to finish a grid.
 *
 * 1: naked singles only (a cell with one digit left).
 * 2: hidden singles too (a digit with one place left in a row, column or box).
 * 3: beyond singles, but the standard expert kit is enough: locked
 *    candidates, naked and hidden pairs and triples, X-Wing and XY-Wing.
 * null: none of the above finishes it; it needs chains or trial and error.
 */
export type SudokuLogicLevel = 1 | 2 | 3;

const UNITS: readonly (readonly number[])[] = (() => {
  const units: number[][] = [];
  for (let n = 0; n < SUDOKU_SIZE; n += 1) {
    const row: number[] = [];
    const column: number[] = [];
    const box: number[] = [];
    for (let step = 0; step < SUDOKU_SIZE; step += 1) {
      row.push(n * SUDOKU_SIZE + step);
      column.push(step * SUDOKU_SIZE + n);
      box.push((Math.floor(n / 3) * 3 + Math.floor(step / 3)) * SUDOKU_SIZE + (n % 3) * 3 + (step % 3));
    }
    units.push(row, column, box);
  }
  return units;
})();
const ROWS = UNITS.filter((_, at) => at % 3 === 0);
const COLUMNS = UNITS.filter((_, at) => at % 3 === 1);

const PEERS: readonly (readonly number[])[] = Array.from({ length: SUDOKU_CELLS }, (_, index) => {
  const peers = new Set<number>();
  for (const unit of UNITS) {
    if (unit.includes(index)) for (const cell of unit) if (cell !== index) peers.add(cell);
  }
  return [...peers];
});

const ALL_DIGITS = 0b1111111110;

/** Every k-sized subset of `items`. k is 2 or 3 here, so the count stays small. */
function subsets<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, chosen: T[]) => {
    if (chosen.length === k) {
      out.push([...chosen]);
      return;
    }
    for (let at = start; at < items.length; at += 1) {
      chosen.push(items[at]);
      pick(at + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return out;
}

/**
 * Solves the way a person does, always reaching for the easiest step first,
 * and reports the hardest step it needed. Null when it gets stuck.
 */
export function sudokuLogicLevel(puzzle: readonly number[]): SudokuLogicLevel | null {
  return gradeSudoku(puzzle).level;
}

/** `sudokuLogicLevel` plus the grid as far as the logic got, for the tests to check it. */
export function gradeSudoku(puzzle: readonly number[]): { level: SudokuLogicLevel | null; grid: number[] } {
  const grid = [...puzzle];
  const candidates = new Array<number>(SUDOKU_CELLS).fill(0);
  for (let index = 0; index < SUDOKU_CELLS; index += 1) {
    if (grid[index] !== 0) continue;
    let mask = ALL_DIGITS;
    for (const peer of PEERS[index]) if (grid[peer] !== 0) mask &= ~(1 << grid[peer]);
    candidates[index] = mask;
  }

  const place = (index: number, value: number) => {
    grid[index] = value;
    candidates[index] = 0;
    for (const peer of PEERS[index]) candidates[peer] &= ~(1 << value);
  };

  const nakedSingle = (): boolean => {
    for (let index = 0; index < SUDOKU_CELLS; index += 1) {
      if (grid[index] === 0 && bitCount(candidates[index]) === 1) {
        place(index, Math.log2(candidates[index]));
        return true;
      }
    }
    return false;
  };

  const hiddenSingle = (): boolean => {
    for (const unit of UNITS) {
      for (let value = 1; value <= SUDOKU_SIZE; value += 1) {
        let only = -1;
        let count = 0;
        for (const cell of unit) {
          if (candidates[cell] & (1 << value)) {
            only = cell;
            count += 1;
          }
        }
        if (count === 1) {
          place(only, value);
          return true;
        }
      }
    }
    return false;
  };

  // Removes `mask` from every cell of `unit` not in `keep`. True if anything went.
  const eliminate = (unit: readonly number[], keep: readonly number[], mask: number): boolean => {
    let changed = false;
    for (const cell of unit) {
      if (keep.includes(cell) || (candidates[cell] & mask) === 0) continue;
      candidates[cell] &= ~mask;
      changed = true;
    }
    return changed;
  };

  const lockedCandidates = (): boolean => {
    for (const unit of UNITS) {
      for (let value = 1; value <= SUDOKU_SIZE; value += 1) {
        const cells = unit.filter((cell) => candidates[cell] & (1 << value));
        if (cells.length < 2) continue;
        // All of this digit's places in one unit also sit inside another unit,
        // so it can't go anywhere else in that other unit.
        for (const other of UNITS) {
          if (other === unit || !cells.every((cell) => other.includes(cell))) continue;
          if (eliminate(other, cells, 1 << value)) return true;
        }
      }
    }
    return false;
  };

  const subsetsInUnits = (size: number): boolean => {
    for (const unit of UNITS) {
      const open = unit.filter((cell) => grid[cell] === 0);
      if (open.length <= size) continue;
      for (const group of subsets(open, size)) {
        let mask = 0;
        for (const cell of group) mask |= candidates[cell];
        if (bitCount(mask) === size && eliminate(unit, group, mask)) return true;
      }
      const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) =>
        open.some((cell) => candidates[cell] & (1 << value)),
      );
      for (const group of subsets(digits, size)) {
        let mask = 0;
        for (const value of group) mask |= 1 << value;
        const places = open.filter((cell) => candidates[cell] & mask);
        if (places.length !== size) continue;
        let changed = false;
        for (const cell of places) {
          if (candidates[cell] & ~mask) {
            candidates[cell] &= mask;
            changed = true;
          }
        }
        if (changed) return true;
      }
    }
    return false;
  };

  // A digit with exactly two places in each of two rows, in the same two
  // columns, can't go anywhere else in those columns. Same with rows and
  // columns swapped.
  const xWing = (): boolean => {
    for (const lines of [ROWS, COLUMNS]) {
      const crossing = lines === ROWS ? COLUMNS : ROWS;
      for (let value = 1; value <= SUDOKU_SIZE; value += 1) {
        const bit = 1 << value;
        const spots = lines.map((line) =>
          line.map((cell, at) => (candidates[cell] & bit ? at : -1)).filter((at) => at >= 0),
        );
        for (let a = 0; a < SUDOKU_SIZE; a += 1) {
          if (spots[a].length !== 2) continue;
          for (let b = a + 1; b < SUDOKU_SIZE; b += 1) {
            if (spots[b].length !== 2 || spots[b][0] !== spots[a][0] || spots[b][1] !== spots[a][1]) continue;
            const keep = [lines[a][spots[a][0]], lines[a][spots[a][1]], lines[b][spots[b][0]], lines[b][spots[b][1]]];
            let changed = false;
            for (const at of spots[a]) changed = eliminate(crossing[at], keep, bit) || changed;
            if (changed) return true;
          }
        }
      }
    }
    return false;
  };

  // A two-digit pivot {x,y} sees {x,z} and {y,z}: whichever the pivot is,
  // one of those two holds z, so nothing that sees both can.
  const xyWing = (): boolean => {
    for (let pivot = 0; pivot < SUDOKU_CELLS; pivot += 1) {
      if (bitCount(candidates[pivot]) !== 2) continue;
      const pincers = PEERS[pivot].filter((cell) => {
        const mask = candidates[cell];
        return bitCount(mask) === 2 && bitCount(mask & candidates[pivot]) === 1;
      });
      for (let a = 0; a < pincers.length; a += 1) {
        for (let b = a + 1; b < pincers.length; b += 1) {
          const first = candidates[pincers[a]];
          const second = candidates[pincers[b]];
          const shared = first & second;
          if (bitCount(shared) !== 1 || shared & candidates[pivot]) continue;
          if (((first | second) & ~shared) !== candidates[pivot]) continue;
          let changed = false;
          for (const cell of PEERS[pincers[a]]) {
            if (cell === pincers[b] || !PEERS[pincers[b]].includes(cell)) continue;
            if (candidates[cell] & shared) {
              candidates[cell] &= ~shared;
              changed = true;
            }
          }
          if (changed) return true;
        }
      }
    }
    return false;
  };

  let level: SudokuLogicLevel = 1;
  while (grid.includes(0)) {
    if (nakedSingle()) continue;
    if (hiddenSingle()) {
      level = Math.max(level, 2) as SudokuLogicLevel;
      continue;
    }
    if (lockedCandidates() || subsetsInUnits(2) || subsetsInUnits(3) || xWing() || xyWing()) {
      level = 3;
      continue;
    }
    return { level: null, grid };
  }
  return { level, grid };
}

/* -------------------------------------------------------------- generation */

/**
 * A complete, valid grid, built by permuting a known-good pattern.
 *
 * The base pattern `(row * 3 + floor(row / 3) + column) % 9` is a valid
 * sudoku for any 9x9. Relabelling the digits, and swapping rows within a
 * band, bands, columns within a stack, and stacks, all preserve validity,
 * so this always produces a legal solution and never has to backtrack.
 */
export function solvedGrid(random: () => number): number[] {
  const digits = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], random);
  const bands = shuffled([0, 1, 2], random);
  const stacks = shuffled([0, 1, 2], random);
  const rowsIn = [0, 1, 2].map(() => shuffled([0, 1, 2], random));
  const columnsIn = [0, 1, 2].map(() => shuffled([0, 1, 2], random));

  const grid = new Array<number>(SUDOKU_CELLS).fill(0);
  for (let row = 0; row < SUDOKU_SIZE; row += 1) {
    for (let column = 0; column < SUDOKU_SIZE; column += 1) {
      const sourceRow = bands[Math.floor(row / 3)] * 3 + rowsIn[Math.floor(row / 3)][row % 3];
      const sourceColumn = stacks[Math.floor(column / 3)] * 3 + columnsIn[Math.floor(column / 3)][column % 3];
      const base = (sourceRow * 3 + Math.floor(sourceRow / 3) + sourceColumn) % SUDOKU_SIZE;
      grid[row * SUDOKU_SIZE + column] = digits[base];
    }
  }
  return grid;
}

/**
 * Removes clues from a solved grid for as long as the answer stays unique.
 *
 * Cells are tried in a seeded order and a removal is undone the moment the
 * board admits a second solution, so the result is always a puzzle with
 * exactly one answer, which is what makes "wrong digit" a fact rather than
 * an opinion.
 */
export function carvePuzzle(solution: readonly number[], targetClues: number, random: () => number): number[] {
  const puzzle = [...solution];
  let clues = SUDOKU_CELLS;

  for (const index of shuffled(Array.from({ length: SUDOKU_CELLS }, (_, i) => i), random)) {
    if (clues <= targetClues) break;
    const removed = puzzle[index];
    puzzle[index] = 0;
    if (hasUniqueSolution(puzzle)) {
      clues -= 1;
    } else {
      puzzle[index] = removed;
    }
  }
  return puzzle;
}

export interface SudokuBoard {
  puzzle: number[];
  solution: number[];
}

/**
 * The kind of reasoning each difficulty asks for, on top of its clue count.
 *
 * Clue count alone is a poor guide: plenty of 25-clue grids fall to singles
 * alone, which is a fast fill rather than an expert test. Hard must need at
 * least one hidden single. Expert must get stuck on singles and need the
 * standard expert kit (see `sudokuLogicLevel`), and never more than that, so
 * it stays a test of skill rather than of guessing.
 */
export const DIFFICULTY_LOGIC: Record<SudokuDifficulty, readonly (SudokuLogicLevel | null)[]> = {
  easy: [1, 2, 3, null],
  medium: [1, 2, 3, null],
  hard: [2, 3],
  expert: [3],
};

/** New grids tried before settling. Each costs a few ms; see `generateSudoku`. */
const GRADED_ATTEMPTS = 14;
/** How far below its clue target a grid may be carved to reach its grade. */
const DEEPEN_SLACK = 3;

/**
 * Carves past the target, one unique-preserving removal at a time, until the
 * grid reaches an accepted grade. A removal that overshoots into a grade
 * harder than any accepted one is put back. Null if the grid never gets there.
 */
function deepenToGrade(
  puzzle: readonly number[],
  floor: number,
  accepted: readonly (SudokuLogicLevel | null)[],
  random: () => number,
  onTooHard: (puzzle: number[]) => void,
): number[] | null {
  const working = [...puzzle];
  let clues = working.filter((cell) => cell !== 0).length;
  const hardest = Math.max(...accepted.map((level) => level ?? 4));

  for (const index of shuffled(Array.from({ length: SUDOKU_CELLS }, (_, i) => i), random)) {
    if (clues <= floor) break;
    if (working[index] === 0) continue;
    const removed = working[index];
    working[index] = 0;
    if (!hasUniqueSolution(working)) {
      working[index] = removed;
      continue;
    }
    const level = sudokuLogicLevel(working);
    if (accepted.includes(level)) return working;
    if ((level ?? 4) > hardest) {
      onTooHard([...working]);
      working[index] = removed;
      continue;
    }
    clues -= 1;
  }
  return null;
}

/**
 * The board for one day and difficulty.
 *
 * Deterministic: the same arguments always produce the same grid, which is
 * the whole basis of a shared daily. The salt keeps the four difficulties
 * from being permutations of one another: solving the easy grid must not
 * hand anybody the expert one.
 *
 * Hard and expert are carved, graded, and carved a little further or started
 * again until the grade is right. That usually takes one or two grids and a
 * few tens of ms at most. If GRADED_ATTEMPTS all miss, expert settles for a
 * grid that is harder than asked (still unique, still past singles) before
 * one that is easier.
 */
export function generateSudoku(day: string, difficulty: SudokuDifficulty): SudokuBoard {
  const random = mulberry32(hashString(`sudoku:${day}:${difficulty}`));
  const target = DIFFICULTY_CLUES[difficulty];
  const accepted = DIFFICULTY_LOGIC[difficulty];

  let tooHard: SudokuBoard | null = null;
  let last: SudokuBoard | null = null;
  for (let attempt = 0; attempt < GRADED_ATTEMPTS; attempt += 1) {
    const solution = solvedGrid(random);
    const puzzle = carvePuzzle(solution, target, random);
    const level = sudokuLogicLevel(puzzle);
    if (accepted.includes(level)) return { puzzle, solution };

    last = { puzzle, solution };
    if (level === null || level > Math.max(...accepted.map((entry) => entry ?? 4))) {
      tooHard ??= { puzzle, solution };
      continue;
    }
    const deeper = deepenToGrade(puzzle, target - DEEPEN_SLACK, accepted, random, (harder) => {
      tooHard ??= { puzzle: harder, solution };
    });
    if (deeper) return { puzzle: deeper, solution };
  }
  return tooHard ?? last!;
}

/* ------------------------------------------------------------------- round */

export type SudokuStatus = "playing" | "solved";

export interface SudokuRound {
  difficulty: SudokuDifficulty;
  /** The givens. Non-zero cells are fixed and can never be written to. */
  puzzle: number[];
  /** SECRET. Dropped by toSudokuSnapshot; see the note at the top of this file. */
  solution: number[];
  /** What the player has filled in. Zero is empty. Only ever holds correct digits. */
  entries: number[];
  /** Wrong digits offered, cumulative. Reported in the share text. */
  mistakes: number;
  status: SudokuStatus;
  /** ISO instants. The clock is the server's, so a paused tab cannot stop it. */
  startedAt: string;
  finishedAt: string | null;
}

export function startSudokuRound(board: SudokuBoard, difficulty: SudokuDifficulty, now: Date): SudokuRound {
  return {
    difficulty,
    puzzle: [...board.puzzle],
    solution: [...board.solution],
    entries: new Array<number>(SUDOKU_CELLS).fill(0),
    mistakes: 0,
    status: "playing",
    startedAt: now.toISOString(),
    finishedAt: null,
  };
}

/** A cell the player may write to: on the board, and not a given. */
export function isEditable(round: Pick<SudokuRound, "puzzle">, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < SUDOKU_CELLS && round.puzzle[index] === 0;
}

export type SudokuFillProblem = "finished" | "not-editable" | "out-of-range";

/** Why a fill cannot be made, or null if it can. Checked before anything is written. */
export function sudokuFillProblem(round: SudokuRound, index: number, value: number): SudokuFillProblem | null {
  if (round.status !== "playing") return "finished";
  if (!Number.isInteger(value) || value < 0 || value > SUDOKU_SIZE) return "out-of-range";
  if (!isEditable(round, index)) return "not-editable";
  return null;
}

export interface SudokuFillResult {
  round: SudokuRound;
  /** False when the digit was wrong: it isn't written, and a mistake is counted. */
  correct: boolean;
}

/**
 * Writes a digit, or counts a mistake.
 *
 * `value === 0` erases and is always allowed on an editable cell: rubbing out
 * your own guess is not a mistake and must never be counted as one.
 *
 * Inert on an illegal fill rather than throwing: the service checks first,
 * and a throw there would be a 500 where a 409 belongs.
 */
export function fillSudokuCell(round: SudokuRound, index: number, value: number, now: Date): SudokuFillResult {
  if (sudokuFillProblem(round, index, value)) return { round, correct: false };

  if (value === 0) {
    const entries = [...round.entries];
    entries[index] = 0;
    return { round: { ...round, entries }, correct: true };
  }

  if (value !== round.solution[index]) {
    return { round: { ...round, mistakes: round.mistakes + 1 }, correct: false };
  }

  const entries = [...round.entries];
  entries[index] = value;
  const solved = entries.every((entry, cell) => round.puzzle[cell] !== 0 || entry !== 0);

  return {
    round: {
      ...round,
      entries,
      status: solved ? "solved" : "playing",
      finishedAt: solved ? now.toISOString() : null,
    },
    correct: true,
  };
}

/** How long the attempt took, in ms. Null while it is still running. */
export function sudokuElapsedMs(round: Pick<SudokuRound, "startedAt" | "finishedAt">): number | null {
  if (!round.finishedAt) return null;
  return Math.max(0, Date.parse(round.finishedAt) - Date.parse(round.startedAt));
}

/** "12:04". Minutes and seconds, because no daily sudoku runs to hours worth printing. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The board as the browser may see it.
 *
 * `solution` is gone, not blanked, absent. That's the single most
 * important line in this file: with it, the puzzle is a formality and the
 * shared result is worthless.
 */
export interface SudokuSnapshot {
  day: string;
  puzzleNumber: number;
  version: number;
  difficulty: SudokuDifficulty;
  puzzle: number[];
  entries: number[];
  mistakes: number;
  status: SudokuStatus;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number | null;
  clues: number;
}

export function toSudokuSnapshot(
  round: SudokuRound,
  meta: { day: string; puzzleNumber: number; version: number },
): SudokuSnapshot {
  return {
    day: meta.day,
    puzzleNumber: meta.puzzleNumber,
    version: meta.version,
    difficulty: round.difficulty,
    puzzle: [...round.puzzle],
    entries: [...round.entries],
    mistakes: round.mistakes,
    status: round.status,
    startedAt: round.startedAt,
    finishedAt: round.finishedAt,
    elapsedMs: sudokuElapsedMs(round),
    clues: round.puzzle.filter((cell) => cell !== 0).length,
  };
}
