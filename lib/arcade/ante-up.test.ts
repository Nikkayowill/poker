import { describe, expect, it } from "vitest";
import {
  ANTE_UP_TIERS,
  anteUpFillProblem,
  anteUpPayout,
  fillAnteUpCell,
  resignAnteUpAttempt,
  startAnteUpAttempt,
  tickAnteUpAttempt,
  toAnteUpSnapshot,
} from "./ante-up";

const START = new Date("2026-08-16T12:00:00Z");

/** Fills every empty cell with its real solution, so status flips to "won". */
function solve(attempt: ReturnType<typeof startAnteUpAttempt>, now: Date) {
  let current = attempt;
  current.sudoku.puzzle.forEach((given, index) => {
    if (given !== 0) return;
    const { attempt: next } = fillAnteUpCell(current, index, current.sudoku.solution[index], now);
    current = next;
  });
  return current;
}

describe("startAnteUpAttempt", () => {
  it("copies the tier's time limit and multiplier at start", () => {
    const attempt = startAnteUpAttempt("expert", 1000, "seed-a", START);
    expect(attempt.status).toBe("active");
    expect(attempt.multiplier).toBe(ANTE_UP_TIERS.expert.multiplier);
    expect(Date.parse(attempt.expiresAt) - Date.parse(attempt.startedAt)).toBe(
      ANTE_UP_TIERS.expert.timeLimitMs,
    );
  });

  it("produces a different grid for a different seed, same day", () => {
    const a = startAnteUpAttempt("easy", 0, "seed-a", START);
    const b = startAnteUpAttempt("easy", 0, "seed-b", START);
    expect(a.sudoku.puzzle).not.toEqual(b.sudoku.puzzle);
  });
});

describe("tickAnteUpAttempt", () => {
  it("returns null before the deadline", () => {
    const attempt = startAnteUpAttempt("easy", 0, "seed", START);
    const later = new Date(START.getTime() + 60_000);
    expect(tickAnteUpAttempt(attempt, later)).toBeNull();
  });

  it("times out exactly at the deadline and never before", () => {
    const attempt = startAnteUpAttempt("expert", 0, "seed", START);
    const deadline = new Date(attempt.expiresAt);
    expect(tickAnteUpAttempt(attempt, new Date(deadline.getTime() - 1))).toBeNull();
    const timedOut = tickAnteUpAttempt(attempt, deadline);
    expect(timedOut?.status).toBe("timed-out");
  });

  it("returns null once already settled -- the tick can't livelock the poll", () => {
    const attempt = startAnteUpAttempt("easy", 0, "seed", START);
    const after = new Date(attempt.expiresAt);
    const timedOut = tickAnteUpAttempt(attempt, after)!;
    expect(tickAnteUpAttempt(timedOut, after)).toBeNull();
  });
});

describe("fillAnteUpCell", () => {
  it("writes a correct digit and counts a wrong one without ending the attempt", () => {
    const attempt = startAnteUpAttempt("easy", 0, "seed", START);
    const emptyIndex = attempt.sudoku.puzzle.findIndex((value) => value === 0);
    const right = attempt.sudoku.solution[emptyIndex];
    const wrong = (right % 9) + 1; // some other digit, still in range

    const { attempt: afterWrong, correct: wasCorrect } = fillAnteUpCell(attempt, emptyIndex, wrong, START);
    expect(wasCorrect).toBe(false);
    expect(afterWrong.sudoku.mistakes).toBe(right === wrong ? 0 : 1);
    expect(afterWrong.status).toBe("active");

    const { attempt: afterRight } = fillAnteUpCell(afterWrong, emptyIndex, right, START);
    expect(afterRight.sudoku.entries[emptyIndex]).toBe(right);
    expect(afterRight.status).toBe("active");
  });

  it("wins the moment the last cell is filled correctly", () => {
    const attempt = startAnteUpAttempt("easy", 1000, "seed", START);
    const solved = solve(attempt, START);
    expect(solved.status).toBe("won");
  });

  it("refuses a fill once the attempt is over, without touching state", () => {
    const attempt = startAnteUpAttempt("easy", 0, "seed", START);
    const timedOut = tickAnteUpAttempt(attempt, new Date(attempt.expiresAt))!;
    const emptyIndex = timedOut.sudoku.puzzle.findIndex((value) => value === 0);
    expect(anteUpFillProblem(timedOut, emptyIndex, 1)).toBe("finished");
    const { correct } = fillAnteUpCell(timedOut, emptyIndex, timedOut.sudoku.solution[emptyIndex], START);
    expect(correct).toBe(false);
  });
});

describe("resignAnteUpAttempt", () => {
  it("ends an active attempt as a loss", () => {
    const attempt = startAnteUpAttempt("easy", 500, "seed", START);
    expect(resignAnteUpAttempt(attempt).status).toBe("lost");
  });

  it("is a no-op on an attempt that already ended", () => {
    const attempt = startAnteUpAttempt("easy", 500, "seed", START);
    const timedOut = tickAnteUpAttempt(attempt, new Date(attempt.expiresAt))!;
    expect(resignAnteUpAttempt(timedOut).status).toBe("timed-out");
  });
});

describe("anteUpPayout", () => {
  it("rounds wager * multiplier to a whole Gold amount", () => {
    expect(anteUpPayout({ wager: 1000, multiplier: 2.5 })).toBe(2500);
    expect(anteUpPayout({ wager: 333, multiplier: 1.5 })).toBe(500); // 499.5 -> 500
  });

  it("pays nothing on a zero (practice) wager", () => {
    expect(anteUpPayout({ wager: 0, multiplier: 10 })).toBe(0);
  });
});

describe("toAnteUpSnapshot", () => {
  it("never carries the solution", () => {
    const attempt = startAnteUpAttempt("easy", 500, "seed", START);
    const snap = toAnteUpSnapshot(attempt, { id: "a1", version: 1 }, START) as unknown as Record<string, unknown>;
    expect(snap.solution).toBeUndefined();
    expect((snap as { sudoku?: unknown }).sudoku).toBeUndefined();
  });

  it("floors msRemaining at 0 rather than going negative", () => {
    const attempt = startAnteUpAttempt("easy", 0, "seed", START);
    const wellPast = new Date(Date.parse(attempt.expiresAt) + 60_000);
    const snap = toAnteUpSnapshot(attempt, { id: "a1", version: 1 }, wellPast);
    expect(snap.msRemaining).toBe(0);
  });

  it("states the payout as wager * multiplier", () => {
    const attempt = startAnteUpAttempt("hard", 2000, "seed", START);
    const snap = toAnteUpSnapshot(attempt, { id: "a1", version: 1 }, START);
    expect(snap.payout).toBe(2000 * ANTE_UP_TIERS.hard.multiplier);
  });
});
