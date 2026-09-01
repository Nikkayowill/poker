/**
 * Nonogram (Picross): the board rules on their own, no wager and no storage.
 *
 * A grid is described only by its row and column clues -- the run lengths of
 * filled cells in each line, in order. The player reconstructs the picture
 * from those numbers alone.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 * 1. **Every puzzle is solvable by line logic alone.** `solveNonogram` is the
 *    same reasoning a person does (take one line at a time, keep the cells
 *    that every legal arrangement of that line agrees on, repeat), and
 *    `generateNonogram` does not hand back a grid until that reasoning
 *    finishes it. A nonogram that needs a guess is a coin flip, and
 *    lib/arcade/ante-up-nonogram.ts stakes real Gold on this. Same guarantee,
 *    same reason, as `isNoGuessBoard` in ./minesweeper.ts.
 *
 * 2. **The solution never crosses the wire while a round is live.**
 *    `nonogramView` is the only shape that may, and it carries the clues and
 *    the player's own marks, never the answer. Same rule as ./minesweeper.ts's
 *    mine list and lib/pvp/word-race-words.ts being server-only: a client
 *    holding the answer wins every time.
 *
 * Only a *fill* is checked against the solution. A cross is the player's own
 * notation for "I have worked out this one is empty" and is never scored --
 * marking one wrong costs nothing but the confusion it causes you, exactly as
 * in every paper nonogram. That is why the mistake budget can be small.
 */

import { mulberry32 } from "@/lib/seeded-random";

export type NonogramDifficulty = "easy" | "medium" | "hard" | "expert" | "master";

export type NonogramRoundStatus = "active" | "cleared" | "lost";

/** What the player may put in a square. `clear` takes a mark back off. */
export type NonogramMark = "fill" | "cross" | "clear";

/** Why a mark cannot be made, or null if it can. */
export type NonogramMoveProblem = "finished" | "out-of-bounds" | "already-known" | "no-change";

export interface NonogramDifficultyConfig {
  readonly id: NonogramDifficulty;
  readonly label: string;
  /** Boards are square, so this is both the width and the height. */
  readonly size: number;
  /** Wrong fills allowed before the board is lost. */
  readonly mistakes: number;
}

/**
 * Five rungs, 5x5 up to 25x25.
 *
 * Square on purpose: a nonogram's difficulty is how much cross-referencing
 * between rows and columns it takes, and a square grid is the honest way to
 * scale that with one number. Unlike Minesweeper, this ladder is not capped
 * for phone width -- a 25x25 board is 625 squares and will not fit a phone at
 * a tappable size, so `.ng-frame` scrolls in both axes rather than shrinking
 * the squares to something nobody can hit. See 50-nonogram.css.
 *
 * The mistake budget grows with the board because a bigger grid has more
 * places to slip, not because a bigger grid is meant to be more forgiving:
 * three wrong squares out of 25 is a different proposition from three out of
 * 625.
 */
export const NONOGRAM_DIFFICULTIES: readonly NonogramDifficultyConfig[] = [
  { id: "easy", label: "Easy", size: 5, mistakes: 3 },
  { id: "medium", label: "Medium", size: 10, mistakes: 3 },
  { id: "hard", label: "Hard", size: 15, mistakes: 4 },
  { id: "expert", label: "Expert", size: 20, mistakes: 5 },
  { id: "master", label: "Master", size: 25, mistakes: 6 },
];

/** The largest board any difficulty deals; the outer bound a request may name a cell within. */
export const NONOGRAM_MAX_CELLS = NONOGRAM_DIFFICULTIES.reduce(
  (most, entry) => Math.max(most, entry.size * entry.size),
  0,
);

export function nonogramConfig(id: NonogramDifficulty): NonogramDifficultyConfig {
  const found = NONOGRAM_DIFFICULTIES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown nonogram difficulty: ${id}`);
  return found;
}

export function isNonogramDifficulty(value: unknown): value is NonogramDifficulty {
  return NONOGRAM_DIFFICULTIES.some((entry) => entry.id === value);
}

/* --------------------------------------------------------------- encoding */

/** A solution cell. Strings rather than numbers so a whole grid is one JSON scalar. */
export const SOLUTION_FILLED = "#";
export const SOLUTION_EMPTY = ".";

/** A player's mark. `?` is an untouched square. */
export const MARK_UNKNOWN = "?";
export const MARK_FILLED = "#";
export const MARK_CROSSED = "x";

/** Line-solver cell states. Deliberately not the string encoding: this is hot code. */
const UNKNOWN = 0;
const FILLED = 1;
const EMPTY = 2;

export interface NonogramClues {
  /** One run-length list per row, top to bottom. An empty list is a blank line. */
  rows: number[][];
  /** One per column, left to right. */
  cols: number[][];
}

/** The run lengths in one line of the solution, in order. Empty for a blank line. */
function runsOf(cells: readonly number[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const cell of cells) {
    if (cell === FILLED) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

function toCells(solution: string): number[] {
  return [...solution].map((cell) => (cell === SOLUTION_FILLED ? FILLED : EMPTY));
}

/** The clues a solution produces. This is the puzzle; the solution is the answer. */
export function nonogramClues(solution: string, size: number): NonogramClues {
  const cells = toCells(solution);
  const rows: number[][] = [];
  const cols: number[][] = [];

  for (let row = 0; row < size; row += 1) {
    rows.push(runsOf(cells.slice(row * size, row * size + size)));
  }
  for (let col = 0; col < size; col += 1) {
    const line: number[] = [];
    for (let row = 0; row < size; row += 1) line.push(cells[row * size + col]);
    cols.push(runsOf(line));
  }
  return { rows, cols };
}

/* ----------------------------------------------------------- line solving */

/**
 * Everything one line's clue proves, given what is already known about it.
 *
 * Returns the line with every cell that *every* legal arrangement agrees on
 * filled in, and null when the clue and the known cells contradict each other
 * (which can only happen on a malformed puzzle; the generator never produces
 * one).
 *
 * This is the whole solver. It is a two-pass dynamic program rather than an
 * enumeration of arrangements, because enumeration is exponential in the
 * number of runs and a 25-wide line with six runs has thousands of them:
 *
 *   - `satisfiable(i, j)` asks whether cells i.. can be completed using runs
 *     j.., memoised over the (position, run) grid, so the whole question costs
 *     O(cells x runs) rather than O(arrangements).
 *   - `walk` then visits only the states actually reachable from the start
 *     *and* satisfiable to the end, recording for each cell whether some legal
 *     arrangement fills it and whether some legal arrangement leaves it empty.
 *     A cell only one of those is true for is proven.
 *
 * Exported so the tests can pin the no-guess guarantee directly rather than
 * inferring it from how long generation took, the same way ./minesweeper.ts
 * exports `isNoGuessBoard`.
 */
export function solveNonogramLine(line: readonly number[], clue: readonly number[]): number[] | null {
  const n = line.length;
  const k = clue.length;

  // -1 not computed yet, 0 no, 1 yes. Indexed [position * (k + 1) + run].
  const memo = new Int8Array((n + 2) * (k + 1)).fill(-1);
  const canFill = new Uint8Array(n);
  const canEmpty = new Uint8Array(n);

  /** Whether run `j` may start at cell `i`: room for it, nothing known-empty under it, and a gap after. */
  const fits = (i: number, j: number): boolean => {
    const length = clue[j];
    if (i + length > n) return false;
    for (let cell = i; cell < i + length; cell += 1) {
      if (line[cell] === EMPTY) return false;
    }
    return i + length >= n || line[i + length] !== FILLED;
  };

  /** Where the line continues after run `j` is placed at `i`, clamped to the end. */
  const after = (i: number, j: number): number => Math.min(i + clue[j] + 1, n);

  const satisfiable = (i: number, j: number): boolean => {
    if (j === k) {
      // No runs left, so everything from here on has to be empty.
      for (let cell = i; cell < n; cell += 1) {
        if (line[cell] === FILLED) return false;
      }
      return true;
    }
    if (i >= n) return false;

    const key = i * (k + 1) + j;
    if (memo[key] !== -1) return memo[key] === 1;
    // Set before recursing: the recursion only ever moves forward, so this can
    // never be read back at the same key, but a cycle would otherwise hang.
    memo[key] = 0;

    let ok = false;
    if (line[i] !== FILLED) ok = satisfiable(i + 1, j);
    if (!ok && fits(i, j)) ok = satisfiable(after(i, j), j + 1);
    memo[key] = ok ? 1 : 0;
    return ok;
  };

  if (!satisfiable(0, 0)) return null;

  const seen = new Uint8Array((n + 2) * (k + 1));
  const walk = (i: number, j: number): void => {
    const key = i * (k + 1) + j;
    if (seen[key]) return;
    seen[key] = 1;

    if (j === k) {
      for (let cell = i; cell < n; cell += 1) canEmpty[cell] = 1;
      return;
    }
    if (i >= n) return;

    if (line[i] !== FILLED && satisfiable(i + 1, j)) {
      canEmpty[i] = 1;
      walk(i + 1, j);
    }
    if (fits(i, j) && satisfiable(after(i, j), j + 1)) {
      for (let cell = i; cell < i + clue[j]; cell += 1) canFill[cell] = 1;
      if (i + clue[j] < n) canEmpty[i + clue[j]] = 1;
      walk(after(i, j), j + 1);
    }
  };
  walk(0, 0);

  const out: number[] = [];
  for (let cell = 0; cell < n; cell += 1) {
    if (canFill[cell] && !canEmpty[cell]) out.push(FILLED);
    else if (canEmpty[cell] && !canFill[cell]) out.push(EMPTY);
    else if (!canFill[cell] && !canEmpty[cell]) return null;
    else out.push(line[cell]);
  }
  return out;
}

/**
 * How far line logic alone gets from a blank grid.
 *
 * Returns the grid it settles on: FILLED / EMPTY / UNKNOWN per cell, in
 * row-major order. Any UNKNOWN left over means the puzzle needs a guess and
 * the generator must not ship it. Null means the clues contradict themselves.
 */
export function solveNonogram(clues: NonogramClues, size: number): number[] | null {
  const grid = new Array<number>(size * size).fill(UNKNOWN);

  let progressed = true;
  while (progressed) {
    progressed = false;

    for (let row = 0; row < size; row += 1) {
      const line = grid.slice(row * size, row * size + size);
      const solved = solveNonogramLine(line, clues.rows[row]);
      if (solved === null) return null;
      for (let col = 0; col < size; col += 1) {
        if (solved[col] !== grid[row * size + col]) {
          grid[row * size + col] = solved[col];
          progressed = true;
        }
      }
    }

    for (let col = 0; col < size; col += 1) {
      const line: number[] = [];
      for (let row = 0; row < size; row += 1) line.push(grid[row * size + col]);
      const solved = solveNonogramLine(line, clues.cols[col]);
      if (solved === null) return null;
      for (let row = 0; row < size; row += 1) {
        if (solved[row] !== grid[row * size + col]) {
          grid[row * size + col] = solved[row];
          progressed = true;
        }
      }
    }
  }

  return grid;
}

/** Whether line logic alone finishes this puzzle. The guarantee a wager rests on. */
export function isNoGuessNonogram(solution: string, size: number): boolean {
  const solved = solveNonogram(nonogramClues(solution, size), size);
  if (solved === null) return false;
  return solved.every((cell) => cell !== UNKNOWN);
}

/* ------------------------------------------------------------- generation */

/**
 * How full a fresh grid starts.
 *
 * Sparse grids make dull pictures and, more importantly, ambiguous ones: a
 * line with one short run in it has many places that run could sit. A little
 * over half is where random grids start being pinned down by their own
 * neighbours.
 */
const FILL_DENSITY = 0.58;

function randomGrid(random: () => number, size: number): string[] {
  const cells: string[] = [];
  for (let index = 0; index < size * size; index += 1) {
    cells.push(random() < FILL_DENSITY ? SOLUTION_FILLED : SOLUTION_EMPTY);
  }
  return cells;
}

/**
 * A puzzle that line logic alone can finish, every time, with no retry cap to
 * fall off the end of.
 *
 * A random grid usually is one already. When it is not, the fix is to *add* a
 * filled square somewhere the solver got stuck and try again, and that is
 * what makes this terminate rather than merely usually terminate: every
 * repair strictly increases the number of filled squares, and the completely
 * filled grid (every clue reading "n", every line settled on the first pass)
 * is trivially solvable. So the loop cannot run past `size * size` repairs,
 * and in practice it stops after a handful or none at all.
 *
 * The fallback branch matters for the same reason. When every undetermined
 * square is *already* filled in the solution there is nothing to add
 * cell-by-cell, so the repair fills that square's whole row instead. A row
 * holding an undetermined square is never already full (a full row's clue is
 * a single run the width of the board, which the line solver settles
 * immediately), so that branch also strictly adds squares.
 */
export function generateNonogram(seed: number, difficulty: NonogramDifficulty): string {
  const { size } = nonogramConfig(difficulty);
  const random = mulberry32(seed >>> 0);
  const cells = randomGrid(random, size);

  for (let repair = 0; repair <= size * size; repair += 1) {
    const solved = solveNonogram(nonogramClues(cells.join(""), size), size);
    if (solved !== null) {
      const stuck: number[] = [];
      for (let index = 0; index < solved.length; index += 1) {
        if (solved[index] === UNKNOWN) stuck.push(index);
      }
      if (stuck.length === 0) return cells.join("");

      const addable = stuck.filter((index) => cells[index] === SOLUTION_EMPTY);
      if (addable.length > 0) {
        cells[addable[Math.floor(random() * addable.length)]] = SOLUTION_FILLED;
        continue;
      }
      const row = Math.floor(stuck[0] / size);
      for (let col = 0; col < size; col += 1) cells[row * size + col] = SOLUTION_FILLED;
      continue;
    }

    // A contradiction can only come from a malformed clue set, which the
    // clues-from-a-real-grid path above cannot produce. Filling a row is
    // still the safe way forward: it moves toward the trivially solvable
    // all-filled grid rather than looping on the same broken one.
    for (let col = 0; col < size; col += 1) cells[col] = SOLUTION_FILLED;
  }

  return cells.join("");
}

/* ------------------------------------------------------------------ round */

export interface NonogramRound {
  difficulty: NonogramDifficulty;
  size: number;
  /** Drives the layout, so a round is reproducible from its own stored state. */
  seed: number;
  /** '#' / '.', row-major. Never leaves the server while the round is live. */
  solution: string;
  /** '?' / '#' / 'x', row-major. What the player has put down. */
  marks: string;
  /** Wrong fills so far. A cross is never wrong; see the file header. */
  mistakes: number;
  /** Copied from the difficulty at deal, so a retune cannot move it mid-board. */
  mistakeLimit: number;
  status: NonogramRoundStatus;
  /** Fills, crosses and clears: what the player actually did. */
  moves: number;
  /** Null until the first mark; the clock starts on the first square, as Minesweeper's does. */
  startedAt: string | null;
  endedAt: string | null;
}

export function startNonogramRound(
  difficulty: NonogramDifficulty,
  seed: number,
): NonogramRound {
  const config = nonogramConfig(difficulty);
  return {
    difficulty,
    size: config.size,
    seed: seed >>> 0,
    solution: generateNonogram(seed, difficulty),
    marks: MARK_UNKNOWN.repeat(config.size * config.size),
    mistakes: 0,
    mistakeLimit: config.mistakes,
    status: "active",
    moves: 0,
    startedAt: null,
    endedAt: null,
  };
}

function inBounds(round: NonogramRound, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < round.size * round.size;
}

function withMark(marks: string, index: number, mark: string): string {
  return marks.slice(0, index) + mark + marks.slice(index + 1);
}

/**
 * Whether every filled square of the solution has been filled in.
 *
 * Crosses are not consulted: a player who works out the whole picture without
 * ever marking an empty square has still solved it, and a paper nonogram
 * would not care either.
 */
function isCleared(round: NonogramRound, marks: string): boolean {
  for (let index = 0; index < round.solution.length; index += 1) {
    if (round.solution[index] === SOLUTION_FILLED && marks[index] !== MARK_FILLED) return false;
  }
  return true;
}

export function nonogramMarkProblem(
  round: NonogramRound,
  index: number,
  mark: NonogramMark,
): NonogramMoveProblem | null {
  if (round.status !== "active") return "finished";
  if (!inBounds(round, index)) return "out-of-bounds";

  const current = round.marks[index];
  // A correct fill is settled: the board has proved that square filled, and
  // letting it be crossed or cleared would only ever be a misclick undoing
  // work that is already banked. A cross is not settled, whether the player
  // put it there or a wrong fill did -- clearing one costs the player the
  // information and can only ever cost them another mistake, so there is
  // nothing to protect them from.
  if (current === MARK_FILLED) return "already-known";
  if (mark === "clear" && current === MARK_UNKNOWN) return "no-change";
  if (mark === "cross" && current === MARK_CROSSED) return "no-change";
  return null;
}

/**
 * Puts one mark down.
 *
 * A fill is the only mark checked against the solution. A wrong one costs a
 * mistake and leaves the square crossed, since the board has just proved it
 * empty and pretending otherwise would only invite the same wrong fill again.
 */
export function markNonogramCell(
  round: NonogramRound,
  index: number,
  mark: NonogramMark,
  now: Date,
): NonogramRound {
  if (nonogramMarkProblem(round, index, mark)) return round;

  const correct = round.solution[index] === SOLUTION_FILLED;
  let marks = round.marks;
  let mistakes = round.mistakes;

  if (mark === "clear") {
    marks = withMark(marks, index, MARK_UNKNOWN);
  } else if (mark === "cross") {
    marks = withMark(marks, index, MARK_CROSSED);
  } else if (correct) {
    marks = withMark(marks, index, MARK_FILLED);
  } else {
    marks = withMark(marks, index, MARK_CROSSED);
    mistakes += 1;
  }

  let status: NonogramRoundStatus = "active";
  if (mistakes >= round.mistakeLimit) status = "lost";
  else if (isCleared(round, marks)) status = "cleared";

  return {
    ...round,
    marks,
    mistakes,
    status,
    moves: round.moves + 1,
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: status === "active" ? null : now.toISOString(),
  };
}

/** Gives up. The round ends as a loss, with the picture revealed. */
export function resignNonogramRound(round: NonogramRound, now: Date): NonogramRound {
  if (round.status !== "active") return round;
  return {
    ...round,
    status: "lost",
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------- view */

export interface NonogramView {
  difficulty: NonogramDifficulty;
  size: number;
  clues: NonogramClues;
  status: NonogramRoundStatus;
  /** '?' / '#' / 'x', row-major: the player's own marks and nothing else. */
  marks: string;
  /**
   * The answer, once the round is over, and null while it is live. This is
   * the redaction boundary; see the file header.
   */
  solution: string | null;
  mistakes: number;
  mistakeLimit: number;
  /** How many filled squares the picture has, and how many are down. Both are derivable from the clues. */
  filled: number;
  filledTotal: number;
  moves: number;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * The only shape the browser may see.
 *
 * The clues are public by definition -- they are the puzzle. The solution is
 * not, until the round is over, and `filledTotal` is given rather than left
 * for the client to add up only because it is the same number either way (the
 * clues sum to it), not because it is a shortcut around the redaction.
 */
export function nonogramView(round: NonogramRound): NonogramView {
  const clues = nonogramClues(round.solution, round.size);
  const filledTotal = clues.rows.reduce(
    (total, runs) => total + runs.reduce((sum, run) => sum + run, 0),
    0,
  );
  let filled = 0;
  for (const mark of round.marks) {
    if (mark === MARK_FILLED) filled += 1;
  }

  return {
    difficulty: round.difficulty,
    size: round.size,
    clues,
    status: round.status,
    marks: round.marks,
    solution: round.status === "active" ? null : round.solution,
    mistakes: round.mistakes,
    mistakeLimit: round.mistakeLimit,
    filled,
    filledTotal,
    moves: round.moves,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
  };
}

/** Seconds on the clock: from the first mark to the last, or to `now` while live. */
export function nonogramElapsedMs(round: NonogramRound, now: Date): number {
  if (!round.startedAt) return 0;
  const end = round.endedAt ? Date.parse(round.endedAt) : now.getTime();
  return Math.max(0, end - Date.parse(round.startedAt));
}
