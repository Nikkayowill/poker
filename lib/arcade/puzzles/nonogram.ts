/**
 * Nonogram (Picross): the board rules on their own, no wager and no storage.
 *
 * A grid is described only by its row and column clues -- the run lengths of
 * filled cells in each line, in order. The player reconstructs the picture
 * from those numbers alone.
 *
 * Three things here are load-bearing and easy to undo by accident:
 *
 * 1. **Every puzzle is solvable by line logic alone.** `solveNonogram` is the
 *    same reasoning a person does (take one line at a time, keep the cells
 *    that every legal arrangement of that line agrees on, repeat), and
 *    ./nonogram-deal.ts does not hand back a board until that reasoning
 *    finishes it. A nonogram that needs a guess is a coin flip, and
 *    lib/arcade/ante-up-nonogram.ts stakes real Gold on this. Same guarantee,
 *    same reason, as `isNoGuessBoard` in ./minesweeper.ts.
 *
 * 2. **The solution never crosses the wire while a round is live.**
 *    `nonogramView` is the only shape that may, and it carries the clues and
 *    the player's own marks, never the answer or the drawing's name. Same rule
 *    as ./minesweeper.ts's mine list and lib/pvp/word-race-words.ts being
 *    server-only: a client holding the answer wins every time. This module is
 *    client-imported, which is why the picture library lives behind
 *    `server-only` in ./nonogram-pictures.ts and a round is *dealt* one rather
 *    than importing it -- the arrangement ./connections.ts has with
 *    ./connections-puzzles.ts.
 *
 * 3. **Only a *fill* is checked against the solution.** A cross is the
 *    player's own notation for "I have worked out this one is empty" and is
 *    never scored -- marking one wrong costs nothing but the confusion it
 *    causes you, exactly as in every paper nonogram. That is why the mistake
 *    budget can be small.
 *
 * Everything past the bare rules is here because a nonogram nobody wants to
 * play is not a cheaper nonogram, it is a worse one:
 *
 *   - **Strokes.** `markNonogramCells` puts a whole dragged line down in one
 *     call. Every good picross is played by dragging, and a 25x25 board is 625
 *     squares -- one round trip each would be a worse game and a slower one.
 *     A stroke stops at its first wrong fill, so a bad drag costs one mistake
 *     rather than the whole budget.
 *   - **Auto-cross.** Once the player's own fills satisfy a line's clue, the
 *     rest of that line is provably empty and gets crossed for them. Provably
 *     from the marks and the clues, never from the answer: fills are only ever
 *     correct (a wrong one becomes a cross), so marks matching the clue means
 *     the line is finished.
 *   - **Undo**, one stroke at a time, and **hints**, which cost a mistake.
 */

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

/* ------------------------------------------------------------------ deal */

/**
 * A dealt board: the answer and, when it is a drawing rather than a grown
 * shape, what that drawing is of.
 *
 * Handed to `startNonogramRound` rather than made by it. The picture library
 * is `server-only` and this module is not; see the file header.
 */
export interface NonogramDeal {
  /** '#' / '.', row-major, `size * size` long. */
  readonly solution: string;
  /** The drawing's name, or null for a grown shape that is not a named thing. */
  readonly title: string | null;
}

/* ------------------------------------------------------------------ round */

/**
 * How many strokes back undo reaches.
 *
 * Bounded because the whole round is one stored JSON row and an unbounded
 * history on a 25x25 board is unbounded storage. Twenty is well past the
 * "that drag went sideways" case undo actually exists for.
 */
export const NONOGRAM_UNDO_DEPTH = 20;

/** One square a stroke changed, and what it read before. Undo puts these back. */
export interface NonogramUndoCell {
  index: number;
  /** The mark character that was there: '?', '#' or 'x'. */
  was: string;
}

export interface NonogramRound {
  difficulty: NonogramDifficulty;
  size: number;
  /** Kept so a round is reproducible from its own stored state. */
  seed: number;
  /** '#' / '.', row-major. Never leaves the server while the round is live. */
  solution: string;
  /** What the drawing is of, or null for a grown shape. Redacted while the round is live. */
  title: string | null;
  /** '?' / '#' / 'x', row-major. What the player has put down. */
  marks: string;
  /** Wrong fills so far. A cross is never wrong; see the file header. */
  mistakes: number;
  /** Copied from the difficulty at deal, so a retune cannot move it mid-board. */
  mistakeLimit: number;
  /** Crosses off the rest of a line the moment the player's fills satisfy its clue. */
  autoCross: boolean;
  /** Squares given away. Each cost a mistake; see `hintNonogramCell`. */
  hints: number;
  /** The last NONOGRAM_UNDO_DEPTH strokes, oldest first. */
  history: NonogramUndoCell[][];
  status: NonogramRoundStatus;
  /** Fills, crosses and clears: what the player actually did. */
  moves: number;
  /** Null until the first mark; the clock starts on the first square, as Minesweeper's does. */
  startedAt: string | null;
  endedAt: string | null;
}

export interface NonogramRoundOptions {
  /** Defaults on. Off is the paper experience, for players who want to cross their own. */
  autoCross?: boolean;
}

export function startNonogramRound(
  difficulty: NonogramDifficulty,
  seed: number,
  deal: NonogramDeal,
  options: NonogramRoundOptions = {},
): NonogramRound {
  const config = nonogramConfig(difficulty);
  return {
    difficulty,
    size: config.size,
    seed: seed >>> 0,
    solution: deal.solution,
    title: deal.title,
    marks: MARK_UNKNOWN.repeat(config.size * config.size),
    mistakes: 0,
    mistakeLimit: config.mistakes,
    autoCross: options.autoCross ?? true,
    hints: 0,
    history: [],
    status: "active",
    moves: 0,
    startedAt: null,
    endedAt: null,
  };
}

function inBounds(round: NonogramRound, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < round.size * round.size;
}

/**
 * Whether every filled square of the solution has been filled in.
 *
 * Crosses are not consulted: a player who works out the whole picture without
 * ever marking an empty square has still solved it, and a paper nonogram
 * would not care either.
 */
function isCleared(round: NonogramRound, marks: readonly string[]): boolean {
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

/* ------------------------------------------------------------ auto-cross */

/** The runs the given marks spell out in one line. Only '#' counts; '?' and 'x' both break a run. */
function markedRuns(cells: readonly string[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const cell of cells) {
    if (cell === MARK_FILLED) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

function sameRuns(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((run, i) => run === b[i]);
}

/**
 * Crosses off the rest of the row and column through `index`, when the
 * player's own fills already satisfy that line's clue.
 *
 * This reads nothing but the marks and the clues, both of which the player
 * already has, so it gives away nothing the board had not already told them.
 * It is sound because a mark can only ever be a *correct* fill -- a wrong one
 * is turned into a cross -- so a line whose marked runs equal its clue is a
 * line that is finished, and every remaining square in it is empty.
 *
 * Mutates `cells` and appends what it changed to `changed`, since it runs
 * inside a stroke that is already accumulating both.
 */
function autoCrossThrough(
  round: NonogramRound,
  clues: NonogramClues,
  cells: string[],
  index: number,
  changed: NonogramUndoCell[],
): void {
  const size = round.size;
  const row = Math.floor(index / size);
  const col = index % size;

  const rowCells = cells.slice(row * size, row * size + size);
  if (sameRuns(markedRuns(rowCells), clues.rows[row])) {
    for (let c = 0; c < size; c += 1) {
      const at = row * size + c;
      if (cells[at] === MARK_UNKNOWN) {
        changed.push({ index: at, was: MARK_UNKNOWN });
        cells[at] = MARK_CROSSED;
      }
    }
  }

  const colCells: string[] = [];
  for (let r = 0; r < size; r += 1) colCells.push(cells[r * size + col]);
  if (sameRuns(markedRuns(colCells), clues.cols[col])) {
    for (let r = 0; r < size; r += 1) {
      const at = r * size + col;
      if (cells[at] === MARK_UNKNOWN) {
        changed.push({ index: at, was: MARK_UNKNOWN });
        cells[at] = MARK_CROSSED;
      }
    }
  }
}

/**
 * Which clue numbers in one line the player's marks have already pinned down.
 *
 * Worked from both ends inwards, which is how a person does it: a run closed
 * off on both sides, the right length, and the next one still unaccounted for
 * from that end is settled, and the scan stops at the first square that could
 * still be anything. Stopping there is the whole point -- a run floating in
 * the middle of a line with unknowns either side might be any of the clues,
 * and striking off the wrong one is worse than striking off none.
 *
 * Reads the marks and the clue, never the solution, so it is safe to run in
 * the browser -- which is where it does run, to dim the numbers as they are
 * accounted for. Lives here rather than in the component so it can be tested
 * and so the two cannot drift.
 */
export function satisfiedNonogramClues(
  cells: readonly string[],
  clue: readonly number[],
): boolean[] {
  const done = clue.map(() => false);
  if (clue.length === 0) return done;

  let head = 0;
  let at = 0;
  while (at < cells.length && head < clue.length) {
    const cell = cells[at];
    if (cell === MARK_CROSSED) { at += 1; continue; }
    if (cell === MARK_UNKNOWN) break;

    let end = at;
    while (end < cells.length && cells[end] === MARK_FILLED) end += 1;
    // An open right edge means the run may still grow, so its length proves nothing.
    if (end < cells.length && cells[end] === MARK_UNKNOWN) break;
    if (end - at !== clue[head]) break;
    done[head] = true;
    head += 1;
    at = end;
  }

  let tail = clue.length - 1;
  at = cells.length - 1;
  while (at >= 0 && tail >= head) {
    const cell = cells[at];
    if (cell === MARK_CROSSED) { at -= 1; continue; }
    if (cell === MARK_UNKNOWN) break;

    let end = at;
    while (end >= 0 && cells[end] === MARK_FILLED) end -= 1;
    if (end >= 0 && cells[end] === MARK_UNKNOWN) break;
    if (at - end !== clue[tail]) break;
    done[tail] = true;
    tail -= 1;
    at = end;
  }

  return done;
}

/** Every clue number's state, by line. `rows[r][i]` is the i'th number of row r. */
export function nonogramClueProgress(
  marks: string,
  size: number,
  clues: NonogramClues,
): { rows: boolean[][]; cols: boolean[][] } {
  const cells = [...marks];
  const rows: boolean[][] = [];
  const cols: boolean[][] = [];

  for (let row = 0; row < size; row += 1) {
    rows.push(satisfiedNonogramClues(cells.slice(row * size, row * size + size), clues.rows[row]));
  }
  for (let col = 0; col < size; col += 1) {
    const line: string[] = [];
    for (let row = 0; row < size; row += 1) line.push(cells[row * size + col]);
    cols.push(satisfiedNonogramClues(line, clues.cols[col]));
  }
  return { rows, cols };
}

/* ----------------------------------------------------------------- moves */

/** What a stroke did, past the board it produced. */
export interface NonogramStrokeResult {
  round: NonogramRound;
  /** Squares the player's own marks landed on, auto-crosses excluded. */
  applied: number;
  /** True when a wrong fill cut the stroke short. */
  aborted: boolean;
}

/**
 * Puts a whole stroke down: one mark, across a list of squares, in order.
 *
 * This is the move. `markNonogramCell` is one square through the same path,
 * because a drag and a tap should not be able to disagree about the rules.
 *
 * Two things a stroke does that a loop of taps would not:
 *
 *   - **It stops at the first wrong fill.** A player dragging along a row is
 *     asserting the whole run, and being wrong about where it ends is one
 *     mistake, not one per square past the end. Any good picross does this,
 *     and the alternative here would let a single careless drag spend a whole
 *     mistake budget.
 *   - **It is one undo step.** The stroke's squares are recorded together, so
 *     undo takes back the drag rather than the last square of it.
 *
 * Squares the board refuses (out of bounds, already settled, no change) are
 * skipped rather than failing the stroke: a drag runs over settled squares all
 * the time and stopping there would make dragging useless.
 */
export function markNonogramCells(
  round: NonogramRound,
  indexes: readonly number[],
  mark: NonogramMark,
  now: Date,
): NonogramStrokeResult {
  if (round.status !== "active") return { round, applied: 0, aborted: false };

  const cells = [...round.marks];
  const changed: NonogramUndoCell[] = [];
  const clues = round.autoCross ? nonogramClues(round.solution, round.size) : null;

  let mistakes = round.mistakes;
  let applied = 0;
  let aborted = false;

  for (const index of indexes) {
    if (!inBounds(round, index)) continue;
    const current = cells[index];
    if (current === MARK_FILLED) continue;
    if (mark === "clear" && current === MARK_UNKNOWN) continue;
    if (mark === "cross" && current === MARK_CROSSED) continue;

    changed.push({ index, was: current });
    applied += 1;

    if (mark === "clear") {
      cells[index] = MARK_UNKNOWN;
    } else if (mark === "cross") {
      cells[index] = MARK_CROSSED;
    } else if (round.solution[index] === SOLUTION_FILLED) {
      cells[index] = MARK_FILLED;
      if (clues) autoCrossThrough(round, clues, cells, index, changed);
    } else {
      // The board has just proved this square empty; leaving it blank would
      // only invite the same wrong fill again.
      cells[index] = MARK_CROSSED;
      mistakes += 1;
      aborted = true;
      break;
    }
  }

  if (changed.length === 0) return { round, applied: 0, aborted };

  let status: NonogramRoundStatus = "active";
  if (mistakes >= round.mistakeLimit) status = "lost";
  else if (isCleared(round, cells)) status = "cleared";

  const history = [...round.history, changed].slice(-NONOGRAM_UNDO_DEPTH);

  return {
    round: {
      ...round,
      marks: cells.join(""),
      mistakes,
      history,
      status,
      moves: round.moves + applied,
      startedAt: round.startedAt ?? now.toISOString(),
      endedAt: status === "active" ? null : now.toISOString(),
    },
    applied,
    aborted,
  };
}

/**
 * Puts one mark down.
 *
 * A fill is the only mark checked against the solution. A wrong one costs a
 * mistake and leaves the square crossed.
 */
export function markNonogramCell(
  round: NonogramRound,
  index: number,
  mark: NonogramMark,
  now: Date,
): NonogramRound {
  if (nonogramMarkProblem(round, index, mark)) return round;
  return markNonogramCells(round, [index], mark, now).round;
}

/* ------------------------------------------------------------------ undo */

/** Why undo cannot run, or null if it can. */
export type NonogramUndoProblem = "finished" | "nothing-to-undo";

export function nonogramUndoProblem(round: NonogramRound): NonogramUndoProblem | null {
  if (round.status !== "active") return "finished";
  if (round.history.length === 0) return "nothing-to-undo";
  return null;
}

/**
 * Takes back the last stroke.
 *
 * Squares the board has proved filled are left alone: they are settled the
 * same way `nonogramMarkProblem` says they are, and un-filling banked work is
 * never what the player meant. So undo is in practice the way back from a
 * cross-drag that went one square too far, which is the accident it exists
 * for. A mistake already charged is never refunded -- being wrong happened,
 * and letting undo unwind it would make the budget meaningless.
 */
export function undoNonogram(round: NonogramRound): NonogramRound {
  if (nonogramUndoProblem(round)) return round;

  const cells = [...round.marks];
  const stroke = round.history[round.history.length - 1];
  // Backwards, so a square a stroke touched twice ends on what it read first.
  for (let i = stroke.length - 1; i >= 0; i -= 1) {
    const { index, was } = stroke[i];
    if (cells[index] === MARK_FILLED) continue;
    cells[index] = was;
  }

  return { ...round, marks: cells.join(""), history: round.history.slice(0, -1) };
}

/* ------------------------------------------------------------------ hint */

/** Why a hint cannot be given, or null if it can. */
export type NonogramHintProblem = "finished" | "budget" | "nothing-left";

/**
 * A hint costs one mistake, and the last one may not be spent on it.
 *
 * Costing something is not optional. Every board here is finishable by
 * reasoning alone, so a free hint is a free square, and enough free squares on
 * a board staking real Gold is a board that pays without being played. The
 * mistake budget is the natural price: it is already the thing that measures
 * how much room you have to be uncertain. Refusing the last one is the
 * difference between a hint and a trap -- nobody wants a help button that ends
 * the game.
 */
export function nonogramHintProblem(round: NonogramRound): NonogramHintProblem | null {
  if (round.status !== "active") return "finished";
  if (round.mistakes + 1 >= round.mistakeLimit) return "budget";
  for (let index = 0; index < round.solution.length; index += 1) {
    if (round.solution[index] === SOLUTION_FILLED && round.marks[index] !== MARK_FILLED) return null;
  }
  return "nothing-left";
}

/**
 * Fills in one square of the picture the player has not found yet.
 *
 * A filled square rather than an empty one: an empty square is a cross, which
 * is worth nothing on this board, and a hint that costs a mistake had better
 * be progress. Which square is picked from the round's own seed and move
 * count, so it is stable for a given board state rather than re-rolling if the
 * request is retried.
 */
export function hintNonogramCell(round: NonogramRound, now: Date): NonogramRound {
  if (nonogramHintProblem(round)) return round;

  const candidates: number[] = [];
  for (let index = 0; index < round.solution.length; index += 1) {
    if (round.solution[index] === SOLUTION_FILLED && round.marks[index] !== MARK_FILLED) {
      candidates.push(index);
    }
  }

  const pick = candidates[(round.seed + round.moves * 31) % candidates.length];
  const cells = [...round.marks];
  const changed: NonogramUndoCell[] = [{ index: pick, was: cells[pick] }];
  cells[pick] = MARK_FILLED;
  if (round.autoCross) {
    autoCrossThrough(round, nonogramClues(round.solution, round.size), cells, pick, changed);
  }

  const status: NonogramRoundStatus = isCleared(round, cells) ? "cleared" : "active";

  return {
    ...round,
    marks: cells.join(""),
    mistakes: round.mistakes + 1,
    hints: round.hints + 1,
    history: [...round.history, changed].slice(-NONOGRAM_UNDO_DEPTH),
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
  /**
   * What the drawing is of, once the round is over. Null while it is live, and
   * null afterwards too for a grown shape that is not a named thing. Redacted
   * with the solution rather than alongside it: the library is small enough
   * that "Cat" plus the clues is very nearly the answer.
   */
  title: string | null;
  mistakes: number;
  mistakeLimit: number;
  /** Squares given away by a hint. Each one already cost a mistake. */
  hints: number;
  autoCross: boolean;
  /** Whether there is a stroke to take back. The history itself never leaves the server. */
  canUndo: boolean;
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
    title: round.status === "active" ? null : round.title,
    mistakes: round.mistakes,
    mistakeLimit: round.mistakeLimit,
    hints: round.hints,
    autoCross: round.autoCross,
    canUndo: round.status === "active" && round.history.length > 0,
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
