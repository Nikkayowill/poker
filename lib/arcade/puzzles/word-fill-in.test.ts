import { describe, expect, it } from "vitest";
import {
  GRID_SIZE,
  LARGE_GRID_SIZE,
  LARGE_TEMPLATE_COUNT,
  TEMPLATE_COUNT,
  clearWordFillInSlot,
  guessWordFillInCell,
  isWordFillInFilledFromList,
  placeWordFillInWord,
  wordFillInClearProblem,
  wordFillInPlaceProblem,
  wordFillInSlotCells,
  isWordFillInSolved,
  resignWordFillInRound,
  startWordFillInRound,
  wordFillInElapsedMs,
  wordFillInGuessProblem,
  wordFillInTemplateSize,
  wordFillInView,
  type WordFillInRound,
} from "./word-fill-in";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

/** Guesses every open cell with its real answer, in cell order. */
function solve(round: WordFillInRound, now: Date): WordFillInRound {
  let current = round;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (current.pattern[i] === "#") continue;
    current = guessWordFillInCell(current, i, current.solution[i], now);
  }
  return current;
}

describe("startWordFillInRound", () => {
  it("produces a grid whose pattern and guesses agree on shape", () => {
    const round = startWordFillInRound(1);
    expect(round.pattern).toHaveLength(CELL_COUNT);
    expect(round.solution).toHaveLength(CELL_COUNT);
    expect(round.guesses).toHaveLength(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i += 1) {
      if (round.pattern[i] === "#") {
        expect(round.solution[i]).toBe("#");
        expect(round.guesses[i]).toBe("#");
      } else {
        expect(round.solution[i]).toMatch(/^[A-Z]$/);
        expect(round.guesses[i]).toBe("_");
      }
    }
  });

  it("picks a template within range and starts active with no clock running", () => {
    const round = startWordFillInRound(42);
    expect(round.templateIndex).toBeGreaterThanOrEqual(0);
    expect(round.templateIndex).toBeLessThan(TEMPLATE_COUNT);
    expect(round.status).toBe("active");
    expect(round.moves).toBe(0);
    expect(round.startedAt).toBeNull();
    expect(round.endedAt).toBeNull();
  });

  it("is deterministic: the same seed reproduces the same grid", () => {
    const a = startWordFillInRound(777);
    const b = startWordFillInRound(777);
    expect(a).toEqual(b);
  });

  it("never repeats a word within one puzzle", () => {
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const round = startWordFillInRound(seed);
      expect(new Set(round.words).size).toBe(round.words.length);
    }
  });

  it("generates successfully across a broad range of seeds", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(() => startWordFillInRound(seed)).not.toThrow();
    }
  });
});

describe("wordFillInGuessProblem", () => {
  const round = startWordFillInRound(5);
  const openIndex = round.pattern.indexOf(".");
  const blackIndex = round.pattern.indexOf("#");

  it("allows a valid letter on a valid open cell", () => {
    expect(wordFillInGuessProblem(round, openIndex, "a")).toBeNull();
  });

  it("rejects an out-of-bounds index", () => {
    expect(wordFillInGuessProblem(round, -1, "a")).toBe("out-of-bounds");
    expect(wordFillInGuessProblem(round, CELL_COUNT, "a")).toBe("out-of-bounds");
    expect(wordFillInGuessProblem(round, 1.5, "a")).toBe("out-of-bounds");
  });

  it("rejects a black cell", () => {
    expect(wordFillInGuessProblem(round, blackIndex, "a")).toBe("black-cell");
  });

  it("rejects anything that is not exactly one letter", () => {
    expect(wordFillInGuessProblem(round, openIndex, "")).toBe("invalid-letter");
    expect(wordFillInGuessProblem(round, openIndex, "ab")).toBe("invalid-letter");
    expect(wordFillInGuessProblem(round, openIndex, "1")).toBe("invalid-letter");
    expect(wordFillInGuessProblem(round, openIndex, "$")).toBe("invalid-letter");
  });

  it("rejects any guess once the round is finished", () => {
    const finished = resignWordFillInRound(round, NOW);
    expect(wordFillInGuessProblem(finished, openIndex, "a")).toBe("finished");
  });
});

describe("guessWordFillInCell", () => {
  it("overwrites a previous guess rather than requiring an empty cell", () => {
    const round = startWordFillInRound(9);
    const index = round.pattern.indexOf(".");
    const first = guessWordFillInCell(round, index, "Q", NOW);
    const second = guessWordFillInCell(first, index, "Z", NOW);
    expect(second.guesses[index]).toBe("Z");
  });

  it("normalizes lowercase input to uppercase", () => {
    const round = startWordFillInRound(9);
    const index = round.pattern.indexOf(".");
    const guessed = guessWordFillInCell(round, index, round.solution[index].toLowerCase(), NOW);
    expect(guessed.guesses[index]).toBe(round.solution[index]);
  });

  it("starts the clock on the first guess only", () => {
    const round = startWordFillInRound(9);
    const index = round.pattern.indexOf(".");
    const first = guessWordFillInCell(round, index, "A", NOW);
    expect(first.startedAt).toBe(NOW.toISOString());

    const later = new Date(NOW.getTime() + 60_000);
    const second = guessWordFillInCell(first, index, "B", later);
    expect(second.startedAt).toBe(NOW.toISOString());
  });

  it("does nothing for an invalid move, leaving the round unchanged", () => {
    const round = startWordFillInRound(9);
    const blackIndex = round.pattern.indexOf("#");
    const untouched = guessWordFillInCell(round, blackIndex, "A", NOW);
    expect(untouched).toEqual(round);
  });

  it("solves the round once every open cell matches the solution", () => {
    const round = startWordFillInRound(3);
    const solved = solve(round, NOW);
    expect(solved.status).toBe("solved");
    expect(solved.guesses).toBe(solved.solution);
    expect(solved.endedAt).not.toBeNull();
  });

  it("rejects further guesses once solved", () => {
    const round = startWordFillInRound(3);
    const solved = solve(round, NOW);
    const openIndex = solved.pattern.indexOf(".");
    const afterSolve = guessWordFillInCell(solved, openIndex, "Q", new Date(NOW.getTime() + 1000));
    expect(afterSolve).toEqual(solved);
  });
});

describe("isWordFillInSolved", () => {
  it("ignores black cells and requires every open cell to match", () => {
    const pattern = "#..#";
    const solution = "#AB#";
    expect(isWordFillInSolved(pattern, "#AB#", solution)).toBe(true);
    expect(isWordFillInSolved(pattern, "#A_#", solution)).toBe(false);
    expect(isWordFillInSolved(pattern, "#AZ#", solution)).toBe(false);
    // Black cells in the guess string are never compared against the solution.
    expect(isWordFillInSolved(pattern, "?AB?", solution)).toBe(true);
  });
});

describe("resignWordFillInRound", () => {
  it("ends the round without solving it", () => {
    const round = startWordFillInRound(11);
    const resigned = resignWordFillInRound(round, NOW);
    expect(resigned.status).toBe("abandoned");
    expect(resigned.startedAt).toBe(NOW.toISOString());
    expect(resigned.endedAt).toBe(NOW.toISOString());
  });

  it("is idempotent once the round is already over", () => {
    const round = startWordFillInRound(11);
    const first = resignWordFillInRound(round, NOW);
    const second = resignWordFillInRound(first, new Date(NOW.getTime() + 5000));
    expect(second).toEqual(first);
  });

  it("preserves whatever the player already typed", () => {
    const round = startWordFillInRound(11);
    const index = round.pattern.indexOf(".");
    const guessed = guessWordFillInCell(round, index, "Q", NOW);
    const resigned = resignWordFillInRound(guessed, NOW);
    expect(resigned.guesses[index]).toBe("Q");
    expect(resigned.startedAt).toBe(NOW.toISOString());
  });
});

describe("wordFillInView", () => {
  it("hides the solution while the round is active", () => {
    const round = startWordFillInRound(13);
    const view = wordFillInView(round);
    expect(view.solution).toBeNull();
    expect(view.pattern).toBe(round.pattern);
    expect(view.guesses).toBe(round.guesses);
    expect(view.words).toEqual(round.words);
  });

  it("reveals the solution once the round is solved", () => {
    const round = startWordFillInRound(13);
    const solved = solve(round, NOW);
    const view = wordFillInView(solved);
    expect(view.solution).toBe(solved.solution);
  });

  it("reveals the solution once the round is abandoned", () => {
    const round = startWordFillInRound(13);
    const resigned = resignWordFillInRound(round, NOW);
    const view = wordFillInView(resigned);
    expect(view.solution).toBe(resigned.solution);
  });
});

describe("wordFillInElapsedMs", () => {
  it("is zero before the first guess", () => {
    const round = startWordFillInRound(2);
    expect(wordFillInElapsedMs(round, NOW)).toBe(0);
  });

  it("measures from the first guess to now while active", () => {
    const round = startWordFillInRound(2);
    const index = round.pattern.indexOf(".");
    const guessed = guessWordFillInCell(round, index, "A", NOW);
    const later = new Date(NOW.getTime() + 30_000);
    expect(wordFillInElapsedMs(guessed, later)).toBe(30_000);
  });

  it("freezes once the round ends", () => {
    const round = startWordFillInRound(2);
    const index = round.pattern.indexOf(".");
    const guessed = guessWordFillInCell(round, index, "A", NOW);
    const resigned = resignWordFillInRound(guessed, new Date(NOW.getTime() + 10_000));
    const muchLater = new Date(NOW.getTime() + 999_999);
    expect(wordFillInElapsedMs(resigned, muchLater)).toBe(10_000);
  });
});

/** The word the stored solution puts in each slot. */
function answers(round: WordFillInRound): string[] {
  return wordFillInSlotCells(round.templateIndex).map((cells) =>
    cells.map((cell) => round.solution[cell]).join(""),
  );
}

describe("wordFillInSlotCells", () => {
  it("covers exactly the open cells of every template, one slot per word", () => {
    for (let seed = 0; seed < TEMPLATE_COUNT; seed += 1) {
      const round = startWordFillInRound(seed);
      const slots = wordFillInSlotCells(round.templateIndex);
      expect(slots).toHaveLength(round.words.length);
      const covered = new Set(slots.flat());
      for (let i = 0; i < CELL_COUNT; i += 1) {
        expect(covered.has(i)).toBe(round.pattern[i] === ".");
      }
    }
  });

  it("is sent in the view, which still carries no letters while live", () => {
    const round = startWordFillInRound(4);
    const view = wordFillInView(round);
    expect(view.slots).toEqual(wordFillInSlotCells(round.templateIndex));
    expect(view.solution).toBeNull();
  });
});

describe("placeWordFillInWord", () => {
  it("writes the word into the slot and starts the clock", () => {
    const round = startWordFillInRound(9);
    const word = answers(round)[0];
    const placed = placeWordFillInWord(round, 0, word, NOW);
    const cells = wordFillInSlotCells(round.templateIndex)[0];
    expect(cells.map((cell) => placed.guesses[cell]).join("")).toBe(word);
    expect(placed.startedAt).toBe(NOW.toISOString());
    expect(placed.moves).toBe(1);
  });

  it("refuses a word not in the list, a wrong length, a bad slot and a no-op", () => {
    const round = startWordFillInRound(9);
    const slots = wordFillInSlotCells(round.templateIndex);
    const word = answers(round)[0];
    expect(wordFillInPlaceProblem(round, 0, "ZZZZZZZZZ".slice(0, slots[0].length))).toBe("not-in-list");
    const otherLength = round.words.find((w) => w.length !== slots[0].length) as string;
    expect(wordFillInPlaceProblem(round, 0, otherLength)).toBe("wrong-length");
    expect(wordFillInPlaceProblem(round, slots.length, word)).toBe("no-slot");
    expect(wordFillInPlaceProblem(round, -1, word)).toBe("no-slot");
    const placed = placeWordFillInWord(round, 0, word, NOW);
    expect(wordFillInPlaceProblem(placed, 0, word)).toBe("no-change");
    expect(placeWordFillInWord(round, 0, "NOPE", NOW)).toBe(round);
  });

  it("moves a word that is already in another slot instead of repeating it", () => {
    const round = startWordFillInRound(2);
    const slots = wordFillInSlotCells(round.templateIndex);
    const words = answers(round);
    // Two slots of the same length, so one word fits both.
    const a = slots.findIndex((cells, i) => slots.some((other, j) => j !== i && other.length === cells.length));
    const b = slots.findIndex((cells, j) => j !== a && cells.length === slots[a].length);
    const first = placeWordFillInWord(round, a, words[a], NOW);
    const moved = placeWordFillInWord(first, b, words[a], NOW);
    const spelled = (cells: number[]) => cells.map((cell) => moved.guesses[cell]).join("");
    expect(spelled(slots[b])).toBe(words[a]);
    expect(spelled(slots[a])).not.toBe(words[a]);
  });

  it("solves once every slot holds its word, and reveals nothing early", () => {
    const round = startWordFillInRound(11);
    const words = answers(round);
    let current = round;
    words.forEach((word, slot) => {
      expect(current.status).toBe("active");
      current = placeWordFillInWord(current, slot, word, NOW);
    });
    expect(current.status).toBe("solved");
    expect(current.endedAt).toBe(NOW.toISOString());
    expect(isWordFillInFilledFromList(current, current.guesses)).toBe(true);
    expect(wordFillInPlaceProblem(current, 0, words[0])).toBe("finished");
  });
});

describe("clearWordFillInSlot", () => {
  it("empties a slot but keeps a crossing letter another filled slot uses", () => {
    const round = startWordFillInRound(5);
    const slots = wordFillInSlotCells(round.templateIndex);
    const words = answers(round);
    // Find two crossing slots.
    let a = -1;
    let b = -1;
    let shared = -1;
    slots.forEach((cells, i) => {
      slots.forEach((other, j) => {
        if (a !== -1 || i === j) return;
        const cross = cells.find((cell) => other.includes(cell));
        if (cross !== undefined) { a = i; b = j; shared = cross; }
      });
    });
    let current = placeWordFillInWord(round, a, words[a], NOW);
    current = placeWordFillInWord(current, b, words[b], NOW);
    const cleared = clearWordFillInSlot(current, a, NOW);
    expect(cleared.guesses[shared]).toBe(round.solution[shared]);
    for (const cell of slots[a]) {
      if (!slots[b].includes(cell)) expect(cleared.guesses[cell]).toBe("_");
    }
    expect(cleared.moves).toBe(current.moves + 1);
  });

  it("refuses to clear an empty slot, so clearing cannot start the clock", () => {
    const round = startWordFillInRound(5);
    expect(wordFillInClearProblem(round, 0)).toBe("already-empty");
    expect(clearWordFillInSlot(round, 0, NOW)).toBe(round);
    expect(round.startedAt).toBeNull();
  });
});

describe("large grids", () => {
  it("deals an 11x11 grid from the large templates", () => {
    const round = startWordFillInRound(1, "large");
    expect(round.templateIndex).toBeGreaterThanOrEqual(TEMPLATE_COUNT);
    expect(round.templateIndex).toBeLessThan(TEMPLATE_COUNT + LARGE_TEMPLATE_COUNT);
    expect(wordFillInTemplateSize(round.templateIndex)).toBe(LARGE_GRID_SIZE);
    expect(round.pattern).toHaveLength(LARGE_GRID_SIZE * LARGE_GRID_SIZE);
    expect(round.solution).toHaveLength(LARGE_GRID_SIZE * LARGE_GRID_SIZE);
    expect(round.guesses).toHaveLength(LARGE_GRID_SIZE * LARGE_GRID_SIZE);
  });

  it("is a bigger puzzle than any regular grid: more words, and more crossings", () => {
    const crossings = (templateIndex: number) => {
      const seen = new Map<number, number>();
      for (const cells of wordFillInSlotCells(templateIndex)) for (const cell of cells) seen.set(cell, (seen.get(cell) ?? 0) + 1);
      return [...seen.values()].filter((count) => count > 1).length;
    };
    const regularMax = Math.max(...Array.from({ length: TEMPLATE_COUNT }, (_, i) => wordFillInSlotCells(i).length));
    const regularCrossings = Math.max(...Array.from({ length: TEMPLATE_COUNT }, (_, i) => crossings(i)));
    for (let i = TEMPLATE_COUNT; i < TEMPLATE_COUNT + LARGE_TEMPLATE_COUNT; i += 1) {
      expect(wordFillInSlotCells(i).length).toBeGreaterThan(regularMax);
      expect(crossings(i)).toBeGreaterThan(regularCrossings);
    }
  });

  it("fills every large template, not just a fallback, across many seeds", () => {
    for (let seed = 0; seed < 80; seed += 1) {
      const round = startWordFillInRound(seed, "large");
      // Seeds walk the templates in turn; landing on the intended one means it filled first try.
      expect(round.templateIndex).toBe(TEMPLATE_COUNT + (seed % LARGE_TEMPLATE_COUNT));
      expect(new Set(round.words).size).toBe(round.words.length);
      const slots = wordFillInSlotCells(round.templateIndex);
      expect(slots).toHaveLength(round.words.length);
      const covered = new Set(slots.flat());
      for (let i = 0; i < round.pattern.length; i += 1) expect(covered.has(i)).toBe(round.pattern[i] === ".");
    }
  });

  it("keeps the regular pool to the regular templates", () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const round = startWordFillInRound(seed);
      expect(round.templateIndex).toBeLessThan(TEMPLATE_COUNT);
      expect(round.pattern).toHaveLength(GRID_SIZE * GRID_SIZE);
    }
  });

  it("bounds guesses by the round's own grid", () => {
    const round = startWordFillInRound(3, "large");
    const lastOpen = round.pattern.lastIndexOf(".");
    expect(lastOpen).toBeGreaterThanOrEqual(CELL_COUNT);
    expect(wordFillInGuessProblem(round, lastOpen, "a")).toBeNull();
    expect(wordFillInGuessProblem(round, round.pattern.length, "a")).toBe("out-of-bounds");
  });

  it("solves by placing every listed word, and reports its size in the view", () => {
    let round = startWordFillInRound(21, "large");
    expect(wordFillInView(round).size).toBe(LARGE_GRID_SIZE);
    answers(round).forEach((word, slot) => {
      round = placeWordFillInWord(round, slot, word, NOW);
    });
    expect(round.status).toBe("solved");
  });

  it("reads a round stored before large grids existed as 9x9", () => {
    for (let i = 0; i < TEMPLATE_COUNT; i += 1) expect(wordFillInTemplateSize(i)).toBe(GRID_SIZE);
    expect(wordFillInView(startWordFillInRound(2)).size).toBe(GRID_SIZE);
  });
});
