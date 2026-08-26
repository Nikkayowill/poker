/**
 * Minesweeper: the board rules on their own, no wager and no storage.
 *
 * Two things here are load-bearing and easy to undo by accident:
 *
 * 1. **Mines are laid on the first reveal, not when the round is dealt.** That
 *    is what makes the opening click safe (you cannot lose before you have
 *    seen a single number), and it is why `mines` is null on a fresh round.
 *    The clock starts on that same first click, the way the real game's does.
 *
 * 2. **The layout retries until the board is solvable by logic alone.** A
 *    board that ends in a 50/50 coin flip is a slot machine, and
 *    lib/arcade/ante-up-minesweeper.ts stakes real Gold on this. See
 *    `isNoGuessBoard`.
 *
 * Mine positions must never reach the browser while a round is live;
 * `minesweeperView` is the only shape that may cross the wire. Same rule,
 * same reason as lib/pvp/word-race-words.ts being server-only: a client
 * holding the answer wins every time.
 */

import { mulberry32 } from "@/lib/seeded-random";

export type MinesweeperDifficulty = "beginner" | "intermediate" | "expert";

export type MinesweeperRoundStatus = "active" | "cleared" | "lost";

/** Why a move cannot be made, or null if it can. */
export type MinesweeperMoveProblem =
  | "finished"
  | "out-of-bounds"
  | "already-open"
  | "flagged"
  | "not-open"
  | "flags-do-not-match";

export interface MinesweeperDifficultyConfig {
  readonly id: MinesweeperDifficulty;
  readonly label: string;
  readonly cols: number;
  readonly rows: number;
  readonly mines: number;
}

/**
 * Capped at 10 columns: this is a phone-first app and the classic 30-column
 * expert board is unplayable on one. The mine densities track the classic
 * ladder (12% / 17% / 21%) rather than the classic grid sizes, so "expert"
 * still means what a Minesweeper player expects it to mean.
 */
export const MINESWEEPER_DIFFICULTIES: readonly MinesweeperDifficultyConfig[] = [
  { id: "beginner", label: "Beginner", cols: 9, rows: 9, mines: 10 },
  { id: "intermediate", label: "Intermediate", cols: 9, rows: 14, mines: 22 },
  { id: "expert", label: "Expert", cols: 10, rows: 18, mines: 38 },
];

/** The largest board any difficulty deals; the outer bound a request may name a cell within. */
export const MINESWEEPER_MAX_CELLS = MINESWEEPER_DIFFICULTIES.reduce(
  (most, entry) => Math.max(most, entry.cols * entry.rows),
  0,
);

export function minesweeperConfig(id: MinesweeperDifficulty): MinesweeperDifficultyConfig {
  const found = MINESWEEPER_DIFFICULTIES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown minesweeper difficulty: ${id}`);
  return found;
}

export function isMinesweeperDifficulty(value: unknown): value is MinesweeperDifficulty {
  return MINESWEEPER_DIFFICULTIES.some((entry) => entry.id === value);
}

export interface MinesweeperRound {
  difficulty: MinesweeperDifficulty;
  cols: number;
  rows: number;
  mineCount: number;
  /** Drives the layout, so a round is reproducible from its own stored state. */
  seed: number;
  /** Null until the first reveal decides where they can safely go. */
  mines: number[] | null;
  revealed: number[];
  flags: number[];
  status: MinesweeperRoundStatus;
  /** The mine that ended it, or null. */
  explodedAt: number | null;
  /** Reveals, flags and chords: what the player actually did. */
  moves: number;
  /** Null until the first reveal; the clock starts on the first click. */
  startedAt: string | null;
  endedAt: string | null;
}

/** Cell codes in a view. 0-8 are the real adjacent-mine counts. */
export const CELL_HIDDEN = -1;
export const CELL_MINE = 9;
export const CELL_EXPLODED = 10;
export const CELL_WRONG_FLAG = 11;

export function startMinesweeperRound(
  difficulty: MinesweeperDifficulty,
  seed: number,
): MinesweeperRound {
  const config = minesweeperConfig(difficulty);
  return {
    difficulty,
    cols: config.cols,
    rows: config.rows,
    mineCount: config.mines,
    seed: seed >>> 0,
    mines: null,
    revealed: [],
    flags: [],
    status: "active",
    explodedAt: null,
    moves: 0,
    startedAt: null,
    endedAt: null,
  };
}

function neighbors(index: number, cols: number, rows: number): number[] {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      out.push(r * cols + c);
    }
  }
  return out;
}

function adjacentMines(index: number, mines: Set<number>, cols: number, rows: number): number {
  let total = 0;
  for (const n of neighbors(index, cols, rows)) {
    if (mines.has(n)) total += 1;
  }
  return total;
}

/** Lay `count` mines anywhere but `forbidden`, drawing from `random`. */
function layMines(
  total: number,
  count: number,
  forbidden: Set<number>,
  random: () => number,
): number[] {
  const pool: number[] = [];
  for (let i = 0; i < total; i += 1) {
    if (!forbidden.has(i)) pool.push(i);
  }
  // Partial Fisher-Yates: only the first `count` slots have to be settled.
  const take = Math.min(count, pool.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(random() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, take).sort((a, b) => a - b);
}

/**
 * Can this board be finished by logic alone, opening from `start`?
 *
 * Runs the three rules a person actually uses: a satisfied number frees its
 * neighbours, a number with only as many hidden cells as missing mines fills
 * them, and the subset rule that cracks 1-2-1 walls, plus the global
 * mine-count check that resolves most endgames. If it stalls with safe cells
 * still hidden, the board needs a guess and the caller lays another one.
 *
 * Exported so the tests can pin the no-guess guarantee directly, rather than
 * inferring it from how long generation took.
 */
export function isNoGuessBoard(
  mines: Set<number>,
  start: number,
  cols: number,
  rows: number,
): boolean {
  const total = cols * rows;
  const revealed = new Set<number>();
  const flagged = new Set<number>();

  const open = (index: number): void => {
    if (revealed.has(index) || mines.has(index)) return;
    const stack = [index];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      if (revealed.has(current) || mines.has(current)) continue;
      revealed.add(current);
      if (adjacentMines(current, mines, cols, rows) === 0) {
        for (const n of neighbors(current, cols, rows)) {
          if (!revealed.has(n)) stack.push(n);
        }
      }
    }
  };

  open(start);

  let progressed = true;
  while (progressed) {
    progressed = false;

    // The frontier: revealed numbers that still touch something hidden.
    const constraints: { cells: number[]; mines: number }[] = [];
    for (const index of revealed) {
      const count = adjacentMines(index, mines, cols, rows);
      const hidden: number[] = [];
      let flags = 0;
      for (const n of neighbors(index, cols, rows)) {
        if (flagged.has(n)) flags += 1;
        else if (!revealed.has(n)) hidden.push(n);
      }
      if (hidden.length === 0) continue;

      if (flags === count) {
        for (const n of hidden) open(n);
        progressed = true;
        continue;
      }
      if (hidden.length === count - flags) {
        for (const n of hidden) flagged.add(n);
        progressed = true;
        continue;
      }
      constraints.push({ cells: hidden, mines: count - flags });
    }
    if (progressed) continue;

    // Subset rule: when one constraint's cells sit wholly inside another's,
    // the difference between them is a constraint of its own.
    for (const a of constraints) {
      for (const b of constraints) {
        if (a === b || a.cells.length >= b.cells.length) continue;
        const outer = new Set(b.cells);
        if (!a.cells.every((cell) => outer.has(cell))) continue;
        const inner = new Set(a.cells);
        const rest = b.cells.filter((cell) => !inner.has(cell));
        const restMines = b.mines - a.mines;
        if (restMines === 0) {
          for (const cell of rest) open(cell);
          progressed = true;
        } else if (restMines === rest.length) {
          for (const cell of rest) flagged.add(cell);
          progressed = true;
        }
      }
      if (progressed) break;
    }
    if (progressed) continue;

    // Global count: every mine is accounted for, so whatever is left is safe,
    // and the mirror case, where every remaining hidden cell has to be a mine.
    const hiddenLeft: number[] = [];
    for (let i = 0; i < total; i += 1) {
      if (!revealed.has(i) && !flagged.has(i)) hiddenLeft.push(i);
    }
    if (hiddenLeft.length > 0) {
      const minesLeft = mines.size - flagged.size;
      if (minesLeft === 0) {
        for (const cell of hiddenLeft) open(cell);
        progressed = true;
      } else if (minesLeft === hiddenLeft.length) {
        for (const cell of hiddenLeft) flagged.add(cell);
        progressed = true;
      }
    }
  }

  return revealed.size === total - mines.size;
}

/**
 * How many layouts to try before settling for one that needs a guess. At
 * expert density most random layouts are guessy, so this is generous on
 * purpose; the solver is cheap enough (a few hundred microseconds on a
 * 180-cell board) that the whole search stays well inside a single request.
 */
const MAX_LAYOUT_ATTEMPTS = 400;

function placeMines(round: MinesweeperRound, start: number): number[] {
  const { cols, rows, mineCount } = round;
  const total = cols * rows;
  const forbidden = new Set<number>([start, ...neighbors(start, cols, rows)]);
  const random = mulberry32(round.seed);

  let last: number[] = [];
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt += 1) {
    last = layMines(total, mineCount, forbidden, random);
    if (isNoGuessBoard(new Set(last), start, cols, rows)) return last;
  }
  return last;
}

function cascade(
  round: MinesweeperRound,
  mines: Set<number>,
  from: number,
  revealed: Set<number>,
  flags: Set<number>,
): void {
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (revealed.has(current) || flags.has(current)) continue;
    revealed.add(current);
    if (adjacentMines(current, mines, round.cols, round.rows) === 0) {
      for (const n of neighbors(current, round.cols, round.rows)) {
        if (!revealed.has(n) && !flags.has(n)) stack.push(n);
      }
    }
  }
}

function settle(
  round: MinesweeperRound,
  mines: number[],
  revealed: Set<number>,
  flags: Set<number>,
  explodedAt: number | null,
  now: Date,
): MinesweeperRound {
  const total = round.cols * round.rows;
  let status: MinesweeperRoundStatus = "active";
  if (explodedAt !== null) status = "lost";
  else if (revealed.size === total - mines.length) status = "cleared";

  return {
    ...round,
    mines,
    revealed: [...revealed].sort((a, b) => a - b),
    flags: [...flags].sort((a, b) => a - b),
    status,
    explodedAt,
    moves: round.moves + 1,
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: status === "active" ? null : now.toISOString(),
  };
}

function inBounds(round: MinesweeperRound, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < round.cols * round.rows;
}

export function minesweeperRevealProblem(
  round: MinesweeperRound,
  index: number,
): MinesweeperMoveProblem | null {
  if (round.status !== "active") return "finished";
  if (!inBounds(round, index)) return "out-of-bounds";
  if (round.revealed.includes(index)) return "already-open";
  if (round.flags.includes(index)) return "flagged";
  return null;
}

export function minesweeperFlagProblem(
  round: MinesweeperRound,
  index: number,
): MinesweeperMoveProblem | null {
  if (round.status !== "active") return "finished";
  if (!inBounds(round, index)) return "out-of-bounds";
  if (round.revealed.includes(index)) return "already-open";
  return null;
}

export function minesweeperChordProblem(
  round: MinesweeperRound,
  index: number,
): MinesweeperMoveProblem | null {
  if (round.status !== "active") return "finished";
  if (!inBounds(round, index)) return "out-of-bounds";
  if (round.mines === null || !round.revealed.includes(index)) return "not-open";

  const mines = new Set(round.mines);
  const around = neighbors(index, round.cols, round.rows);
  const flags = around.filter((n) => round.flags.includes(n)).length;
  if (flags !== adjacentMines(index, mines, round.cols, round.rows)) return "flags-do-not-match";
  if (!around.some((n) => !round.flags.includes(n) && !round.revealed.includes(n))) {
    return "already-open";
  }
  return null;
}

/** Opens a cell, laying the mines first if this is the opening click. */
export function revealMinesweeperCell(
  round: MinesweeperRound,
  index: number,
  now: Date,
): MinesweeperRound {
  if (minesweeperRevealProblem(round, index)) return round;

  const mines = round.mines ?? placeMines(round, index);
  const mineSet = new Set(mines);
  const revealed = new Set(round.revealed);
  const flags = new Set(round.flags);

  if (mineSet.has(index)) {
    revealed.add(index);
    return settle(round, mines, revealed, flags, index, now);
  }

  cascade({ ...round, mines }, mineSet, index, revealed, flags);
  return settle(round, mines, revealed, flags, null, now);
}

/** Flags or unflags a hidden cell. Flagging never lays mines or starts the clock. */
export function toggleMinesweeperFlag(round: MinesweeperRound, index: number): MinesweeperRound {
  if (minesweeperFlagProblem(round, index)) return round;

  const flags = new Set(round.flags);
  if (flags.has(index)) flags.delete(index);
  else flags.add(index);

  return { ...round, flags: [...flags].sort((a, b) => a - b), moves: round.moves + 1 };
}

/**
 * Chord: tap a satisfied number to open everything still hidden around it.
 * A wrong flag makes this lose, exactly as in the real game; that risk is the
 * price of the speed, and removing it would make chording strictly free.
 */
export function chordMinesweeperCell(
  round: MinesweeperRound,
  index: number,
  now: Date,
): MinesweeperRound {
  if (minesweeperChordProblem(round, index)) return round;

  const mines = round.mines as number[];
  const mineSet = new Set(mines);
  const revealed = new Set(round.revealed);
  const flags = new Set(round.flags);

  const toOpen = neighbors(index, round.cols, round.rows).filter(
    (n) => !flags.has(n) && !revealed.has(n),
  );

  for (const n of toOpen) {
    if (mineSet.has(n)) {
      revealed.add(n);
      return settle(round, mines, revealed, flags, n, now);
    }
  }
  for (const n of toOpen) {
    cascade(round, mineSet, n, revealed, flags);
  }
  return settle(round, mines, revealed, flags, null, now);
}

/** Gives up. The round ends as a loss, with the board opened up. */
export function resignMinesweeperRound(round: MinesweeperRound, now: Date): MinesweeperRound {
  if (round.status !== "active") return round;
  return {
    ...round,
    status: "lost",
    startedAt: round.startedAt ?? now.toISOString(),
    endedAt: now.toISOString(),
  };
}

export interface MinesweeperView {
  difficulty: MinesweeperDifficulty;
  cols: number;
  rows: number;
  mineCount: number;
  status: MinesweeperRoundStatus;
  /** One code per cell, row-major. Never carries a mine position while active. */
  cells: number[];
  flags: number[];
  /** Mines minus flags placed. Goes negative if you over-flag, as the real game's does. */
  minesLeft: number;
  /**
   * The mine that ended it, or null. This is also how a caller tells a board
   * that was blown up from one that was given up on or timed out: both of
   * those settle as the same stored status, and `ante_up_attempts.status` is
   * a CHECK over exactly ('active','won','lost','timed-out'), so splitting
   * them into a new status value would pass every memory-mode test and then
   * fail against the real table. This is already public once the round is
   * over.
   */
  explodedAt: number | null;
  moves: number;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * The only shape the browser may see. While a round is active this carries
 * the counts under opened cells and nothing else; every hidden cell reads
 * the same whether or not a mine is under it. Mines appear only once it is
 * over.
 */
export function minesweeperView(round: MinesweeperRound): MinesweeperView {
  const total = round.cols * round.rows;
  const mines = new Set(round.mines ?? []);
  const revealed = new Set(round.revealed);
  const flags = new Set(round.flags);
  const over = round.status !== "active";
  const cells: number[] = [];

  for (let i = 0; i < total; i += 1) {
    if (revealed.has(i)) {
      cells.push(i === round.explodedAt ? CELL_EXPLODED : adjacentMines(i, mines, round.cols, round.rows));
      continue;
    }
    if (over && mines.has(i)) {
      cells.push(flags.has(i) ? CELL_HIDDEN : CELL_MINE);
      continue;
    }
    if (over && flags.has(i)) {
      cells.push(CELL_WRONG_FLAG);
      continue;
    }
    cells.push(CELL_HIDDEN);
  }

  // A cleared board shows every mine flagged, which is what the real game does
  // on the last click rather than making you place the final flags by hand.
  const shownFlags =
    round.status === "cleared" ? [...mines].sort((a, b) => a - b) : [...flags].sort((a, b) => a - b);

  return {
    difficulty: round.difficulty,
    cols: round.cols,
    rows: round.rows,
    mineCount: round.mineCount,
    status: round.status,
    cells,
    flags: shownFlags,
    minesLeft: round.mineCount - shownFlags.length,
    explodedAt: round.explodedAt,
    moves: round.moves,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
  };
}

/** Seconds on the clock: from the first click to the last, or to `now` while live. */
export function minesweeperElapsedMs(round: MinesweeperRound, now: Date): number {
  if (!round.startedAt) return 0;
  const end = round.endedAt ? Date.parse(round.endedAt) : now.getTime();
  return Math.max(0, end - Date.parse(round.startedAt));
}
