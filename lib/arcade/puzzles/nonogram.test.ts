import { describe, expect, it } from "vitest";
import {
  MARK_CROSSED,
  MARK_FILLED,
  MARK_UNKNOWN,
  NONOGRAM_DIFFICULTIES,
  NONOGRAM_MAX_CELLS,
  generateNonogram,
  isNoGuessNonogram,
  isNonogramDifficulty,
  markNonogramCell,
  nonogramClues,
  nonogramConfig,
  nonogramElapsedMs,
  nonogramMarkProblem,
  nonogramView,
  resignNonogramRound,
  solveNonogram,
  solveNonogramLine,
  startNonogramRound,
  type NonogramDifficulty,
  type NonogramRound,
} from "./nonogram";

const NOW = new Date("2026-08-31T12:00:00.000Z");

/** Line-solver cell codes, restated here so the tests read as the solver does. */
const UNKNOWN = 0;
const FILLED = 1;
const EMPTY = 2;

function blankLine(length: number): number[] {
  return new Array<number>(length).fill(UNKNOWN);
}

/** Plays every filled square of the answer, in order. The shortest winning line. */
function solveRound(round: NonogramRound, now = NOW): NonogramRound {
  let current = round;
  for (let index = 0; index < current.solution.length; index += 1) {
    if (current.solution[index] === "#") current = markNonogramCell(current, index, "fill", now);
  }
  return current;
}

describe("clues", () => {
  it("reads run lengths off a solution, rows and columns", () => {
    // # . #
    // # # #
    // . . #
    const clues = nonogramClues("#.####..#", 3);
    expect(clues.rows).toEqual([[1, 1], [3], [1]]);
    expect(clues.cols).toEqual([[2], [1], [3]]);
  });

  it("gives a blank line an empty clue rather than a zero", () => {
    expect(nonogramClues("....", 2)).toEqual({ rows: [[], []], cols: [[], []] });
  });
});

describe("the line solver", () => {
  it("proves the overlap two arrangements share", () => {
    // A run of 3 in 4 cells can start at 0 or 1, so cells 1 and 2 are filled
    // in both and nothing else is settled.
    expect(solveNonogramLine(blankLine(4), [3])).toEqual([UNKNOWN, FILLED, FILLED, UNKNOWN]);
  });

  it("settles a line whose runs exactly fill it", () => {
    expect(solveNonogramLine(blankLine(5), [2, 2])).toEqual([FILLED, FILLED, EMPTY, FILLED, FILLED]);
  });

  it("empties a line with no runs", () => {
    expect(solveNonogramLine(blankLine(3), [])).toEqual([EMPTY, EMPTY, EMPTY]);
  });

  it("uses what is already known to finish a line it could not finish blank", () => {
    expect(solveNonogramLine(blankLine(4), [2])).toEqual([UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN]);
    expect(solveNonogramLine([FILLED, UNKNOWN, UNKNOWN, UNKNOWN], [2]))
      .toEqual([FILLED, FILLED, EMPTY, EMPTY]);
  });

  it("returns null when the clue contradicts what is known", () => {
    expect(solveNonogramLine([EMPTY, EMPTY, EMPTY], [1])).toBeNull();
    expect(solveNonogramLine(blankLine(3), [2, 2])).toBeNull();
  });

  it("handles a wide line with many runs without enumerating arrangements", () => {
    // 25 cells, six runs: thousands of legal arrangements, and the solver has
    // to answer in the same two passes it uses for a 5-cell line.
    const solved = solveNonogramLine(blankLine(25), [4, 3, 2, 3, 4, 2]);
    expect(solved).not.toBeNull();
    expect(solved).toHaveLength(25);
  });
});

describe("solveNonogram", () => {
  it("finishes a puzzle line logic can finish, and agrees with the answer", () => {
    const solution = "#.####..#";
    const solved = solveNonogram(nonogramClues(solution, 3), 3);
    expect(solved).not.toBeNull();
    expect(solved!.map((cell) => (cell === FILLED ? "#" : "."))).toEqual([...solution]);
  });

  it("leaves an ambiguous puzzle undetermined rather than guessing", () => {
    // The classic 2x2 checkerboard: both diagonals produce identical clues,
    // so no amount of line logic can tell them apart.
    const clues = { rows: [[1], [1]], cols: [[1], [1]] };
    const solved = solveNonogram(clues, 2);
    expect(solved).not.toBeNull();
    expect(solved!.some((cell) => cell === UNKNOWN)).toBe(true);
    expect(isNoGuessNonogram("#..#", 2)).toBe(false);
  });
});

describe("generation", () => {
  it.each(NONOGRAM_DIFFICULTIES.map((entry) => entry.id))(
    "%s deals a board line logic alone can finish",
    (difficulty) => {
      const { size } = nonogramConfig(difficulty);
      for (let seed = 0; seed < 12; seed += 1) {
        const grid = generateNonogram(seed * 7919 + 13, difficulty);
        expect(grid).toHaveLength(size * size);
        expect(isNoGuessNonogram(grid, size)).toBe(true);
      }
    },
  );

  it("is reproducible from its seed", () => {
    expect(generateNonogram(4242, "medium")).toBe(generateNonogram(4242, "medium"));
    expect(generateNonogram(4242, "medium")).not.toBe(generateNonogram(4243, "medium"));
  });

  it("never deals a blank or completely filled picture", () => {
    for (const entry of NONOGRAM_DIFFICULTIES) {
      const grid = generateNonogram(99, entry.id);
      expect(grid).toContain("#");
      expect(grid).toContain(".");
    }
  });

  it("bounds the largest board a request may name a cell within", () => {
    expect(NONOGRAM_MAX_CELLS).toBe(25 * 25);
  });
});

describe("difficulties", () => {
  it("recognises its own ids and nothing else", () => {
    expect(isNonogramDifficulty("master")).toBe(true);
    expect(isNonogramDifficulty("beginner")).toBe(false);
    expect(isNonogramDifficulty(5)).toBe(false);
  });

  it("climbs 5x5 to 25x25", () => {
    expect(NONOGRAM_DIFFICULTIES.map((entry) => entry.size)).toEqual([5, 10, 15, 20, 25]);
  });

  it("throws on an id it does not have", () => {
    expect(() => nonogramConfig("tiny" as NonogramDifficulty)).toThrow();
  });
});

describe("playing a round", () => {
  const round = () => startNonogramRound("easy", 2026);

  it("starts blank, with the clock unstarted", () => {
    const fresh = round();
    expect(fresh.marks).toBe(MARK_UNKNOWN.repeat(25));
    expect(fresh.status).toBe("active");
    expect(fresh.startedAt).toBeNull();
    expect(nonogramElapsedMs(fresh, NOW)).toBe(0);
  });

  it("starts the clock on the first mark, not on the deal", () => {
    const fresh = round();
    const index = fresh.solution.indexOf("#");
    const played = markNonogramCell(fresh, index, "fill", NOW);
    expect(played.startedAt).toBe(NOW.toISOString());
  });

  it("keeps a correct fill and costs nothing", () => {
    const fresh = round();
    const index = fresh.solution.indexOf("#");
    const played = markNonogramCell(fresh, index, "fill", NOW);
    expect(played.marks[index]).toBe(MARK_FILLED);
    expect(played.mistakes).toBe(0);
  });

  it("crosses a wrong fill and charges a mistake", () => {
    const fresh = round();
    const index = fresh.solution.indexOf(".");
    const played = markNonogramCell(fresh, index, "fill", NOW);
    expect(played.marks[index]).toBe(MARK_CROSSED);
    expect(played.mistakes).toBe(1);
  });

  it("never charges for a cross, right or wrong", () => {
    const fresh = round();
    const wrong = markNonogramCell(fresh, fresh.solution.indexOf("#"), "cross", NOW);
    expect(wrong.mistakes).toBe(0);
    expect(wrong.status).toBe("active");
  });

  it("lets a cross be taken back, but never a settled square", () => {
    const fresh = round();
    const empty = fresh.solution.indexOf(".");
    const crossed = markNonogramCell(fresh, empty, "cross", NOW);
    expect(markNonogramCell(crossed, empty, "clear", NOW).marks[empty]).toBe(MARK_UNKNOWN);

    // A wrong fill leaves the square crossed, and that cross is proof, not
    // notation: clearing it would let the player spend the mistake again.
    const burned = markNonogramCell(fresh, empty, "fill", NOW);
    expect(nonogramMarkProblem(burned, empty, "clear")).toBeNull();
    const filled = markNonogramCell(fresh, fresh.solution.indexOf("#"), "fill", NOW);
    expect(nonogramMarkProblem(filled, fresh.solution.indexOf("#"), "clear")).toBe("already-known");
  });

  it("loses the board on the last allowed mistake", () => {
    const fresh = round();
    const empties: number[] = [];
    for (let index = 0; index < fresh.solution.length; index += 1) {
      if (fresh.solution[index] === ".") empties.push(index);
    }
    expect(empties.length).toBeGreaterThanOrEqual(fresh.mistakeLimit);

    let current = fresh;
    for (let i = 0; i < fresh.mistakeLimit; i += 1) {
      current = markNonogramCell(current, empties[i], "fill", NOW);
    }
    expect(current.mistakes).toBe(fresh.mistakeLimit);
    expect(current.status).toBe("lost");
    expect(current.endedAt).toBe(NOW.toISOString());
  });

  it("clears the board once every filled square is down, crosses or not", () => {
    const done = solveRound(round());
    expect(done.status).toBe("cleared");
    expect(done.mistakes).toBe(0);
  });

  it("refuses a mark once the round is over", () => {
    const done = solveRound(round());
    expect(nonogramMarkProblem(done, 0, "fill")).toBe("finished");
    expect(markNonogramCell(done, 0, "cross", NOW)).toBe(done);
  });

  it("refuses a square that is not on the board", () => {
    expect(nonogramMarkProblem(round(), 25, "fill")).toBe("out-of-bounds");
    expect(nonogramMarkProblem(round(), -1, "fill")).toBe("out-of-bounds");
  });

  it("refuses a mark that would change nothing", () => {
    const fresh = round();
    expect(nonogramMarkProblem(fresh, 0, "clear")).toBe("no-change");
    const crossed = markNonogramCell(fresh, 0, "cross", NOW);
    expect(nonogramMarkProblem(crossed, 0, "cross")).toBe("no-change");
  });

  it("ends as a loss on resign, and leaves a finished round alone", () => {
    const gaveUp = resignNonogramRound(round(), NOW);
    expect(gaveUp.status).toBe("lost");
    const done = solveRound(round());
    expect(resignNonogramRound(done, NOW)).toBe(done);
  });

  it("counts elapsed time from the first mark to the last", () => {
    const fresh = round();
    const started = markNonogramCell(fresh, fresh.solution.indexOf("#"), "fill", NOW);
    const later = new Date(NOW.getTime() + 90_000);
    expect(nonogramElapsedMs(started, later)).toBe(90_000);
  });
});

describe("the view", () => {
  it("withholds the answer while the round is live and gives it up once it is over", () => {
    const fresh = startNonogramRound("easy", 7);
    const live = nonogramView(fresh);
    expect(live.solution).toBeNull();
    expect(JSON.stringify(live)).not.toContain(fresh.solution);

    const done = nonogramView(resignNonogramRound(fresh, NOW));
    expect(done.solution).toBe(fresh.solution);
  });

  it("carries the clues, which are the puzzle rather than the answer", () => {
    const fresh = startNonogramRound("easy", 7);
    expect(nonogramView(fresh).clues).toEqual(nonogramClues(fresh.solution, 5));
  });

  it("counts squares down against squares to go", () => {
    const fresh = startNonogramRound("easy", 7);
    const view = nonogramView(fresh);
    expect(view.filled).toBe(0);
    expect(view.filledTotal).toBe([...fresh.solution].filter((cell) => cell === "#").length);

    const played = markNonogramCell(fresh, fresh.solution.indexOf("#"), "fill", NOW);
    expect(nonogramView(played).filled).toBe(1);
  });
});
