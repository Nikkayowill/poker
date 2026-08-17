import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AnteUpRequestError,
  ANTE_UP_DAILY_WAGERED_LIMIT,
  fillAnteUpAttempt,
  openAnteUpAttempt,
  readAnteUpAttempt,
  resignAnteUp,
} from "./ante-up-service";
import { __resetAnteUpAttemptsForTest, getActiveAnteUpAttempt } from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import { ANTE_UP_TIERS } from "@/lib/arcade/ante-up";

/**
 * The Ante Up money contract, in memory mode.
 *
 * Unlike a duel, there is no conservation invariant to check here -- a win
 * pays MORE than was staked, out of the app's own faucet, not another
 * player's loss. What has to hold instead is exact: the wager leaves exactly
 * once at open, a win credits exactly wager*multiplier exactly once, and a
 * loss or timeout credits nothing at all.
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

/** Drives a real attempt to a win by reading the true solution straight off the store. */
async function solveActiveAttempt(token: string, profileId: string) {
  let stored = await getActiveAnteUpAttempt(profileId);
  if (!stored) throw new Error("no active attempt");
  let version = stored.version;

  const emptyCells = stored.state.sudoku.puzzle
    .map((given, index) => (given === 0 ? index : -1))
    .filter((index) => index >= 0);

  for (const index of emptyCells) {
    const digit = stored!.state.sudoku.solution[index];
    const { attempt } = await fillAnteUpAttempt(token, { version, index, value: digit });
    version = attempt.version;
    if (attempt.status !== "active") return attempt;
    stored = await getActiveAnteUpAttempt(profileId);
  }
  throw new Error("solved every cell but never won");
}

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt exists", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpAttempt(token, "easy", 1000);
    expect(await balance(token)).toBe(before - 1000);
  });

  it("lets a zero wager through with no debit", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpAttempt(token, "easy", 0);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a nonzero wager under the floor, without touching the wallet", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(openAnteUpAttempt(token, "easy", 499)).rejects.toBeInstanceOf(AnteUpRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a stake the player cannot cover, without debiting", async () => {
    const { token } = await funded(100);
    await expect(openAnteUpAttempt(token, "easy", 500)).rejects.toBeInstanceOf(AnteUpRequestError);
    expect(await balance(token)).toBe(100);
  });

  it("holds one live attempt at a time", async () => {
    const { token } = await funded();
    await openAnteUpAttempt(token, "easy", 500);
    const after = await balance(token);
    await expect(openAnteUpAttempt(token, "easy", 500)).rejects.toBeInstanceOf(AnteUpRequestError);
    // The second attempt never existed, so nothing further was debited.
    expect(await balance(token)).toBe(after);
  });
});

describe("settlement", () => {
  it("pays exactly wager * multiplier on a win, once", async () => {
    const { token, id } = await funded();
    await openAnteUpAttempt(token, "hard", 1000);
    const afterDebit = await balance(token);

    const result = await solveActiveAttempt(token, id);
    expect(result.status).toBe("won");
    expect(result.payout).toBe(1000 * ANTE_UP_TIERS.hard.multiplier);

    // At least the payout -- a puzzle win can also complete a daily mission
    // and credit its own (much smaller) reward alongside it, which this must
    // tolerate without masking a double-paid or unpaid pot. A win crediting
    // less than the payout, or more than double it, is the real bug this
    // guards against.
    const after = await balance(token);
    expect(after).toBeGreaterThanOrEqual(afterDebit + result.payout);
    expect(after).toBeLessThan(afterDebit + result.payout * 2);
  });

  it("forfeits the wager on an early resignation, crediting nothing", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpAttempt(token, "easy", 750);

    const { attempt } = await resignAnteUp(token);
    expect(attempt?.status).toBe("lost");
    expect(await balance(token)).toBe(before - 750);
  });

  it("forfeits the wager on a timeout, crediting nothing", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    await openAnteUpAttempt(token, "expert", 500);

    const stored = await getActiveAnteUpAttempt(id);
    const pastDeadline = new Date(Date.parse(stored!.state.expiresAt) + 1000);
    const { attempt } = await readAnteUpAttempt(token, pastDeadline);

    expect(attempt?.status).toBe("timed-out");
    expect(await balance(token)).toBe(before - 500);
  });

  it("frees the player to open another attempt once one settles", async () => {
    const { token } = await funded();
    await openAnteUpAttempt(token, "easy", 500);
    await resignAnteUp(token);
    await expect(openAnteUpAttempt(token, "easy", 500)).resolves.toBeTruthy();
  });

  it("pays no Ante Up Gold on a won practice (zero-wager) attempt", async () => {
    const { token, id } = await funded();
    await openAnteUpAttempt(token, "easy", 0);
    const result = await solveActiveAttempt(token, id);
    expect(result.status).toBe("won");
    expect(result.payout).toBe(0);
  });
});

describe("daily wagered cap", () => {
  it("refuses a new wagered attempt past the daily limit, but keeps free practice open", async () => {
    const { token } = await funded(1_000_000);

    for (let round = 0; round < ANTE_UP_DAILY_WAGERED_LIMIT; round += 1) {
      await openAnteUpAttempt(token, "easy", 500);
      await resignAnteUp(token);
    }

    await expect(openAnteUpAttempt(token, "easy", 500)).rejects.toBeInstanceOf(AnteUpRequestError);
    // Practice is not a wager, so the cap does not apply to it.
    await expect(openAnteUpAttempt(token, "easy", 0)).resolves.toBeTruthy();
  });
});
