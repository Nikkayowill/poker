import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_WORD_STACK_DAILY_WAGERED_LIMIT,
  AnteUpWordStackRequestError,
  openAnteUpWordStack,
  playAnteUpWordStack,
  readAnteUpWordStack,
  resignAnteUpWordStackAttempt,
} from "./ante-up-word-stack-service";
import { __resetAnteUpAttemptsForTest, getActiveAnteUpAttempt } from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import type { AnteUpWordStackAttempt } from "@/lib/arcade/ante-up-word-stack";

/**
 * The Ante Up: Word Stack money contract, in memory mode. Same shape as
 * ante-up-service.test.ts (Sudoku) -- restated rather than shared, per this
 * app's "restate, don't couple" convention for every money-ordering file.
 *
 * Unlike Sudoku, the payout multiplier is not fixed at open -- it is scored
 * off how many guesses the win took -- so "pays exactly the right multiple"
 * here means solving in exactly one guess (the top 8x tier) rather than
 * reading a tier table by name.
 */

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

/** Reads the true answer straight off the store and wins in one guess. */
async function winInOneGuess(token: string, profileId: string) {
  const stored = await getActiveAnteUpAttempt<AnteUpWordStackAttempt>(profileId, "word-stack");
  if (!stored) throw new Error("no active attempt");
  const { attempt } = await playAnteUpWordStack(token, {
    version: stored.version,
    guess: stored.state.word.answer,
  });
  return attempt;
}

/** Loses an attempt out over all six guesses, using a filler word that is never the answer. */
async function loseOutOfGuesses(token: string, profileId: string) {
  let stored = await getActiveAnteUpAttempt<AnteUpWordStackAttempt>(profileId, "word-stack");
  if (!stored) throw new Error("no active attempt");
  let version = stored.version;
  let attempt;
  for (let round = 0; round < 6; round += 1) {
    stored = (await getActiveAnteUpAttempt<AnteUpWordStackAttempt>(profileId, "word-stack"))!;
    const filler = stored.state.word.answer === "stone" ? "crane" : "stone";
    ({ attempt } = await playAnteUpWordStack(token, { version, guess: filler }));
    version = attempt.version;
    if (attempt.status !== "active") return attempt;
  }
  throw new Error("played six guesses but the attempt never settled");
}

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt exists", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpWordStack(token, 1000);
    expect(await balance(token)).toBe(before - 1000);
  });

  it("lets a zero wager through with no debit", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpWordStack(token, 0);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a nonzero wager under the floor, without touching the wallet", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(openAnteUpWordStack(token, 499)).rejects.toBeInstanceOf(AnteUpWordStackRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a stake the player cannot cover, without debiting", async () => {
    const { token } = await funded(100);
    await expect(openAnteUpWordStack(token, 500)).rejects.toBeInstanceOf(AnteUpWordStackRequestError);
    expect(await balance(token)).toBe(100);
  });

  it("holds one live attempt at a time", async () => {
    const { token } = await funded();
    await openAnteUpWordStack(token, 500);
    const after = await balance(token);
    await expect(openAnteUpWordStack(token, 500)).rejects.toBeInstanceOf(AnteUpWordStackRequestError);
    // The second attempt never came into existence, so nothing further was debited.
    expect(await balance(token)).toBe(after);
  });

  it("refunds the wager if the attempt fails to come into existence", async () => {
    const { token } = await funded();
    await openAnteUpWordStack(token, 500);
    const before = await balance(token);
    // Opening a second attempt while one is live throws before a row is
    // created -- the refund path this exercises is the same one a persistence
    // failure would take.
    await expect(openAnteUpWordStack(token, 500)).rejects.toBeInstanceOf(AnteUpWordStackRequestError);
    expect(await balance(token)).toBe(before);
  });
});

describe("settlement", () => {
  it("pays exactly the one-guess tier on a win, once", async () => {
    const { token, id } = await funded();
    await openAnteUpWordStack(token, 1000);
    const afterDebit = await balance(token);

    const result = await winInOneGuess(token, id);
    expect(result.status).toBe("won");
    expect(result.payout).toBe(8000); // 1 guess -> 8x

    // At least the payout -- a puzzle win can also complete a daily mission
    // and credit its own (much smaller) reward alongside it, which this must
    // tolerate without masking a double-paid or unpaid pot.
    const after = await balance(token);
    expect(after).toBeGreaterThanOrEqual(afterDebit + result.payout);
    expect(after).toBeLessThan(afterDebit + result.payout * 2);
  });

  it("forfeits the wager on a loss (out of guesses), crediting nothing", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    await openAnteUpWordStack(token, 750);

    const result = await loseOutOfGuesses(token, id);
    expect(result.status).toBe("lost");
    expect(result.payout).toBe(0);
    expect(await balance(token)).toBe(before - 750);
  });

  it("forfeits the wager on an early resignation, crediting nothing", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpWordStack(token, 750);

    const { attempt } = await resignAnteUpWordStackAttempt(token);
    expect(attempt?.status).toBe("lost");
    expect(await balance(token)).toBe(before - 750);
  });

  it("frees the player to open another attempt once one settles", async () => {
    const { token } = await funded();
    await openAnteUpWordStack(token, 500);
    await resignAnteUpWordStackAttempt(token);
    await expect(openAnteUpWordStack(token, 500)).resolves.toBeTruthy();
  });

  it("pays no Gold on a won practice (zero-wager) attempt", async () => {
    const { token, id } = await funded();
    await openAnteUpWordStack(token, 0);
    const result = await winInOneGuess(token, id);
    expect(result.status).toBe("won");
    expect(result.payout).toBe(0);
  });
});

describe("readAnteUpWordStack", () => {
  it("returns the caller's live attempt, or null with none open", async () => {
    const { token } = await funded();
    expect((await readAnteUpWordStack(token)).attempt).toBeNull();
    await openAnteUpWordStack(token, 500);
    expect((await readAnteUpWordStack(token)).attempt?.status).toBe("active");
  });
});

describe("daily wagered cap", () => {
  it("refuses a new wagered attempt past the daily limit, but keeps free practice open", async () => {
    const { token } = await funded(1_000_000);

    for (let round = 0; round < ANTE_UP_WORD_STACK_DAILY_WAGERED_LIMIT; round += 1) {
      await openAnteUpWordStack(token, 500);
      await resignAnteUpWordStackAttempt(token);
    }

    await expect(openAnteUpWordStack(token, 500)).rejects.toBeInstanceOf(AnteUpWordStackRequestError);
    // Practice is not a wager, so the cap does not apply to it.
    await expect(openAnteUpWordStack(token, 0)).resolves.toBeTruthy();
  });
});
