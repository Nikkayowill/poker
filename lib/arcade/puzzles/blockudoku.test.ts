import { describe, expect, it } from "vitest";

import {
  BLOCKUDOKU_PIECE_SETS,
  BLOCKUDOKU_SHAPES,
  GRID_CELLS,
  GRID_SIDE,
  INVENTORY_SIZE,
  blockudokuElapsedMs,
  blockudokuPlacementProblem,
  blockudokuView,
  placeBlockudokuPiece,
  resignBlockudokuRound,
  blockudokuShapeById,
  isBlockudokuPieceSet,
  startBlockudokuRound,
  type BlockudokuPieceSet,
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

  it("mixes entropy into a refill, so the same history can deal different pieces", () => {
    const round = withInventory([shape("single"), null, null]);
    const dealsFor = (entropy: number) =>
      placeBlockudokuPiece(round, 0, 0, 0, NOW, entropy).inventory.map((piece) => piece?.id).join();
    const deals = new Set([0, 1, 0xdeadbeef, 123456789, 42, 7].map(dealsFor));
    expect(deals.size).toBeGreaterThan(1);
    expect(dealsFor(0)).toBe(dealsFor(0));
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

describe("piece sets", () => {
  const ids = (set: BlockudokuPieceSet) => BLOCKUDOKU_PIECE_SETS[set].map((entry) => entry.id);

  it("keeps classic as the original set", () => {
    expect(BLOCKUDOKU_PIECE_SETS.classic).toBe(BLOCKUDOKU_SHAPES);
    expect(Math.max(...BLOCKUDOKU_SHAPES.map((entry) => entry.cells.length))).toBe(4);
  });

  it("grows each set from the one below it", () => {
    expect(ids("big").slice(0, ids("classic").length)).toEqual(ids("classic"));
    expect(ids("expert").slice(0, ids("big").length)).toEqual(ids("big"));
    expect(ids("big")).toEqual(expect.arrayContaining(["pentomino-i-h", "pentomino-l", "corner-1", "plus", "big-t-down"]));
    expect(ids("big")).not.toContain("square-3");
    expect(ids("expert")).toEqual(expect.arrayContaining(["u-up", "u-down", "square-3"]));
  });

  it("makes master the expert set with nothing under three cells", () => {
    const small = BLOCKUDOKU_PIECE_SETS.expert.filter((entry) => entry.cells.length <= 2).map((entry) => entry.id);
    expect(small).toEqual(["single", "domino-h", "domino-v"]);
    expect(ids("master")).toEqual(ids("expert").filter((id) => !small.includes(id)));
  });

  it("names every shape once, anchored at its top-left, with no cell twice", () => {
    const all = ids("expert");
    expect(new Set(all).size).toBe(all.length);
    for (const entry of BLOCKUDOKU_PIECE_SETS.expert) {
      expect(Math.min(...entry.cells.map(([row]) => row))).toBe(0);
      expect(Math.min(...entry.cells.map(([, col]) => col))).toBe(0);
      expect(new Set(entry.cells.map(([row, col]) => `${row},${col}`)).size).toBe(entry.cells.length);
      expect(blockudokuShapeById(entry.id)).toBe(entry);
    }
    expect(blockudokuShapeById("nope")).toBeNull();
  });

  it("recognises only the known set names", () => {
    expect(isBlockudokuPieceSet("classic")).toBe(true);
    expect(isBlockudokuPieceSet("expert")).toBe(true);
    expect(isBlockudokuPieceSet("master")).toBe(true);
    expect(isBlockudokuPieceSet("hardcore")).toBe(false);
  });
});

describe("dealing by piece set", () => {
  /** Every piece dealt over many refills of a round that plays singles on an empty board. */
  function dealt(round: BlockudokuRound): Set<string> {
    const seen = new Set<string>();
    for (let entropy = 1; entropy <= 300; entropy += 1) {
      const refilled = placeBlockudokuPiece(
        { ...round, board: new Array(GRID_CELLS).fill(0), inventory: [shape("single"), null, null] },
        0,
        4,
        4,
        NOW,
        entropy * 2654435761,
      );
      for (const piece of refilled.inventory) if (piece) seen.add(piece.id);
    }
    return seen;
  }

  it("deals the classic set by default, with the same stream as before sets existed", () => {
    const round = startBlockudokuRound(42);
    expect(round.pieceSet).toBe("classic");
    expect(round.inventory.map((piece) => piece?.id)).toEqual(["tetromino-i-v", "tromino-l-3", "tetromino-z"]);
  });

  it("stores the set on the round and refills from it", () => {
    const round = startBlockudokuRound(7, "expert");
    expect(round.pieceSet).toBe("expert");
    const seen = dealt(round);
    const expert = new Set(BLOCKUDOKU_PIECE_SETS.expert.map((entry) => entry.id));
    for (const id of seen) expect(expert.has(id)).toBe(true);
    expect([...seen].some((id) => !BLOCKUDOKU_SHAPES.some((entry) => entry.id === id))).toBe(true);
  });

  it("refills a round stored before sets existed from the classic set", () => {
    const legacy = withInventory([shape("single"), null, null]);
    expect(legacy.pieceSet).toBeUndefined();
    const classic = new Set(BLOCKUDOKU_SHAPES.map((entry) => entry.id));
    for (const id of dealt(legacy)) expect(classic.has(id)).toBe(true);
  });

  it("jams on a board with no room for a 3x3 block", () => {
    // Only the middle cell of each box is filled, so nothing needing a clean 3x3 fits.
    const round = withInventory([shape("single"), blockudokuShapeById("square-3"), null]);
    for (const box of [10, 13, 16, 37, 40, 43, 64, 67, 70]) round.board[box] = 1;
    const next = placeBlockudokuPiece(round, 0, 0, 0, NOW);
    expect(next.status).toBe("over");
  });
});
