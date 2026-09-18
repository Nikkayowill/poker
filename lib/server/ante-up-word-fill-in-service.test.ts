import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_WORD_FILL_IN_DAILY_WAGERED_LIMIT,
  AnteUpWordFillInRequestError,
  clearAnteUpWordFillIn,
  openAnteUpWordFillIn,
  placeAnteUpWordFillIn,
  readAnteUpWordFillIn,
  resignAnteUpWordFillInAttempt,
} from "./ante-up-word-fill-in-service";
import {
  __resetAnteUpAttemptsForTest,
  getActiveAnteUpAttempt,
  getAnteUpAttemptById,
} from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  ANTE_UP_WORD_FILL_IN_TIERS,
  MIN_ANTE_UP_WAGER,
  type AnteUpWordFillInAttempt,
} from "@/lib/arcade/ante-up-word-fill-in";

/**
 * The Ante Up: Word Fill-In money contract, in memory mode. The helpers read
 * the true solution off the store, since the snapshot never carries it while
 * an attempt is live.
 */

const GAME = "word-fill-in";

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

async function storedById(attemptId: string) {
  const stored = await getAnteUpAttemptById<AnteUpWordFillInAttempt>(attemptId);
  if (!stored) throw new Error("attempt vanished");
  return stored;
}

/** The word the stored solution puts in each slot, by slot index. */
function answers(attempt: AnteUpWordFillInAttempt, slots: number[][]): string[] {
  return slots.map((cells) => cells.map((cell) => attempt.round.solution[cell]).join(""));
}

/** Places the first slot's answer, which starts the clock. */
async function firstWord(token: string, attemptId: string, slots: number[][], now: Date) {
  const stored = await storedById(attemptId);
  return placeAnteUpWordFillIn(
    token,
    { version: stored.version, slot: 0, word: answers(stored.state, slots)[0] },
    now,
  );
}

/** Places every answer in turn, which is the only way to a win. */
/** Fills every slot with its answer; returns the response to the last move. */
async function solveGrid(token: string, attemptId: string, slots: number[][], now: Date) {
  let last: Awaited<ReturnType<typeof placeAnteUpWordFillIn>> | null = null;
  for (let slot = 0; slot < slots.length; slot += 1) {
    const stored = await storedById(attemptId);
    if (stored.state.status !== "active") break;
    last = await placeAnteUpWordFillIn(
      token,
      { version: stored.version, slot, word: answers(stored.state, slots)[slot] },
      now,
    );
  }
  return last;
}

const NOW = new Date("2026-09-18T12:00:00.000Z");

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt row exists", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpWordFillIn(token, "quick", 1_000, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).not.toBeNull();
  });

  it("takes nothing for a free attempt", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 0, NOW);
    expect(await balance(token)).toBe(10_000);
    expect(attempt.wager).toBe(0);
  });

  it("refuses a wager under the floor without touching the wallet", async () => {
    const { token, id } = await funded(10_000);
    await expect(
      openAnteUpWordFillIn(token, "quick", MIN_ANTE_UP_WAGER - 1, NOW),
    ).rejects.toBeInstanceOf(AnteUpWordFillInRequestError);
    expect(await balance(token)).toBe(10_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses a stake the player cannot afford without debiting", async () => {
    const { token, id } = await funded(600);
    await expect(openAnteUpWordFillIn(token, "quick", 5_000, NOW)).rejects.toBeInstanceOf(
      AnteUpWordFillInRequestError,
    );
    expect(await balance(token)).toBe(600);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("refuses an unknown tier without debiting", async () => {
    const { token } = await funded(10_000);
    await expect(openAnteUpWordFillIn(token, "blitz", 1_000, NOW)).rejects.toBeInstanceOf(
      AnteUpWordFillInRequestError,
    );
    expect(await balance(token)).toBe(10_000);
  });

  it("refuses a second attempt while one is live, and refunds the second wager", async () => {
    const { token } = await funded(20_000);
    await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    const afterFirst = await balance(token);

    await expect(openAnteUpWordFillIn(token, "quick", 1_000, NOW)).rejects.toBeInstanceOf(
      AnteUpWordFillInRequestError,
    );
    expect(await balance(token)).toBe(afterFirst);
  });

  it("copies the tier's multiplier onto the stored attempt", async () => {
    const { token, id } = await funded(20_000);
    await openAnteUpWordFillIn(token, "marathon", 1_000, NOW);
    const stored = await getActiveAnteUpAttempt<AnteUpWordFillInAttempt>(id, GAME);
    expect(stored?.state.multiplier).toBe(ANTE_UP_WORD_FILL_IN_TIERS.marathon.multiplier);
  });
});

describe("settlement", () => {
  it("pays exactly wager times multiplier, once, on a solve", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    const winning = await solveGrid(token, attempt.id, attempt.board.slots, NOW);

    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
    const payout = Math.round(1_000 * ANTE_UP_WORD_FILL_IN_TIERS.quick.multiplier);
    expect(await balance(token)).toBe(10_000 - 1_000 + payout);
    // The response carries the balance after the payout, not the one before it.
    expect(winning?.profile.goldBalance).toBe(10_000 - 1_000 + payout);

    // A replayed final move after settlement must not pay again.
    const stored = await storedById(attempt.id);
    await expect(
      placeAnteUpWordFillIn(token, { version: stored.version, slot: 0, word: "CAT" }, NOW),
    ).rejects.toBeInstanceOf(AnteUpWordFillInRequestError);
    expect(await balance(token)).toBe(10_000 - 1_000 + payout);
  });

  it("reveals the solution only once settled", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    expect(attempt.board.solution).toBeNull();

    const moved = await firstWord(token, attempt.id, attempt.board.slots, NOW);
    expect(moved.attempt.board.solution).toBeNull();
    expect(JSON.stringify(moved.attempt)).not.toContain('"solution":"');

    const resigned = await resignAnteUpWordFillInAttempt(token, NOW);
    expect(resigned.attempt?.board.solution).toMatch(/^[A-Z#]+$/);
  });

  it("credits nothing on a resignation", async () => {
    const { token, id } = await funded(10_000);
    await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    await resignAnteUpWordFillInAttempt(token, NOW);

    expect(await balance(token)).toBe(9_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("credits nothing when the clock runs out", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    await firstWord(token, attempt.id, attempt.board.slots, NOW);

    const late = new Date(NOW.getTime() + ANTE_UP_WORD_FILL_IN_TIERS.quick.timeLimitMs + 1_000);
    const read = await readAnteUpWordFillIn(token, late);
    expect(read.attempt?.status).toBe("timed-out");
    expect(await balance(token)).toBe(9_000);
  });

  it("refuses a move after the clock ran out, and settles it in the same breath", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    await firstWord(token, attempt.id, attempt.board.slots, NOW);
    const { version } = await storedById(attempt.id);

    const late = new Date(NOW.getTime() + ANTE_UP_WORD_FILL_IN_TIERS.quick.timeLimitMs + 1_000);
    await expect(clearAnteUpWordFillIn(token, { version, slot: 0 }, late)).rejects.toBeInstanceOf(
      AnteUpWordFillInRequestError,
    );
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
    expect(await balance(token)).toBe(9_000);
  });

  it("pays nothing for a free solve, and still frees the slot", async () => {
    const { token, id } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 0, NOW);
    await solveGrid(token, attempt.id, attempt.board.slots, NOW);

    expect(await balance(token)).toBe(10_000);
    expect(await getActiveAnteUpAttempt(id, GAME)).toBeNull();
  });

  it("resigning with no attempt open is a no-op", async () => {
    const { token } = await funded(10_000);
    expect((await resignAnteUpWordFillInAttempt(token, NOW)).attempt).toBeNull();
  });
});

describe("moves", () => {
  it("refuses a move pinned to a stale version", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    await firstWord(token, attempt.id, attempt.board.slots, NOW);

    await expect(
      clearAnteUpWordFillIn(token, { version: attempt.version, slot: 0 }, NOW),
    ).rejects.toBeInstanceOf(AnteUpWordFillInRequestError);
  });

  it("refuses a move when nothing is open", async () => {
    const { token } = await funded(10_000);
    await expect(
      placeAnteUpWordFillIn(token, { version: 1, slot: 0, word: "CAT" }, NOW),
    ).rejects.toBeInstanceOf(AnteUpWordFillInRequestError);
  });

  it("refuses a word that is not on the list, carrying the true board back", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    const error = await placeAnteUpWordFillIn(
      token,
      { version: attempt.version, slot: 0, word: "QQQQ" },
      NOW,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnteUpWordFillInRequestError);
    expect((error as AnteUpWordFillInRequestError).round?.version).toBe(attempt.version);
  });

  it("places a word, then clears it, without ending the attempt", async () => {
    const { token } = await funded(10_000);
    const { attempt } = await openAnteUpWordFillIn(token, "quick", 1_000, NOW);
    const placed = await firstWord(token, attempt.id, attempt.board.slots, NOW);
    const firstCell = attempt.board.slots[0][0];
    expect(placed.attempt.board.guesses[firstCell]).toMatch(/[A-Z]/);
    expect(placed.attempt.expiresAt).not.toBeNull();

    const cleared = await clearAnteUpWordFillIn(
      token,
      { version: placed.attempt.version, slot: 0 },
      NOW,
    );
    expect(cleared.attempt.status).toBe("active");
    expect(cleared.attempt.board.guesses[firstCell]).toBe("_");
  });
});

describe("daily wagered cap", () => {
  it("refuses past the limit, but free practice stays open", async () => {
    const { token } = await funded(1_000_000);

    for (let i = 0; i < ANTE_UP_WORD_FILL_IN_DAILY_WAGERED_LIMIT; i += 1) {
      await openAnteUpWordFillIn(token, "quick", MIN_ANTE_UP_WAGER, NOW);
      await resignAnteUpWordFillInAttempt(token, NOW);
    }

    await expect(
      openAnteUpWordFillIn(token, "quick", MIN_ANTE_UP_WAGER, NOW),
    ).rejects.toBeInstanceOf(AnteUpWordFillInRequestError);
    await expect(openAnteUpWordFillIn(token, "quick", 0, NOW)).resolves.toBeDefined();
  });
});
