import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_MINESWEEPER_DAILY_WAGERED_LIMIT,
  AnteUpMinesweeperRequestError,
  openAnteUpMinesweeper,
  playAnteUpMinesweeper,
  readAnteUpMinesweeper,
  resignAnteUpMinesweeperAttempt,
} from "./ante-up-minesweeper-service";
import {
  __resetAnteUpAttemptsForTest,
  getActiveAnteUpAttempt,
  getAnteUpAttemptById,
} from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  ANTE_UP_MINESWEEPER_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpMinesweeperAttempt,
} from "@/lib/arcade/ante-up-minesweeper";

/**
 * The Ante Up: Minesweeper money contract, in memory mode.
 *
 * Same three ordering rules as ante-up-service.test.ts (Sudoku) -- the wager
 * leaves exactly once at open, a win credits exactly the settled payout exactly
 * once, and a loss (mine, timeout or resignation) credits nothing at all.
 *
 * The helpers below read the true mine layout straight off the store, the same
 * move the Sudoku tests make against the stored solution. A test cannot play
 * this game honestly: the point of the redacted snapshot is that the board is
 * unknowable from outside.
 */

const GAME = "minesweeper";

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

async function liveAttempt(profileId: string): Promise<AnteUpMinesweeperAttempt> {
  const stored = await getActiveAnteUpAttempt<AnteUpMinesweeperAttempt>(profileId, GAME);
  if (!stored) throw new Error("no active attempt");
  return stored.state;
}

async function liveVersion(profileId: string): Promise<number> {
  const stored = await getActiveAnteUpAttempt<AnteUpMinesweeperAttempt>(profileId, GAME);
  if (!stored) throw new Error("no active attempt");
  return stored.version;
}

/**
 * Reads an attempt by its own id, which keeps working after it settles.
 *
 * The helpers below cannot go through getActiveAnteUpAttempt: an opening click
 * on a beginner board can cascade the whole grid open and win outright, which
 * frees the active slot immediately. That is real Minesweeper behaviour, so a
 * helper that assumed an attempt is still active after the first click would be
 * flaky on exactly the boards that play best.
 */
async function storedById(attemptId: string) {
  const stored = await getAnteUpAttemptById<AnteUpMinesweeperAttempt>(attemptId);
  if (!stored) throw new Error("attempt vanished");
  return stored;
}

/** Opens the board somewhere safe, so the mines are laid and the clock is running. */
async function firstClick(token: string, attemptId: string, now: Date) {
  const { version } = await storedById(attemptId);
  return playAnteUpMinesweeper(token, { version, action: "reveal", index: 40 }, now);
}

/** Opens every safe square in turn, which is the only way to reach a clear. */
async function clearBoard(token: string, attemptId: string, now: Date) {
  await firstClick(token, attemptId, now);
  const mines = new Set((await storedById(attemptId)).state.board.mines ?? []);

  for (let index = 0; index < 81; index += 1) {
    if (mines.has(index)) continue;
    const stored = await storedById(attemptId);
    if (stored.state.status !== "active") break;
    if (stored.state.board.revealed.includes(index)) continue;
    await playAnteUpMinesweeper(
      token,
      { version: stored.version, action: "reveal", index },
      now,
    );
  }
}

/** Opens a known mine, which loses the attempt. */
async function hitAMine(token: string, attemptId: string, now: Date) {
  await firstClick(token, attemptId, now);
  const stored = await storedById(attemptId);
  const mine = (stored.state.board.mines as number[])[0];
  return playAnteUpMinesweeper(
    token,
    { version: stored.version, action: "reveal", index: mine },
    now,
  );
}

const NOW = new Date("2026-08-24T12:00:00.000Z");

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt row exists", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).not.toBeNull();
  });

  it("takes nothing at all for a free attempt", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpMinesweeper(token, "beginner", 0, NOW);

    expect(await balance(token)).toBe(10_000);
    expect((await liveAttempt(id)).wager).toBe(0);
  });

  it("refuses a wager under the floor without touching the wallet", async () => {
    const { token, id } = await funded(10_000);
    await expect(
      openAnteUpMinesweeper(token, "beginner", MIN_ANTE_UP_WAGER - 1, NOW),
    ).rejects.toBeInstanceOf(AnteUpMinesweeperRequestError);

    expect(await balance(token)).toBe(10_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses a stake the player cannot afford without debiting", async () => {
    const { token, id } = await funded(600);
    await expect(openAnteUpMinesweeper(token, "beginner", 5_000, NOW)).rejects.toBeInstanceOf(
      AnteUpMinesweeperRequestError,
    );

    expect(await balance(token)).toBe(600);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses an unknown difficulty without debiting", async () => {
    const { token } = await funded(10_000);
    await expect(openAnteUpMinesweeper(token, "impossible", 1_000, NOW)).rejects.toBeInstanceOf(
      AnteUpMinesweeperRequestError,
    );
    expect(await balance(token)).toBe(10_000);
  });

  it("refuses to open a second attempt while one is live, and keeps the second wager", async () => {
    const { token } = await funded(20_000);
    await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    const afterFirst = await balance(token);

    await expect(openAnteUpMinesweeper(token, "beginner", 1_000, NOW)).rejects.toBeInstanceOf(
      AnteUpMinesweeperRequestError,
    );
    // Rule 1: the row never came into existence, so the refund must have landed.
    expect(await balance(token)).toBe(afterFirst);
  });

  it("copies the tier's multiplier onto the stored attempt", async () => {
    const { token, id } = await funded(20_000);
    await openAnteUpMinesweeper(token, "expert", 1_000, NOW);
    expect((await liveAttempt(id)).multiplier).toBe(ANTE_UP_MINESWEEPER_TIERS.expert.multiplier);
  });
});

describe("settlement", () => {
  it("pays exactly wager times multiplier, once, on a clear", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    await clearBoard(token, attempt.id, NOW);

    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull(); // settled, so the slot is free again

    const payout = Math.round(1_000 * ANTE_UP_MINESWEEPER_TIERS.beginner.multiplier);
    expect(await balance(token)).toBe(10_000 - 1_000 + payout);
  });

  it("credits nothing when a mine is opened", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    await hitAMine(token, attempt.id, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("credits nothing on a resignation", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    await resignAnteUpMinesweeperAttempt(token, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("credits nothing when the clock runs out", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    await firstClick(token, attempt.id, NOW);

    const late = new Date(NOW.getTime() + ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs + 1_000);
    const read = await readAnteUpMinesweeper(token, late);

    expect(read.attempt?.status).toBe("timed-out");
    expect(await balance(token)).toBe(9_000);
  });

  it("refuses a move after the clock ran out, and settles it in the same breath", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    await firstClick(token, attempt.id, NOW);

    const late = new Date(NOW.getTime() + ANTE_UP_MINESWEEPER_TIERS.beginner.timeLimitMs + 1_000);
    await expect(
      playAnteUpMinesweeper(token, { version: await liveVersion(id), action: "reveal", index: 0 }, late),
    ).rejects.toBeInstanceOf(AnteUpMinesweeperRequestError);

    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
    expect(await balance(token)).toBe(9_000);
  });

  it("pays nothing for a free clear, and still frees the slot", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 0, NOW);
    await clearBoard(token, attempt.id, NOW);

    expect(await balance(token)).toBe(10_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("lets the player open a fresh attempt once the last one settled", async () => {
    const { token, id } = await funded(20_000);
    await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    await resignAnteUpMinesweeperAttempt(token, NOW);
    await expect(openAnteUpMinesweeper(token, "beginner", 1_000, NOW)).resolves.toBeDefined();
    expect((await liveAttempt(id)).status).toBe("active");
  });

  it("resigning with no attempt open is a no-op, not an error", async () => {
    const { token } = await funded(10_000);
    const result = await resignAnteUpMinesweeperAttempt(token, NOW);
    expect(result.attempt).toBeNull();
  });
});

describe("moves", () => {
  it("refuses a move pinned to a stale version", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    const stale = await liveVersion(id);
    await firstClick(token, attempt.id, NOW);

    await expect(
      playAnteUpMinesweeper(token, { version: stale, action: "reveal", index: 0 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpMinesweeperRequestError);
  });

  it("refuses a move when nothing is open", async () => {
    const { token } = await funded(10_000);
    await expect(
      playAnteUpMinesweeper(token, { version: 1, action: "reveal", index: 0 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpMinesweeperRequestError);
  });

  it("flags a square without opening it or ending the attempt", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    const result = await playAnteUpMinesweeper(
      token,
      { version: await liveVersion(id), action: "flag", index: 5 },
      NOW,
    );

    expect(result.attempt.board.flags).toContain(5);
    expect(result.attempt.status).toBe("active");
    // Flagging must not lay the mines -- the first REVEAL is what does that.
    expect((await liveAttempt(id)).board.mines).toBeNull();
  });

  it("never sends a mine position while the attempt is live", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpMinesweeper(token, "beginner", 1_000, NOW);
    const result = await firstClick(token, attempt.id, NOW);

    const mines = (await liveAttempt(id)).board.mines as number[];
    for (const mine of mines) {
      expect(result.attempt.board.cells[mine]).toBe(-1);
    }
  });
});

describe("daily wagered cap", () => {
  it("refuses past the limit, but free practice stays open", async () => {
    const { token } = await funded(1_000_000);

    for (let i = 0; i < ANTE_UP_MINESWEEPER_DAILY_WAGERED_LIMIT; i += 1) {
      await openAnteUpMinesweeper(token, "beginner", MIN_ANTE_UP_WAGER, NOW);
      await resignAnteUpMinesweeperAttempt(token, NOW);
    }

    await expect(
      openAnteUpMinesweeper(token, "beginner", MIN_ANTE_UP_WAGER, NOW),
    ).rejects.toBeInstanceOf(AnteUpMinesweeperRequestError);

    await expect(openAnteUpMinesweeper(token, "beginner", 0, NOW)).resolves.toBeDefined();
  });
});
