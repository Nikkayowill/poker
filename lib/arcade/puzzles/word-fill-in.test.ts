import { describe, expect, it } from "vitest";
import {
  GRID_SIZE,
  TEMPLATE_COUNT,
  guessWordFillInCell,
  isWordFillInSolved,
  resignWordFillInRound,
  startWordFillInRound,
  wordFillInElapsedMs,
  wordFillInGuessProblem,
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
