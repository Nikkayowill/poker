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
import { ANTE_UP_TIERS, type AnteUpAttempt } from "@/lib/arcade/ante-up";
import { maxAnteUpWager } from "@/lib/arcade/ante-up-stakes";

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

/** This profile's memory-mode gold_ledger rows, keyed `${correlationId}:${kind}` like the real unique index. */
function ledgerRows(profileId: string) {
  return [...(globalThis.__riverGoldLedger ?? new Map()).entries()]
    .filter(([, row]) => row.profileId === profileId)
    .map(([key, row]) => ({ key, amount: row.amount, kind: row.kind }));
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** Drives a real attempt to a win by reading the true solution straight off the store. */
async function solveActiveAttempt(token: string, profileId: string) {
  let stored = await getActiveAnteUpAttempt<AnteUpAttempt>(profileId, "sudoku");
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
    stored = await getActiveAnteUpAttempt<AnteUpAttempt>(profileId, "sudoku");
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

  it("records the wager as a ledgered debit the reconcile sweep can see", async () => {
    const { token, id } = await funded();
    await openAnteUpAttempt(token, "easy", 1000);
    const [row] = ledgerRows(id);
    expect(row.key).toMatch(/^ante_up_wager:.+:debit$/);
    expect(row.amount).toBe(-1000);
  });

  it("lets a zero wager through with no debit", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    await openAnteUpAttempt(token, "easy", 0);
    expect(await balance(token)).toBe(before);
    expect(ledgerRows(id)).toEqual([]);
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

  /**
   * The wager ceiling that used to live here (git history /
   * 20260827090000_ante_up_wager_tier_ceiling.sql) has been removed: a solo
   * wager is bounded only by the player's own balance. What a big stake
   * changes instead is which grids it may be played on.
   */
  it("has no upper bound beyond the player's own balance, on a grid hard enough for it", async () => {
    expect(maxAnteUpWager("sudoku", "expert")).toBe(Number.POSITIVE_INFINITY);

    const { token } = await funded(50_000_000);
    const { attempt } = await openAnteUpAttempt(token, "expert", 5_000_000);
    expect(attempt.wager).toBe(5_000_000);
  });
});

describe("stake pressure", () => {
  it("refuses a grid too easy for the stake, with the reason, and leaves the wallet alone", async () => {
    const { token } = await funded(5_000_000);
    const cases = [
      ["easy", 10_000, "Medium"],
      ["medium", 100_000, "Hard"],
      ["hard", 1_000_000, "Expert"],
    ] as const;
    for (const [tier, wager, needs] of cases) {
      const attempt = openAnteUpAttempt(token, tier, wager);
      await expect(attempt).rejects.toBeInstanceOf(AnteUpRequestError);
      await expect(attempt).rejects.toThrow(`plays ${needs} or harder`);
    }
    expect(await balance(token)).toBe(5_000_000);
  });

  it("opens the lowest grid each band allows", async () => {
    const cases = [
      ["medium", 10_000],
      ["hard", 100_000],
      ["expert", 1_000_000],
    ] as const;
    for (const [tier, wager] of cases) {
      const { token } = await funded(5_000_000);
      const { attempt } = await openAnteUpAttempt(token, tier, wager);
      expect(attempt.difficulty).toBe(tier);
      expect(attempt.wager).toBe(wager);
    }
  });

  it("leaves free play and small stakes on every grid", async () => {
    for (const tier of ["easy", "medium", "hard", "expert"] as const) {
      for (const wager of [0, 500, 9_999]) {
        const { token } = await funded();
        const { attempt } = await openAnteUpAttempt(token, tier, wager);
        expect(attempt.difficulty).toBe(tier);
      }
    }
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

    const stored = await getActiveAnteUpAttempt<AnteUpAttempt>(id, "sudoku");
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
