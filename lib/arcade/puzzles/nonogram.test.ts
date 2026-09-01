import { describe, expect, it } from "vitest";
import {
  MARK_CROSSED,
  MARK_FILLED,
  MARK_UNKNOWN,
  NONOGRAM_DIFFICULTIES,
  NONOGRAM_MAX_CELLS,
  NONOGRAM_UNDO_DEPTH,
  hintNonogramCell,
  isNoGuessNonogram,
  isNonogramDifficulty,
  markNonogramCell,
  markNonogramCells,
  nonogramClues,
  nonogramConfig,
  nonogramElapsedMs,
  nonogramHintProblem,
  nonogramMarkProblem,
  nonogramUndoProblem,
  nonogramClueProgress,
  nonogramView,
  resignNonogramRound,
  satisfiedNonogramClues,
  solveNonogram,
  solveNonogramLine,
  startNonogramRound,
  undoNonogram,
  type NonogramDeal,
  type NonogramDifficulty,
  type NonogramRound,
  type NonogramRoundOptions,
} from "./nonogram";
import { dealNonogram } from "./nonogram-deal";

const NOW = new Date("2026-08-31T12:00:00.000Z");

/** A dealt round at the given rung, so every test does not restate the deal step. */
function deal(
  difficulty: NonogramDifficulty,
  seed: number,
  options?: NonogramRoundOptions,
): NonogramRound {
  return startNonogramRound(difficulty, seed, dealNonogram(seed, difficulty), options);
}

/** A round on a board written out here, for tests that need to know where the runs are. */
function handmade(rows: readonly string[], options?: NonogramRoundOptions): NonogramRound {
  const made: NonogramDeal = { solution: rows.join(""), title: "Test" };
  return { ...startNonogramRound("easy", 1, made, options), size: rows.length };
}

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

describe("dealing", () => {
  it.each(NONOGRAM_DIFFICULTIES.map((entry) => entry.id))(
    "%s deals a board line logic alone can finish",
    (difficulty) => {
      const { size } = nonogramConfig(difficulty);
      for (let seed = 0; seed < 12; seed += 1) {
        const dealt = dealNonogram(seed * 7919 + 13, difficulty);
        expect(dealt.solution).toHaveLength(size * size);
        expect(isNoGuessNonogram(dealt.solution, size)).toBe(true);
      }
    },
  );

  it("is reproducible from its seed", () => {
    expect(dealNonogram(4242, "medium")).toEqual(dealNonogram(4242, "medium"));
  });

  it("never deals a blank or completely filled picture", () => {
    for (const entry of NONOGRAM_DIFFICULTIES) {
      const dealt = dealNonogram(99, entry.id);
      expect(dealt.solution).toContain("#");
      expect(dealt.solution).toContain(".");
    }
  });

  // The reveal is the reward, and a board with no name has nothing to reveal
  // but the shape. The rungs a drawing exists for must always get one.
  it("names the drawing on every rung the library covers", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      for (let seed = 0; seed < 8; seed += 1) {
        expect(dealNonogram(seed * 101 + 3, difficulty).title).toBeTruthy();
      }
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
  const round = (options?: NonogramRoundOptions) => deal("easy", 2026, options);

  it("starts blank, with the clock unstarted", () => {
    const fresh = round();
    expect(fresh.size).toBe(5);
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
    const fresh = deal("easy", 7);
    const live = nonogramView(fresh);
    expect(live.solution).toBeNull();
    expect(JSON.stringify(live)).not.toContain(fresh.solution);

    const done = nonogramView(resignNonogramRound(fresh, NOW));
    expect(done.solution).toBe(fresh.solution);
  });

  it("carries the clues, which are the puzzle rather than the answer", () => {
    const fresh = deal("easy", 7);
    expect(nonogramView(fresh).clues).toEqual(nonogramClues(fresh.solution, 5));
  });

  it("counts squares down against squares to go", () => {
    const fresh = deal("easy", 7);
    const view = nonogramView(fresh);
    expect(view.filled).toBe(0);
    expect(view.filledTotal).toBe([...fresh.solution].filter((cell) => cell === "#").length);

    const played = markNonogramCell(fresh, fresh.solution.indexOf("#"), "fill", NOW);
    expect(nonogramView(played).filled).toBe(1);
  });
});

describe("strokes", () => {
  // A row of three filled squares with an empty one either side, so a drag can
  // run off the end of a run on purpose.
  const rows = ["..#..", ".###.", "#####", ".###.", "..#.."];

  it("puts a whole dragged run down in one call", () => {
    const fresh = handmade(rows);
    const { round, applied, aborted } = markNonogramCells(fresh, [10, 11, 12, 13, 14], "fill", NOW);
    expect(applied).toBe(5);
    expect(aborted).toBe(false);
    expect(round.marks.slice(10, 15)).toBe(MARK_FILLED.repeat(5));
    expect(round.mistakes).toBe(0);
  });

  // The reason a stroke exists rather than a loop of taps: a drag that runs
  // past the end of a run is one wrong assertion, not one per square.
  it("stops at the first wrong fill, so a bad drag costs one mistake", () => {
    const fresh = handmade(rows);
    const { round, aborted } = markNonogramCells(fresh, [5, 6, 7, 8, 9], "fill", NOW);
    expect(aborted).toBe(true);
    expect(round.mistakes).toBe(1);
    expect(round.marks[5]).toBe(MARK_CROSSED);
    // Everything past the mistake is untouched: the drag never got there.
    expect(round.marks[8]).toBe(MARK_UNKNOWN);
    expect(round.marks[9]).toBe(MARK_UNKNOWN);
  });

  it("skips squares the board refuses rather than failing the whole stroke", () => {
    const fresh = handmade(rows);
    const first = markNonogramCells(fresh, [11], "fill", NOW).round;
    // 11 is already settled; the drag runs straight over it.
    const { round, applied } = markNonogramCells(first, [11, 12, 13], "fill", NOW);
    expect(applied).toBe(2);
    expect(round.marks.slice(11, 14)).toBe(MARK_FILLED.repeat(3));
  });

  it("hands back the same round when nothing changed, so no version is burned", () => {
    const fresh = handmade(rows);
    const { round, applied } = markNonogramCells(fresh, [0, 1], "clear", NOW);
    expect(applied).toBe(0);
    expect(round).toBe(fresh);
  });

  it("counts as one undo step however many squares it covered", () => {
    const fresh = handmade(rows);
    const { round } = markNonogramCells(fresh, [0, 1, 3, 4], "cross", NOW);
    expect(round.history).toHaveLength(1);
    expect(undoNonogram(round).marks).toBe(fresh.marks);
  });
});

describe("auto-cross", () => {
  const rows = ["..#..", ".###.", "#####", ".###.", "..#.."];

  it("crosses off the rest of a line once the player's fills satisfy its clue", () => {
    const fresh = handmade(rows);
    // Row 0's clue is [1] and its filled square is index 2.
    const { round } = markNonogramCells(fresh, [2], "fill", NOW);
    expect(round.marks.slice(0, 5)).toBe("xx#xx");
  });

  it("never crosses a line that is only partly down", () => {
    const fresh = handmade(rows);
    // Row 2's clue is [5]; one square of it proves nothing about the rest.
    const { round } = markNonogramCells(fresh, [10], "fill", NOW);
    expect(round.marks.slice(11, 15)).toBe(MARK_UNKNOWN.repeat(4));
  });

  it("stays out of the way when the round was dealt with it off", () => {
    const fresh = handmade(rows, { autoCross: false });
    const { round } = markNonogramCells(fresh, [2], "fill", NOW);
    expect(round.marks.slice(0, 5)).toBe("??#??");
  });

  it("charges nothing for what it puts down", () => {
    const fresh = handmade(rows);
    const { round } = markNonogramCells(fresh, [2], "fill", NOW);
    expect(round.mistakes).toBe(0);
  });
});

describe("undo", () => {
  const rows = ["..#..", ".###.", "#####", ".###.", "..#.."];

  it("has nothing to take back on a fresh board", () => {
    expect(nonogramUndoProblem(handmade(rows))).toBe("nothing-to-undo");
  });

  it("takes back one stroke at a time, newest first", () => {
    let round = handmade(rows);
    round = markNonogramCells(round, [0], "cross", NOW).round;
    round = markNonogramCells(round, [1], "cross", NOW).round;

    const once = undoNonogram(round);
    expect(once.marks[1]).toBe(MARK_UNKNOWN);
    expect(once.marks[0]).toBe(MARK_CROSSED);
    expect(undoNonogram(once).marks[0]).toBe(MARK_UNKNOWN);
  });

  // Undoing banked work is never what the player meant, and the board has
  // already proved the square. Same rule nonogramMarkProblem states.
  it("leaves a square the board has proved filled alone", () => {
    const fresh = handmade(rows);
    const { round } = markNonogramCells(fresh, [10, 11], "fill", NOW);
    const undone = undoNonogram(round);
    expect(undone.marks[10]).toBe(MARK_FILLED);
    expect(undone.marks[11]).toBe(MARK_FILLED);
  });

  // Being wrong happened. Refunding it would make the budget meaningless.
  it("never refunds a mistake", () => {
    const fresh = handmade(rows);
    const { round } = markNonogramCells(fresh, [0], "fill", NOW);
    expect(round.mistakes).toBe(1);
    expect(undoNonogram(round).mistakes).toBe(1);
  });

  it("keeps a bounded history rather than the whole round", () => {
    let round = handmade(["#....", ".....", ".....", ".....", "....."]);
    for (let i = 0; i < NONOGRAM_UNDO_DEPTH + 8; i += 1) {
      round = markNonogramCells(round, [1 + (i % 20)], i % 2 === 0 ? "cross" : "clear", NOW).round;
    }
    expect(round.history.length).toBeLessThanOrEqual(NONOGRAM_UNDO_DEPTH);
  });

  it("refuses once the round is over", () => {
    expect(nonogramUndoProblem(resignNonogramRound(handmade(rows), NOW))).toBe("finished");
  });
});

describe("hints", () => {
  const rows = ["..#..", ".###.", "#####", ".###.", "..#.."];

  it("fills in a square of the picture, not an empty one", () => {
    const fresh = handmade(rows);
    const hinted = hintNonogramCell(fresh, NOW);
    const given = [...hinted.marks].findIndex(
      (mark, index) => mark === MARK_FILLED && fresh.marks[index] !== MARK_FILLED,
    );
    expect(given).toBeGreaterThanOrEqual(0);
    expect(fresh.solution[given]).toBe("#");
  });

  it("costs a mistake", () => {
    const hinted = hintNonogramCell(handmade(rows), NOW);
    expect(hinted.mistakes).toBe(1);
    expect(hinted.hints).toBe(1);
  });

  // A help button that ends the game is a trap, not a feature.
  it("refuses the last mistake in the budget", () => {
    let round = handmade(rows);
    // Two wrong fills on a three-mistake board leaves exactly one.
    round = markNonogramCells(round, [0], "fill", NOW).round;
    round = markNonogramCells(round, [1], "fill", NOW).round;
    expect(round.mistakes).toBe(2);
    expect(nonogramHintProblem(round)).toBe("budget");
    expect(hintNonogramCell(round, NOW)).toBe(round);
  });

  it("can finish the board, and says so", () => {
    let round = handmade(["#....", ".....", ".....", ".....", "....."]);
    round = hintNonogramCell(round, NOW);
    expect(round.status).toBe("cleared");
  });

  it("is one undo step, like any other stroke", () => {
    const round = hintNonogramCell(handmade(rows), NOW);
    expect(round.history).toHaveLength(1);
  });

  it("refuses once the round is over", () => {
    expect(nonogramHintProblem(resignNonogramRound(handmade(rows), NOW))).toBe("finished");
  });
});

describe("clue progress", () => {
  it("strikes off a run that is closed on both sides and the right length", () => {
    // x # # x ?  against a clue of [2]
    expect(satisfiedNonogramClues(["x", "#", "#", "x", "?"], [2])).toEqual([true]);
  });

  it("leaves a run alone while it could still grow", () => {
    // A run against an unknown might be longer than it looks.
    expect(satisfiedNonogramClues(["x", "#", "#", "?", "?"], [2])).toEqual([false]);
  });

  it("works in from both ends and stops at what it cannot prove", () => {
    // The first and last runs are pinned; the middle one is floating.
    const line = ["#", "x", "?", "#", "x", "#", "#"];
    expect(satisfiedNonogramClues(line, [1, 1, 2])).toEqual([true, false, true]);
  });

  it("never strikes off a run of the wrong length", () => {
    expect(satisfiedNonogramClues(["#", "#", "#", "x", "x"], [2])).toEqual([false]);
  });

  it("gives a blank line nothing to strike off", () => {
    expect(satisfiedNonogramClues(["x", "x", "x"], [])).toEqual([]);
  });

  it("reads a whole board's worth, rows and columns", () => {
    const solution = "..#...###.#####.###...#..";
    const clues = nonogramClues(solution, 5);
    const done = nonogramClueProgress("?".repeat(25), 5, clues);
    expect(done.rows).toHaveLength(5);
    expect(done.cols).toHaveLength(5);
    expect(done.rows.flat().some(Boolean)).toBe(false);

    // The finished picture accounts for every number in every line.
    const solved = [...solution].map((cell) => (cell === "#" ? MARK_FILLED : MARK_CROSSED)).join("");
    const all = nonogramClueProgress(solved, 5, clues);
    expect(all.rows.flat().every(Boolean)).toBe(true);
    expect(all.cols.flat().every(Boolean)).toBe(true);
  });
});
