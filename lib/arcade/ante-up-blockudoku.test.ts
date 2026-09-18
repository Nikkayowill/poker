import { describe, expect, it } from "vitest";

import {
  ANTE_UP_BLOCKUDOKU_TIERS,
  anteUpBlockudokuDeadline,
  anteUpBlockudokuPayout,
  anteUpBlockudokuPlacementProblem,
  isBlockudokuDifficulty,
  placeAnteUpBlockudokuPiece,
  resignAnteUpBlockudoku,
  startAnteUpBlockudoku,
  tickAnteUpBlockudoku,
  toAnteUpBlockudokuSnapshot,
  type AnteUpBlockudokuAttempt,
} from "./ante-up-blockudoku";
import { BLOCKUDOKU_SHAPES, GRID_CELLS, type BlockudokuShape } from "./puzzles/blockudoku";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const LATER = new Date("2026-09-18T12:05:00.000Z");

function shape(id: string): BlockudokuShape {
  const found = BLOCKUDOKU_SHAPES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown shape: ${id}`);
  return found;
}

function withInventory(
  attempt: AnteUpBlockudokuAttempt,
  inventory: (BlockudokuShape | null)[],
): AnteUpBlockudokuAttempt {
  return { ...attempt, board: { ...attempt.board, inventory } };
}

describe("isBlockudokuDifficulty", () => {
  it("accepts only the known tiers", () => {
    expect(isBlockudokuDifficulty("casual")).toBe(true);
    expect(isBlockudokuDifficulty("standard")).toBe(true);
    expect(isBlockudokuDifficulty("hardcore")).toBe(true);
    expect(isBlockudokuDifficulty("nightmare")).toBe(false);
    expect(isBlockudokuDifficulty(undefined)).toBe(false);
  });
});

describe("startAnteUpBlockudoku", () => {
  it("copies the tier onto the attempt and deals a fresh board", () => {
    const attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    const tier = ANTE_UP_BLOCKUDOKU_TIERS.casual;
    expect(attempt.wager).toBe(1000);
    expect(attempt.multiplier).toBe(tier.multiplier);
    expect(attempt.targetScore).toBe(tier.targetScore);
    expect(attempt.timeLimitMs).toBe(tier.timeLimitMs);
    expect(attempt.status).toBe("active");
    expect(attempt.board.status).toBe("active");
    expect(attempt.board.startedAt).toBeNull();
  });
});

describe("anteUpBlockudokuDeadline", () => {
  it("is null until the first placement starts the board's clock", () => {
    const attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    expect(anteUpBlockudokuDeadline(attempt)).toBeNull();
  });

  it("is the first placement time plus the tier's time limit", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    expect(anteUpBlockudokuDeadline(attempt)).toBe(NOW.getTime() + attempt.timeLimitMs);
  });
});

describe("placeAnteUpBlockudokuPiece", () => {
  it("wins the moment the target score is reached", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = { ...attempt, board: { ...attempt.board, score: attempt.targetScore - 1 } };
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    expect(attempt.status).toBe("won");
    expect(attempt.board.score).toBeGreaterThanOrEqual(attempt.targetScore);
  });

  it("loses if the board jams before the target score is reached", () => {
    let attempt = startAnteUpBlockudoku("hardcore", 1000, 1, NOW);
    const board = { ...attempt.board, inventory: [shape("single"), shape("domino-h"), shape("domino-v")] as (BlockudokuShape | null)[] };
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        if ((row + col) % 2 === 1) board.board[row * 9 + col] = 1;
      }
    }
    attempt = { ...attempt, board };
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    expect(attempt.status).toBe("lost");
  });

  it("rejects a placement once the attempt is no longer active", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = { ...attempt, status: "lost" };
    expect(anteUpBlockudokuPlacementProblem(attempt, 0, 0, 0, NOW)).toBe("finished");
  });

  it("rejects a placement past the deadline", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    const pastDeadline = new Date((anteUpBlockudokuDeadline(attempt) as number) + 1);
    expect(anteUpBlockudokuPlacementProblem(attempt, 0, 4, 4, pastDeadline)).toBe("finished");
  });
});

describe("tickAnteUpBlockudoku", () => {
  it("returns null while the clock has not started", () => {
    const attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    expect(tickAnteUpBlockudoku(attempt, LATER)).toBeNull();
  });

  it("returns null before the deadline", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    expect(tickAnteUpBlockudoku(attempt, new Date(NOW.getTime() + 1000))).toBeNull();
  });

  it("times the attempt out once the deadline passes without the target score", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    const deadline = anteUpBlockudokuDeadline(attempt) as number;
    const timedOut = tickAnteUpBlockudoku(attempt, new Date(deadline + 1));
    expect(timedOut?.status).toBe("timed-out");
  });

  it("is a no-op once the attempt is already settled", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = { ...attempt, status: "won" };
    expect(tickAnteUpBlockudoku(attempt, LATER)).toBeNull();
  });
});

describe("resignAnteUpBlockudoku", () => {
  it("ends an active attempt as a loss", () => {
    const attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    const resigned = resignAnteUpBlockudoku(attempt, NOW);
    expect(resigned.status).toBe("lost");
    expect(resigned.board.status).toBe("over");
  });

  it("does not touch an attempt that already settled", () => {
    const attempt = { ...startAnteUpBlockudoku("casual", 1000, 1, NOW), status: "won" as const };
    expect(resignAnteUpBlockudoku(attempt, LATER)).toBe(attempt);
  });
});

describe("anteUpBlockudokuPayout", () => {
  it("pays wager times multiplier on a win", () => {
    expect(anteUpBlockudokuPayout({ wager: 1000, multiplier: 1.2, status: "won" })).toBe(1200);
  });

  it("pays nothing on a loss or timeout", () => {
    expect(anteUpBlockudokuPayout({ wager: 1000, multiplier: 1.2, status: "lost" })).toBe(0);
    expect(anteUpBlockudokuPayout({ wager: 1000, multiplier: 1.2, status: "timed-out" })).toBe(0);
    expect(anteUpBlockudokuPayout({ wager: 1000, multiplier: 1.2, status: "active" })).toBe(0);
  });
});

describe("toAnteUpBlockudokuSnapshot", () => {
  it("redacts the board and states the payout", () => {
    let attempt = startAnteUpBlockudoku("casual", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = { ...attempt, board: { ...attempt.board, score: attempt.targetScore - 1 } };
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    const snapshot = toAnteUpBlockudokuSnapshot(attempt, { id: "abc", version: 1 }, NOW);
    expect(snapshot.status).toBe("won");
    expect(snapshot.payout).toBe(Math.round(1000 * attempt.multiplier));
    expect(snapshot.board.board).toHaveLength(GRID_CELLS);
    expect(snapshot.msRemaining).toBe(0);
  });

  it("counts down msRemaining while active", () => {
    let attempt = startAnteUpBlockudoku("standard", 1000, 1, NOW);
    attempt = withInventory(attempt, [shape("single"), null, null]);
    attempt = placeAnteUpBlockudokuPiece(attempt, 0, 0, 0, NOW);
    const snapshot = toAnteUpBlockudokuSnapshot(attempt, { id: "abc", version: 1 }, LATER);
    expect(snapshot.msRemaining).toBe(attempt.timeLimitMs - (LATER.getTime() - NOW.getTime()));
  });
});
