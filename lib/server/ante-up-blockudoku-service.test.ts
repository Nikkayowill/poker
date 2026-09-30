import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_BLOCKUDOKU_DAILY_WAGERED_LIMIT,
  AnteUpBlockudokuRequestError,
  openAnteUpBlockudoku,
  placeAnteUpBlockudoku,
  readAnteUpBlockudoku,
  resignAnteUpBlockudokuAttempt,
} from "./ante-up-blockudoku-service";
import {
  __resetAnteUpAttemptsForTest,
  advanceAnteUpAttempt,
  getActiveAnteUpAttempt,
  getAnteUpAttemptById,
} from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  ANTE_UP_BLOCKUDOKU_GRANDMASTER,
  ANTE_UP_BLOCKUDOKU_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpBlockudokuAttempt,
} from "@/lib/arcade/ante-up-blockudoku";
import {
  BLOCKUDOKU_SHAPES,
  GRID_CELLS,
  GRID_SIDE,
  type BlockudokuShape,
} from "@/lib/arcade/puzzles/blockudoku";

/**
 * The Ante Up: Blockudoku money contract, in memory mode.
 *
 * Same three ordering rules as the Minesweeper service test: the wager leaves
 * exactly once at open, a win credits exactly the settled payout exactly once,
 * and a loss (jam, timeout or resignation) credits nothing at all.
 *
 * The piece supply is random, so reaching a target score honestly would make
 * these tests depend on the deal. `rig` writes a chosen board straight into the
 * store instead, the same move the Minesweeper tests make reading its mines.
 */

const GAME = "blockudoku";
const NOW = new Date("2026-09-18T12:00:00.000Z");

function shape(id: string): BlockudokuShape {
  const found = BLOCKUDOKU_SHAPES.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown shape: ${id}`);
  return found;
}

async function funded(gold = 50_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

async function live(profileId: string) {
  const stored = await getActiveAnteUpAttempt<AnteUpBlockudokuAttempt>(profileId, GAME);
  if (!stored) throw new Error("no active attempt");
  return stored;
}

/** Rewrites the live round's board, inventory and score, and returns the new version. */
async function rig(
  profileId: string,
  board: { cells?: number[]; inventory: (BlockudokuShape | null)[]; score?: number },
): Promise<number> {
  const current = await live(profileId);
  const next: AnteUpBlockudokuAttempt = {
    ...current.state,
    board: {
      ...current.state.board,
      board: board.cells ?? current.state.board.board,
      inventory: board.inventory,
      score: board.score ?? current.state.board.score,
    },
  };
  const advanced = await advanceAnteUpAttempt(current, next);
  if (!advanced) throw new Error("rig lost a race");
  return advanced.version;
}

/** No 2x2 empty square anywhere and no full line, so an O piece can never fit. */
function checkerboard(): number[] {
  const cells: number[] = [];
  for (let index = 0; index < GRID_CELLS; index += 1) {
    const row = Math.floor(index / GRID_SIDE);
    const col = index % GRID_SIDE;
    cells.push((row + col) % 2);
  }
  return cells;
}

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt row exists", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).not.toBeNull();
  });

  it("takes nothing at all for a free attempt", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 0, NOW);

    expect(await balance(token)).toBe(10_000);
    expect((await live(id)).state.wager).toBe(0);
  });

  it("refuses a wager under the floor without touching the wallet", async () => {
    const { token, id } = await funded(10_000);
    await expect(
      openAnteUpBlockudoku(token, "casual", MIN_ANTE_UP_WAGER - 1, NOW),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);

    expect(await balance(token)).toBe(10_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses a stake the player cannot afford without debiting", async () => {
    const { token, id } = await funded(600);
    await expect(openAnteUpBlockudoku(token, "casual", 5_000, NOW)).rejects.toBeInstanceOf(
      AnteUpBlockudokuRequestError,
    );

    expect(await balance(token)).toBe(600);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses an unknown difficulty without debiting", async () => {
    const { token } = await funded(10_000);
    await expect(openAnteUpBlockudoku(token, "nightmare", 1_000, NOW)).rejects.toBeInstanceOf(
      AnteUpBlockudokuRequestError,
    );
    expect(await balance(token)).toBe(10_000);
  });

  it("refuses a second attempt while one is live, and refunds the second wager", async () => {
    const { token } = await funded(20_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const afterFirst = await balance(token);

    await expect(openAnteUpBlockudoku(token, "casual", 1_000, NOW)).rejects.toBeInstanceOf(
      AnteUpBlockudokuRequestError,
    );
    expect(await balance(token)).toBe(afterFirst);
  });

  it("copies the tier's terms onto the stored attempt", async () => {
    const { token, id } = await funded(20_000);
    await openAnteUpBlockudoku(token, "hardcore", 1_000, NOW);
    const { state } = await live(id);
    expect(state.multiplier).toBe(ANTE_UP_BLOCKUDOKU_TIERS.hardcore.multiplier);
    expect(state.targetScore).toBe(ANTE_UP_BLOCKUDOKU_TIERS.hardcore.targetScore);
  });
});

describe("stake pressure", () => {
  it("refuses a board too easy for the stake without touching the wallet", async () => {
    const { token, id } = await funded(2_000_000);
    await expect(openAnteUpBlockudoku(token, "casual", 10_000, NOW)).rejects.toThrow(/Standard or harder/);
    await expect(openAnteUpBlockudoku(token, "standard", 100_000, NOW)).rejects.toThrow(/Hardcore or harder/);
    await expect(openAnteUpBlockudoku(token, "standard", 1_000_000, NOW)).rejects.toBeInstanceOf(
      AnteUpBlockudokuRequestError,
    );
    expect(await balance(token)).toBe(2_000_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("opens Hardcore as Grandmaster at a top stake, on the master piece set", async () => {
    const { token, id } = await funded(2_000_000);
    const { attempt } = await openAnteUpBlockudoku(token, "hardcore", 1_000_000, NOW);
    expect(attempt.wager).toBe(1_000_000);
    expect(attempt.targetScore).toBe(ANTE_UP_BLOCKUDOKU_GRANDMASTER.targetScore);
    const { state } = await live(id);
    expect(state.board.pieceSet).toBe("master");
  });

  it("keeps every tier open under the first band", async () => {
    const { token, id } = await funded(20_000);
    await openAnteUpBlockudoku(token, "casual", 9_999, NOW);
    expect((await live(id)).state.board.pieceSet).toBe("classic");
  });
});

describe("settlement", () => {
  it("pays exactly wager times multiplier, once, on reaching the target", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const target = ANTE_UP_BLOCKUDOKU_TIERS.casual.targetScore;
    const single = shape("single");
    const version = await rig(id, { inventory: [single, single, single], score: target - 1 });

    const result = await placeAnteUpBlockudoku(token, { version, slot: 0, row: 4, col: 4 }, NOW);
    expect(result.attempt.status).toBe("won");
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();

    const payout = Math.round(1_000 * ANTE_UP_BLOCKUDOKU_TIERS.casual.multiplier);
    expect(result.attempt.payout).toBe(payout);
    expect(await balance(token)).toBe(10_000 - 1_000 + payout);
    // The response carries the balance after the payout, not the one before it.
    expect(result.profile.goldBalance).toBe(10_000 - 1_000 + payout);

    // A replay of the same placement must not pay a second time.
    await expect(
      placeAnteUpBlockudoku(token, { version, slot: 1, row: 0, col: 0 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);
    expect(await balance(token)).toBe(10_000 - 1_000 + payout);
  });

  it("credits nothing when the board jams short of the target", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const version = await rig(id, {
      cells: checkerboard(),
      inventory: [shape("single"), shape("tetromino-o"), null],
    });

    // Row 0, col 0 is empty on the checkerboard, and filling it completes nothing.
    const result = await placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 0 }, NOW);
    expect(result.attempt.status).toBe("lost");
    expect(result.attempt.payout).toBe(0);
    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("credits nothing on a resignation", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    await resignAnteUpBlockudokuAttempt(token, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("credits nothing when the clock runs out, and settles on a read", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const single = shape("single");
    const version = await rig(id, { inventory: [single, single, single] });
    await placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 0 }, NOW);

    const late = new Date(NOW.getTime() + ANTE_UP_BLOCKUDOKU_TIERS.casual.timeLimitMs + 1_000);
    const read = await readAnteUpBlockudoku(token, late);

    expect(read.attempt?.status).toBe("timed-out");
    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses a placement after the clock ran out, and settles it in the same breath", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const single = shape("single");
    const version = await rig(id, { inventory: [single, single, single] });
    const first = await placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 0 }, NOW);

    const late = new Date(NOW.getTime() + ANTE_UP_BLOCKUDOKU_TIERS.casual.timeLimitMs + 1_000);
    await expect(
      placeAnteUpBlockudoku(
        token,
        { version: first.attempt.version, slot: 1, row: 8, col: 8 },
        late,
      ),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);

    const settled = await getAnteUpAttemptById<AnteUpBlockudokuAttempt>(first.attempt.id);
    expect(settled?.state.status).toBe("timed-out");
    expect(await balance(token)).toBe(9_000);
  });

  it("pays nothing for a free win, and still frees the slot", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 0, NOW);
    const single = shape("single");
    const version = await rig(id, {
      inventory: [single, single, single],
      score: ANTE_UP_BLOCKUDOKU_TIERS.casual.targetScore,
    });
    const result = await placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 0 }, NOW);

    expect(result.attempt.status).toBe("won");
    expect(await balance(token)).toBe(10_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("resigning with no attempt open is a no-op, not an error", async () => {
    const { token } = await funded(10_000);
    const result = await resignAnteUpBlockudokuAttempt(token, NOW);
    expect(result.attempt).toBeNull();
  });
});

describe("placements", () => {
  it("refuses a placement pinned to a stale version", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const single = shape("single");
    const version = await rig(id, { inventory: [single, single, single] });
    await placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 0 }, NOW);

    await expect(
      placeAnteUpBlockudoku(token, { version, slot: 1, row: 1, col: 1 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);
  });

  it("refuses a placement when nothing is open", async () => {
    const { token } = await funded(10_000);
    await expect(
      placeAnteUpBlockudoku(token, { version: 1, slot: 0, row: 0, col: 0 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);
  });

  it("refuses an overlapping placement and sends the true board back", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const single = shape("single");
    const version = await rig(id, { inventory: [single, single, single] });
    const first = await placeAnteUpBlockudoku(token, { version, slot: 0, row: 2, col: 2 }, NOW);

    const refused = await placeAnteUpBlockudoku(
      token,
      { version: first.attempt.version, slot: 1, row: 2, col: 2 },
      NOW,
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AnteUpBlockudokuRequestError);
    expect((refused as AnteUpBlockudokuRequestError).round?.board.board[2 * GRID_SIDE + 2]).toBe(1);
  });

  it("refuses a piece that would hang off the board", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    const version = await rig(id, { inventory: [shape("tetromino-i-h"), null, null] });

    await expect(
      placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 7 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);
  });

  it("never sends the piece stream's PRNG state to the browser", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    expect(JSON.stringify(attempt)).not.toContain("rngState");

    const read = await readAnteUpBlockudoku(token, NOW);
    expect(JSON.stringify(read.attempt)).not.toContain("rngState");
  });

  it("scores the cells placed and starts the clock on the first placement", async () => {
    const { token, id } = await funded(10_000);
    const opened = await openAnteUpBlockudoku(token, "casual", 1_000, NOW);
    expect(opened.attempt.expiresAt).toBeNull();

    const version = await rig(id, { inventory: [shape("tetromino-o"), null, null] });
    const result = await placeAnteUpBlockudoku(token, { version, slot: 0, row: 0, col: 0 }, NOW);
    expect(result.attempt.board.score).toBe(4);
    expect(result.attempt.expiresAt).not.toBeNull();
    // The last slot emptied, so a fresh set of three was drawn.
    expect(result.attempt.board.inventory.every((piece) => piece !== null)).toBe(true);
  });
});

describe("daily wagered cap", () => {
  it("refuses past the limit, but free practice stays open", async () => {
    const { token } = await funded(1_000_000);

    for (let i = 0; i < ANTE_UP_BLOCKUDOKU_DAILY_WAGERED_LIMIT; i += 1) {
      await openAnteUpBlockudoku(token, "casual", MIN_ANTE_UP_WAGER, NOW);
      await resignAnteUpBlockudokuAttempt(token, NOW);
    }

    await expect(
      openAnteUpBlockudoku(token, "casual", MIN_ANTE_UP_WAGER, NOW),
    ).rejects.toBeInstanceOf(AnteUpBlockudokuRequestError);

    await expect(openAnteUpBlockudoku(token, "casual", 0, NOW)).resolves.toBeDefined();
  });
});
