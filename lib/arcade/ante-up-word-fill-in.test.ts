import { describe, expect, it } from "vitest";
import {
  GRID_SIZE,
  LARGE_GRID_SIZE,
  guessWordFillInCell,
  startWordFillInRound,
  wordFillInSlotCells,
} from "./puzzles/word-fill-in";
import {
  ANTE_UP_WORD_FILL_IN_TIERS,
  anteUpWordFillInTerms,
  anteUpWordFillInClearProblem,
  anteUpWordFillInDeadline,
  anteUpWordFillInPlaceProblem,
  clearAnteUpWordFillInSlot,
  placeAnteUpWordFillInWord,
  anteUpWordFillInGuessProblem,
  anteUpWordFillInPayout,
  guessAnteUpWordFillInCell,
  isAnteUpWordFillInTier,
  resignAnteUpWordFillIn,
  startAnteUpWordFillIn,
  tickAnteUpWordFillIn,
  toAnteUpWordFillInSnapshot,
  type AnteUpWordFillInAttempt,
} from "./ante-up-word-fill-in";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** Guesses every open cell with its real answer, in cell order. */
function solve(attempt: AnteUpWordFillInAttempt, now: Date): AnteUpWordFillInAttempt {
  let current = attempt;
  for (let i = 0; i < current.round.pattern.length; i += 1) {
    if (current.round.pattern[i] === "#") continue;
    current = guessAnteUpWordFillInCell(current, i, current.round.solution[i], now);
  }
  return current;
}

describe("isAnteUpWordFillInTier", () => {
  it("accepts only the two known tiers", () => {
    expect(isAnteUpWordFillInTier("quick")).toBe(true);
    expect(isAnteUpWordFillInTier("marathon")).toBe(true);
    expect(isAnteUpWordFillInTier("expert")).toBe(false);
    expect(isAnteUpWordFillInTier(undefined)).toBe(false);
  });
});

describe("startAnteUpWordFillIn", () => {
  it("opens an active attempt with the tier's multiplier and clock copied in", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    expect(attempt.status).toBe("active");
    expect(attempt.wager).toBe(1000);
    expect(attempt.multiplier).toBe(ANTE_UP_WORD_FILL_IN_TIERS.quick.multiplier);
    expect(attempt.timeLimitMs).toBe(ANTE_UP_WORD_FILL_IN_TIERS.quick.timeLimitMs);
    expect(attempt.startedAt).toBe(NOW.toISOString());
    // The round's own clock has not started; only guessing starts it.
    expect(attempt.round.startedAt).toBeNull();
  });
});

describe("tier grids", () => {
  it("deals Quick a regular grid and Marathon a large one", () => {
    expect(ANTE_UP_WORD_FILL_IN_TIERS.quick.grid).toBe("regular");
    expect(ANTE_UP_WORD_FILL_IN_TIERS.marathon.grid).toBe("large");
    const meta = { id: "a", version: 1 };
    const quick = startAnteUpWordFillIn("quick", 1000, 8, NOW);
    const marathon = startAnteUpWordFillIn("marathon", 1000, 8, NOW);
    expect(toAnteUpWordFillInSnapshot(quick, meta, NOW).gridSize).toBe(GRID_SIZE);
    expect(toAnteUpWordFillInSnapshot(marathon, meta, NOW).gridSize).toBe(LARGE_GRID_SIZE);
    expect(marathon.round.words.length).toBeGreaterThan(quick.round.words.length);
  });

  it("shortens Marathon's clock at each stake band and leaves Quick alone", () => {
    const clock = (wager: number) => anteUpWordFillInTerms("marathon", wager).timeLimitMs;
    expect(clock(0)).toBe(ANTE_UP_WORD_FILL_IN_TIERS.marathon.timeLimitMs);
    expect(clock(10_000)).toBe(390_000);
    expect(clock(100_000)).toBe(300_000);
    expect(clock(1_000_000)).toBe(230_000);
    expect(anteUpWordFillInTerms("quick", 1_000_000)).toBe(ANTE_UP_WORD_FILL_IN_TIERS.quick);
    expect(startAnteUpWordFillIn("marathon", 100_000, 8, NOW).timeLimitMs).toBe(300_000);
  });

  it("still reads a Marathon attempt stored on the old 9x9 grid", () => {
    const legacy: AnteUpWordFillInAttempt = {
      ...startAnteUpWordFillIn("marathon", 1000, 8, NOW),
      round: startWordFillInRound(8),
      timeLimitMs: 15 * 60 * 1000,
    };
    const snapshot = toAnteUpWordFillInSnapshot(legacy, { id: "a", version: 1 }, NOW);
    expect(snapshot.gridSize).toBe(GRID_SIZE);
    expect(snapshot.board.slots).toEqual(wordFillInSlotCells(legacy.round.templateIndex));
    expect(snapshot.timeLimitMs).toBe(15 * 60 * 1000);
    const solved = solve(legacy, NOW);
    expect(solved.status).toBe("won");
  });
});

describe("anteUpWordFillInDeadline", () => {
  it("is null until the first guess", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    expect(anteUpWordFillInDeadline(attempt)).toBeNull();
  });

  it("is the first guess plus the tier's time limit", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const index = attempt.round.pattern.indexOf(".");
    const guessed = guessAnteUpWordFillInCell(attempt, index, "A", NOW);
    expect(anteUpWordFillInDeadline(guessed)).toBe(NOW.getTime() + attempt.timeLimitMs);
  });
});

describe("tickAnteUpWordFillIn", () => {
  it("does nothing before the clock has even started", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    expect(tickAnteUpWordFillIn(attempt, new Date(NOW.getTime() + 999_999_999))).toBeNull();
  });

  it("does nothing before the deadline", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const index = attempt.round.pattern.indexOf(".");
    const guessed = guessAnteUpWordFillInCell(attempt, index, "A", NOW);
    const stillEarly = new Date(NOW.getTime() + 1000);
    expect(tickAnteUpWordFillIn(guessed, stillEarly)).toBeNull();
  });

  it("times the attempt out once the deadline passes", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const index = attempt.round.pattern.indexOf(".");
    const guessed = guessAnteUpWordFillInCell(attempt, index, "A", NOW);
    const deadline = anteUpWordFillInDeadline(guessed) as number;
    const ticked = tickAnteUpWordFillIn(guessed, new Date(deadline + 1));
    expect(ticked).not.toBeNull();
    expect(ticked?.status).toBe("timed-out");
    expect(ticked?.round.status).toBe("abandoned");
  });

  it("does nothing once the attempt is already finished", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const resigned = resignAnteUpWordFillIn(attempt, NOW);
    expect(tickAnteUpWordFillIn(resigned, new Date(NOW.getTime() + 999_999_999))).toBeNull();
  });
});

describe("anteUpWordFillInGuessProblem / guessAnteUpWordFillInCell", () => {
  it("rejects a guess once the wager clock has expired, even if the round object has not ticked", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const firstIndex = attempt.round.pattern.indexOf(".");
    const guessed = guessAnteUpWordFillInCell(attempt, firstIndex, "A", NOW);
    const deadline = anteUpWordFillInDeadline(guessed) as number;
    const pastDeadline = new Date(deadline + 1);
    const secondIndex = guessed.round.pattern.indexOf(".", firstIndex + 1);
    expect(anteUpWordFillInGuessProblem(guessed, secondIndex, "B", pastDeadline)).toBe("finished");
    const untouched = guessAnteUpWordFillInCell(guessed, secondIndex, "B", pastDeadline);
    expect(untouched).toEqual(guessed);
  });

  it("wins the attempt once every cell is solved", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const solved = solve(attempt, NOW);
    expect(solved.status).toBe("won");
    expect(solved.round.status).toBe("solved");
  });

  it("rejects any guess once the attempt has already won", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const solved = solve(attempt, NOW);
    const anyIndex = solved.round.pattern.indexOf(".");
    const after = guessAnteUpWordFillInCell(solved, anyIndex, "Q", new Date(NOW.getTime() + 1000));
    expect(after).toEqual(solved);
  });
});

describe("resignAnteUpWordFillIn", () => {
  it("forfeits an active attempt as a loss", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const resigned = resignAnteUpWordFillIn(attempt, NOW);
    expect(resigned.status).toBe("lost");
    expect(resigned.round.status).toBe("abandoned");
  });

  it("does not overwrite an attempt that already finished as a win", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const solved = solve(attempt, NOW);
    const resigned = resignAnteUpWordFillIn(solved, new Date(NOW.getTime() + 1000));
    expect(resigned).toEqual(solved);
    expect(resigned.status).toBe("won");
  });
});

describe("anteUpWordFillInPayout", () => {
  it("pays wager times multiplier only on a win", () => {
    expect(anteUpWordFillInPayout({ wager: 1000, multiplier: 1.4, status: "won" })).toBe(1400);
    expect(anteUpWordFillInPayout({ wager: 1000, multiplier: 1.4, status: "lost" })).toBe(0);
    expect(anteUpWordFillInPayout({ wager: 1000, multiplier: 1.4, status: "timed-out" })).toBe(0);
    expect(anteUpWordFillInPayout({ wager: 1000, multiplier: 1.4, status: "active" })).toBe(0);
  });

  it("rounds to the nearest whole Gold", () => {
    expect(anteUpWordFillInPayout({ wager: 777, multiplier: 1.4, status: "won" })).toBe(Math.round(777 * 1.4));
  });
});

describe("toAnteUpWordFillInSnapshot", () => {
  it("redacts the solution while active and hides no timing fields", () => {
    const attempt = startAnteUpWordFillIn("marathon", 2000, 5, NOW);
    const snapshot = toAnteUpWordFillInSnapshot(attempt, { id: "abc", version: 1 }, NOW);
    expect(snapshot.board.solution).toBeNull();
    expect(snapshot.expiresAt).toBeNull();
    expect(snapshot.msRemaining).toBeNull();
    expect(snapshot.timeLimitMs).toBe(ANTE_UP_WORD_FILL_IN_TIERS.marathon.timeLimitMs);
    expect(snapshot.payout).toBe(0);
  });

  it("reveals the solution and the payout once won", () => {
    const attempt = startAnteUpWordFillIn("marathon", 2000, 5, NOW);
    const solved = solve(attempt, NOW);
    const snapshot = toAnteUpWordFillInSnapshot(solved, { id: "abc", version: 2 }, NOW);
    expect(snapshot.board.solution).toBe(solved.round.solution);
    expect(snapshot.payout).toBe(Math.round(2000 * ANTE_UP_WORD_FILL_IN_TIERS.marathon.multiplier));
    expect(snapshot.msRemaining).toBe(0);
  });

  it("counts down msRemaining once the clock has started", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 5, NOW);
    const index = attempt.round.pattern.indexOf(".");
    const guessed = guessAnteUpWordFillInCell(attempt, index, "A", NOW);
    const later = new Date(NOW.getTime() + 1000);
    const snapshot = toAnteUpWordFillInSnapshot(guessed, { id: "abc", version: 1 }, later);
    expect(snapshot.msRemaining).toBe(guessed.timeLimitMs - 1000);
  });
});

describe("puzzles/word-fill-in re-export sanity", () => {
  it("guessWordFillInCell is usable directly on the wrapped round for solve()", () => {
    const attempt = startAnteUpWordFillIn("quick", 1000, 9, NOW);
    const index = attempt.round.pattern.indexOf(".");
    const guessed = guessWordFillInCell(attempt.round, index, "A", NOW);
    expect(guessed.moves).toBe(1);
  });
});

describe("placing and clearing words", () => {
  function answers(attempt: AnteUpWordFillInAttempt): string[] {
    return wordFillInSlotCells(attempt.round.templateIndex).map((cells) =>
      cells.map((cell) => attempt.round.solution[cell]).join(""),
    );
  }

  it("wins the attempt once every slot holds its word", () => {
    let attempt = startAnteUpWordFillIn("quick", 1000, 3, NOW);
    answers(attempt).forEach((word, slot) => {
      attempt = placeAnteUpWordFillInWord(attempt, slot, word, NOW);
    });
    expect(attempt.status).toBe("won");
    expect(anteUpWordFillInPayout(attempt)).toBe(1400);
  });

  it("refuses a placement or a clear after the wager clock ran out", () => {
    const opened = startAnteUpWordFillIn("quick", 1000, 3, NOW);
    const words = answers(opened);
    const started = placeAnteUpWordFillInWord(opened, 0, words[0], NOW);
    const late = new Date(NOW.getTime() + ANTE_UP_WORD_FILL_IN_TIERS.quick.timeLimitMs);
    expect(anteUpWordFillInPlaceProblem(started, 1, words[1], late)).toBe("finished");
    expect(anteUpWordFillInClearProblem(started, 0, late)).toBe("finished");
    expect(placeAnteUpWordFillInWord(started, 1, words[1], late)).toBe(started);
  });

  it("clears a slot without ending the attempt", () => {
    const opened = startAnteUpWordFillIn("marathon", 0, 3, NOW);
    const placed = placeAnteUpWordFillInWord(opened, 0, answers(opened)[0], NOW);
    const cleared = clearAnteUpWordFillInSlot(placed, 0, NOW);
    expect(cleared.status).toBe("active");
    expect(anteUpWordFillInClearProblem(cleared, 0, NOW)).toBe("already-empty");
  });
});
