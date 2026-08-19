import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_CLUES,
  SUDOKU_CELLS,
  SUDOKU_DIFFICULTIES,
  SUDOKU_SIZE,
  boxOf,
  carvePuzzle,
  columnOf,
  countSolutions,
  fillSudokuCell,
  formatDuration,
  generateSudoku,
  hasUniqueSolution,
  isEditable,
  isPlacementLegal,
  isSudokuDifficulty,
  rowOf,
  solvedGrid,
  startSudokuRound,
  sudokuElapsedMs,
  sudokuFillProblem,
  toSudokuSnapshot,
  type SudokuDifficulty,
} from "./sudoku";

const START = new Date("2026-08-06T12:00:00Z");

/** Every row, column and box holds 1..9 exactly once. */
function isCompleteAndValid(grid: readonly number[]): boolean {
  if (grid.length !== SUDOKU_CELLS || grid.some((value) => value < 1 || value > 9)) return false;
  const groups = [rowOf, columnOf, boxOf].map((of) => {
    const buckets = Array.from({ length: SUDOKU_SIZE }, () => new Set<number>());
    grid.forEach((value, index) => buckets[of(index)].add(value));
    return buckets;
  });
  return groups.every((buckets) => buckets.every((set) => set.size === SUDOKU_SIZE));
}

describe("grid coordinates", () => {
  it("maps an index to its row, column and box", () => {
    expect([rowOf(0), columnOf(0), boxOf(0)]).toEqual([0, 0, 0]);
    expect([rowOf(80), columnOf(80), boxOf(80)]).toEqual([8, 8, 8]);
    expect([rowOf(30), columnOf(30), boxOf(30)]).toEqual([3, 3, 4]);
    expect(boxOf(8)).toBe(2);
    expect(boxOf(72)).toBe(6);
  });
});

describe("isPlacementLegal", () => {
  it("refuses a clash in the row, the column or the box", () => {
    const grid = new Array<number>(SUDOKU_CELLS).fill(0);
    grid[0] = 5;
    expect(isPlacementLegal(grid, 1, 5)).toBe(false); // same row
    expect(isPlacementLegal(grid, 9, 5)).toBe(false); // same column
    expect(isPlacementLegal(grid, 10, 5)).toBe(false); // same box
    // Row 4, column 4, box 4 -- shares none of the three groups with cell 0.
    expect(isPlacementLegal(grid, 40, 5)).toBe(true);
  });

  it("ignores the cell itself, so a value already in place is legal where it is", () => {
    const grid = new Array<number>(SUDOKU_CELLS).fill(0);
    grid[0] = 5;
    expect(isPlacementLegal(grid, 0, 5)).toBe(true);
  });
});

describe("solvedGrid", () => {
  it("is always complete and valid", () => {
    for (let seed = 0; seed < 25; seed += 1) {
      let state = seed * 2654435761;
      const random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
      expect(isCompleteAndValid(solvedGrid(random))).toBe(true);
    }
  });
});

describe("countSolutions", () => {
  it("finds exactly one for a complete grid", () => {
    const { solution } = generateSudoku("2026-01-01", "easy");
    expect(countSolutions(solution)).toBe(1);
  });

  it("finds none when the grid is already contradictory", () => {
    const grid = new Array<number>(SUDOKU_CELLS).fill(0);
    grid[0] = 5;
    grid[1] = 5;
    expect(countSolutions(grid)).toBe(0);
  });

  it("caps its count rather than enumerating billions", () => {
    // An empty grid has ~6.67e21 solutions. This must return promptly.
    expect(countSolutions(new Array<number>(SUDOKU_CELLS).fill(0), 2)).toBe(2);
  });
});

describe("carvePuzzle", () => {
  it("only ever removes a clue while the answer stays unique", () => {
    const { puzzle, solution } = generateSudoku("2026-03-04", "medium");
    expect(hasUniqueSolution(puzzle)).toBe(true);
    // And the unique answer is the one it was carved from.
    expect(countSolutions(puzzle)).toBe(1);
    puzzle.forEach((cell, index) => {
      if (cell !== 0) expect(cell).toBe(solution[index]);
    });
  });

  it("never carves below the target", () => {
    const solution = generateSudoku("2026-03-04", "easy").solution;
    let state = 12345;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const puzzle = carvePuzzle(solution, 60, random);
    expect(puzzle.filter((cell) => cell !== 0).length).toBeGreaterThanOrEqual(60);
  });
});

describe("generateSudoku", () => {
  it("is deterministic -- the same day and difficulty is the same board", () => {
    // The whole basis of a shared daily. If this drifted, two players would
    // not be solving the same puzzle and the share text would be a lie.
    const first = generateSudoku("2026-08-06", "hard");
    const second = generateSudoku("2026-08-06", "hard");
    expect(first.puzzle).toEqual(second.puzzle);
    expect(first.solution).toEqual(second.solution);
  });

  it("gives different days different boards", () => {
    expect(generateSudoku("2026-08-06", "hard").puzzle).not.toEqual(
      generateSudoku("2026-08-07", "hard").puzzle,
    );
  });

  it("gives the four difficulties genuinely different boards", () => {
    // Salted per difficulty, so solving the easy grid hands nobody the expert
    // one -- the same separation daily.ts gives Word Stack and Connections.
    const boards = SUDOKU_DIFFICULTIES.map((difficulty) => generateSudoku("2026-08-06", difficulty));
    for (let a = 0; a < boards.length; a += 1) {
      for (let b = a + 1; b < boards.length; b += 1) {
        expect(boards[a].solution).not.toEqual(boards[b].solution);
      }
    }
  });

  it("produces a solvable, uniquely-solvable board at every difficulty", () => {
    for (const difficulty of SUDOKU_DIFFICULTIES) {
      const { puzzle, solution } = generateSudoku("2026-08-06", difficulty);
      expect(isCompleteAndValid(solution)).toBe(true);
      expect(hasUniqueSolution(puzzle)).toBe(true);
    }
  });

  it("leaves harder grids with fewer clues, and never near the 17 minimum", () => {
    const clues = SUDOKU_DIFFICULTIES.map(
      (difficulty) => generateSudoku("2026-08-06", difficulty).puzzle.filter((cell) => cell !== 0).length,
    );
    // Monotone: easy has the most, expert the fewest.
    for (let index = 1; index < clues.length; index += 1) {
      expect(clues[index]).toBeLessThanOrEqual(clues[index - 1]);
    }
    // 17 is the proven minimum for a unique sudoku; a board near it is a
    // guessing exercise rather than a harder puzzle.
    for (const count of clues) expect(count).toBeGreaterThan(17);
  });

  it("hits close to each difficulty's clue target", () => {
    for (const difficulty of SUDOKU_DIFFICULTIES) {
      const clues = generateSudoku("2026-08-06", difficulty).puzzle.filter((cell) => cell !== 0).length;
      // Carving stops early when nothing more can come out uniquely, so this
      // is a floor plus slack rather than an equality.
      expect(clues).toBeGreaterThanOrEqual(DIFFICULTY_CLUES[difficulty]);
      expect(clues).toBeLessThan(DIFFICULTY_CLUES[difficulty] + 12);
    }
  });
});

describe("isSudokuDifficulty", () => {
  it("accepts the four and nothing else", () => {
    for (const difficulty of SUDOKU_DIFFICULTIES) expect(isSudokuDifficulty(difficulty)).toBe(true);
    expect(isSudokuDifficulty("impossible")).toBe(false);
  });
});

describe("fillSudokuCell", () => {
  const round = () => startSudokuRound(generateSudoku("2026-08-06", "easy"), "easy", START);
  const firstEmpty = (grid: readonly number[]) => grid.findIndex((cell) => cell === 0);

  it("writes a correct digit", () => {
    const start = round();
    const index = firstEmpty(start.puzzle);
    const { round: next, correct } = fillSudokuCell(start, index, start.solution[index], START);
    expect(correct).toBe(true);
    expect(next.entries[index]).toBe(start.solution[index]);
    expect(next.mistakes).toBe(0);
  });

  it("refuses a wrong digit, counts it, and does not write it", () => {
    const start = round();
    const index = firstEmpty(start.puzzle);
    const wrong = (start.solution[index] % 9) + 1;
    const { round: next, correct } = fillSudokuCell(start, index, wrong, START);
    expect(correct).toBe(false);
    expect(next.entries[index]).toBe(0);
    expect(next.mistakes).toBe(1);
  });

  it("never lets a given be overwritten", () => {
    const start = round();
    const given = start.puzzle.findIndex((cell) => cell !== 0);
    expect(isEditable(start, given)).toBe(false);
    expect(sudokuFillProblem(start, given, 5)).toBe("not-editable");
    expect(fillSudokuCell(start, given, 5, START).round).toBe(start);
  });

  it("erases without counting a mistake", () => {
    // Rubbing out your own guess is not an error and must never be scored as one.
    const start = round();
    const index = firstEmpty(start.puzzle);
    const filled = fillSudokuCell(start, index, start.solution[index], START).round;
    const erased = fillSudokuCell(filled, index, 0, START);
    expect(erased.correct).toBe(true);
    expect(erased.round.entries[index]).toBe(0);
    expect(erased.round.mistakes).toBe(0);
  });

  it("refuses an index or a digit off the board", () => {
    const start = round();
    expect(sudokuFillProblem(start, -1, 5)).toBe("not-editable");
    expect(sudokuFillProblem(start, SUDOKU_CELLS, 5)).toBe("not-editable");
    expect(sudokuFillProblem(start, firstEmpty(start.puzzle), 10)).toBe("out-of-range");
    expect(sudokuFillProblem(start, firstEmpty(start.puzzle), -1)).toBe("out-of-range");
  });

  it("solves the board when the last cell is filled, and stamps the clock", () => {
    let current = round();
    for (let index = 0; index < SUDOKU_CELLS; index += 1) {
      if (current.puzzle[index] !== 0) continue;
      current = fillSudokuCell(current, index, current.solution[index], START).round;
    }
    expect(current.status).toBe("solved");
    expect(current.finishedAt).toBe(START.toISOString());
  });

  it("is inert once solved", () => {
    let current = round();
    for (let index = 0; index < SUDOKU_CELLS; index += 1) {
      if (current.puzzle[index] !== 0) continue;
      current = fillSudokuCell(current, index, current.solution[index], START).round;
    }
    expect(sudokuFillProblem(current, 0, 1)).toBe("finished");
    expect(fillSudokuCell(current, 0, 1, START).round).toBe(current);
  });

  it("does not mutate the round it was given", () => {
    const start = round();
    const index = firstEmpty(start.puzzle);
    fillSudokuCell(start, index, start.solution[index], START);
    expect(start.entries[index]).toBe(0);
  });
});

describe("the clock", () => {
  it("reports nothing while the puzzle is running and a duration once it is done", () => {
    const start = startSudokuRound(generateSudoku("2026-08-06", "easy"), "easy", START);
    expect(sudokuElapsedMs(start)).toBeNull();
    expect(
      sudokuElapsedMs({ startedAt: START.toISOString(), finishedAt: new Date(START.getTime() + 724_000).toISOString() }),
    ).toBe(724_000);
  });

  it("never reports a negative duration", () => {
    expect(
      sudokuElapsedMs({ startedAt: START.toISOString(), finishedAt: new Date(START.getTime() - 5000).toISOString() }),
    ).toBe(0);
  });

  it("formats as minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(724_000)).toBe("12:04");
  });
});

describe("toSudokuSnapshot", () => {
  it("has no solution field at all", () => {
    const round = startSudokuRound(generateSudoku("2026-08-06", "hard"), "hard", START);
    const snapshot = toSudokuSnapshot(round, { day: "2026-08-06", puzzleNumber: 218, version: 1 });
    // Not blanked -- absent. With the solution, the puzzle is a formality and
    // the shared result is worthless.
    expect("solution" in snapshot).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('"solution"');
  });

  it("carries the clue count and the difficulty the board was cut at", () => {
    const round = startSudokuRound(generateSudoku("2026-08-06", "expert"), "expert", START);
    const snapshot = toSudokuSnapshot(round, { day: "2026-08-06", puzzleNumber: 218, version: 1 });
    expect(snapshot.difficulty).toBe("expert");
    expect(snapshot.clues).toBe(round.puzzle.filter((cell) => cell !== 0).length);
  });

  it("copies the grids, so a caller cannot reach back into the round", () => {
    const round = startSudokuRound(generateSudoku("2026-08-06", "easy"), "easy", START);
    const snapshot = toSudokuSnapshot(round, { day: "2026-08-06", puzzleNumber: 1, version: 1 });
    snapshot.puzzle[0] = 9;
    snapshot.entries[0] = 9;
    expect(round.entries[0]).toBe(0);
  });
});

describe("difficulty coverage", () => {
  it("has a clue target for every difficulty", () => {
    for (const difficulty of SUDOKU_DIFFICULTIES) {
      expect(DIFFICULTY_CLUES[difficulty as SudokuDifficulty]).toBeGreaterThan(17);
    }
  });
});
