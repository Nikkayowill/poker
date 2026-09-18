import { describe, expect, it } from "vitest";

import {
  BLOCKUDOKU_SHAPES,
  GRID_CELLS,
  GRID_SIDE,
  INVENTORY_SIZE,
  blockudokuElapsedMs,
  blockudokuPlacementProblem,
  blockudokuView,
  placeBlockudokuPiece,
  resignBlockudokuRound,
  startBlockudokuRound,
  type BlockudokuRound,
  type BlockudokuShape,
} from "./blockudoku";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const LATER = new Date("2026-09-18T12:05:00.000Z");

function shape(id: string): BlockudokuShape {
  const found = BLOCKUDOKU_SHAPES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown shape: ${id}`);
  return found;
}

/** A blank round with a hand-picked inventory, for tests that need exact control over what's playable. */
function withInventory(inventory: (BlockudokuShape | null)[]): BlockudokuRound {
  return {
    board: new Array(GRID_CELLS).fill(0),
    inventory,
    score: 0,
    status: "active",
    rngState: 0,
    moves: 0,
    startedAt: null,
    endedAt: null,
  };
}

describe("startBlockudokuRound", () => {
  it("deals an empty board and a full 3-piece inventory", () => {
    const round = startBlockudokuRound(1);
    expect(round.board).toHaveLength(GRID_CELLS);
    expect(round.board.every((cell) => cell === 0)).toBe(true);
    expect(round.inventory).toHaveLength(INVENTORY_SIZE);
    expect(round.inventory.every((piece) => piece !== null)).toBe(true);
    expect(round.status).toBe("active");
    expect(round.score).toBe(0);
    expect(round.startedAt).toBeNull();
  });

  it("is fully determined by its seed", () => {
    const a = startBlockudokuRound(42);
    const b = startBlockudokuRound(42);
    expect(a.inventory.map((p) => p?.id)).toEqual(b.inventory.map((p) => p?.id));
    expect(a.rngState).toBe(b.rngState);
  });

  it("draws a different inventory for a different seed (not guaranteed, but true for these two)", () => {
    const a = startBlockudokuRound(1);
    const b = startBlockudokuRound(2);
    expect(a.inventory.map((p) => p?.id)).not.toEqual(b.inventory.map((p) => p?.id));
  });
});

describe("blockudokuPlacementProblem", () => {
  it("rejects a slot index out of range", () => {
    const round = withInventory([shape("single"), null, null]);
    expect(blockudokuPlacementProblem(round, -1, 0, 0)).toBe("invalid-slot");
    expect(blockudokuPlacementProblem(round, 3, 0, 0)).toBe("invalid-slot");
  });

  it("rejects an already-played slot", () => {
    const round = withInventory([null, shape("single"), null]);
    expect(blockudokuPlacementProblem(round, 0, 0, 0)).toBe("empty-slot");
  });

  it("rejects a placement that falls off the grid", () => {
    const round = withInventory([shape("tetromino-i-h"), null, null]);
    expect(blockudokuPlacementProblem(round, 0, 0, 7)).toBe("out-of-bounds");
    expect(blockudokuPlacementProblem(round, 0, -1, 0)).toBe("out-of-bounds");
  });

  it("rejects a placement over an occupied cell", () => {
    const round = withInventory([shape("single"), null, null]);
    round.board[0] = 1;
    expect(blockudokuPlacementProblem(round, 0, 0, 0)).toBe("occupied");
  });

  it("rejects any placement once the round is over", () => {
    const round = { ...withInventory([shape("single"), null, null]), status: "over" as const };
    expect(blockudokuPlacementProblem(round, 0, 0, 0)).toBe("finished");
  });

  it("accepts a legal placement", () => {
    const round = withInventory([shape("single"), null, null]);
    expect(blockudokuPlacementProblem(round, 0, 4, 4)).toBeNull();
  });
});

describe("placeBlockudokuPiece", () => {
  it("occupies the target cells and scores one point per cell", () => {
    const round = withInventory([shape("domino-h"), shape("single"), null]);
    const next = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    expect(next.board[0]).toBe(1);
    expect(next.board[1]).toBe(1);
    expect(next.score).toBe(2);
    expect(next.inventory[0]).toBeNull();
    expect(next.moves).toBe(1);
    expect(next.startedAt).toBe(NOW.toISOString());
  });

  it("is a no-op for an illegal placement", () => {
    const round = withInventory([shape("single"), null, null]);
    round.board[5] = 1;
    const next = placeBlockudokuPiece(round, 0, 0, 5, NOW);
    expect(next).toBe(round);
  });

  it("clears a full row and awards the clear bonus", () => {
    const round = withInventory([shape("single"), null, null]);
    for (let col = 1; col < GRID_SIDE; col += 1) round.board[col] = 1;
    const next = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    for (let col = 0; col < GRID_SIDE; col += 1) expect(next.board[col]).toBe(0);
    // 1 placement point + 18 for a single-line clear.
    expect(next.score).toBe(19);
  });

  it("clears a full 3x3 region", () => {
    const round = withInventory([shape("single"), null, null]);
    const regionCells = [0, 1, 2, 9, 10, 11, 18, 19, 20];
    for (const index of regionCells.slice(1)) round.board[index] = 1;
    const next = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    for (const index of regionCells) expect(next.board[index]).toBe(0);
    expect(next.score).toBe(19);
  });

  it("scores a double clear with the escalating bonus, not two singles", () => {
    // Row 0 is full except (0,0); column 0 is full except (0,0). Placing a
    // single at (0,0) closes both at once.
    const round = withInventory([shape("single"), null, null]);
    for (let col = 1; col < GRID_SIDE; col += 1) round.board[col] = 1;
    for (let row = 1; row < GRID_SIDE; row += 1) round.board[row * GRID_SIDE] = 1;
    const next = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    // 1 placement point + 54 for a two-line clear (18*2*3/2), not 1 + 36.
    expect(next.score).toBe(55);
    expect(next.board.every((cell) => cell === 0)).toBe(true);
  });

  it("refills all three slots at once once the inventory is exhausted", () => {
    const round = withInventory([shape("single"), shape("single"), shape("single")]);
    const first = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    expect(first.inventory[0]).toBeNull();
    expect(first.inventory[1]).not.toBeNull();
    const second = placeBlockudokuPiece(first, 1, 0, 1, NOW);
    expect(second.inventory[1]).toBeNull();
    const third = placeBlockudokuPiece(second, 2, 0, 2, NOW);
    expect(third.inventory.every((piece) => piece !== null)).toBe(true);
    expect(third.rngState).not.toBe(round.rngState);
  });

  it("ends the round when nothing in the inventory can be placed anywhere", () => {
    // Checkerboard: fill every cell where (row+col) is odd, leaving isolated
    // empty cells nothing bigger than a single block can ever reach.
    const round = withInventory([shape("single"), shape("domino-h"), shape("domino-v")]);
    for (let row = 0; row < GRID_SIDE; row += 1) {
      for (let col = 0; col < GRID_SIDE; col += 1) {
        if ((row + col) % 2 === 1) round.board[row * GRID_SIDE + col] = 1;
      }
    }
    const next = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    expect(next.status).toBe("over");
    expect(next.endedAt).toBe(NOW.toISOString());
  });

  it("does not end the round while a playable piece remains", () => {
    const round = withInventory([shape("single"), shape("single"), null]);
    const next = placeBlockudokuPiece(round, 0, 4, 4, NOW);
    expect(next.status).toBe("active");
  });
});

describe("resignBlockudokuRound", () => {
  it("ends an active round and stamps the times", () => {
    const round = withInventory([shape("single"), null, null]);
    const resigned = resignBlockudokuRound(round, NOW);
    expect(resigned.status).toBe("over");
    expect(resigned.startedAt).toBe(NOW.toISOString());
    expect(resigned.endedAt).toBe(NOW.toISOString());
  });

  it("is a no-op once the round is already over", () => {
    const round = { ...withInventory([shape("single"), null, null]), status: "over" as const };
    expect(resignBlockudokuRound(round, LATER)).toBe(round);
  });
});

describe("blockudokuView", () => {
  it("never carries the PRNG state", () => {
    const round = startBlockudokuRound(7);
    const view = blockudokuView(round);
    expect(view).not.toHaveProperty("rngState");
  });
});

describe("blockudokuElapsedMs", () => {
  it("is zero before the round starts", () => {
    const round = withInventory([shape("single"), null, null]);
    expect(blockudokuElapsedMs(round, NOW)).toBe(0);
  });

  it("measures from the first placement to now while live", () => {
    const round = withInventory([shape("single"), null, null]);
    const started = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    expect(blockudokuElapsedMs(started, LATER)).toBe(LATER.getTime() - NOW.getTime());
  });

  it("measures from the first placement to the end once it is over", () => {
    const round = withInventory([shape("single"), null, null]);
    const started = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    const ended = resignBlockudokuRound(started, LATER);
    expect(blockudokuElapsedMs(ended, new Date("2026-09-18T13:00:00.000Z"))).toBe(
      LATER.getTime() - NOW.getTime(),
    );
  });
});
