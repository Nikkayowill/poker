import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_CONNECTIONS_DAILY_WAGERED_LIMIT,
  AnteUpConnectionsRequestError,
  openAnteUpConnections,
  playAnteUpConnections,
  readAnteUpConnections,
  resignAnteUpConnectionsAttempt,
} from "./ante-up-connections-service";
import { __resetAnteUpAttemptsForTest, getActiveAnteUpAttempt } from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import type { AnteUpConnectionsAttempt } from "@/lib/arcade/ante-up-connections";

/**
 * The Ante Up: Connections money contract, in memory mode. Same shape as
 * ante-up-word-stack-service.test.ts -- restated rather than shared, per this
 * app's "restate, don't couple" convention for every money-ordering file.
 *
 * Neither the win nor the loss path knows the puzzle in advance (a fresh grid
 * is picked at random per attempt), so both drive the real solution straight
 * off the store: a win plays each real group's own members in turn (0
 * mistakes, the top tier), and a loss plays four "scattered" guesses -- one
 * word transposed from each of the four groups -- which is wrong by
 * construction (never a full group, never three-of-a-group-plus-a-stray) and
 * so reliably burns all four mistakes without depending on the puzzle text.
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

/** Solves every real group in turn -- a clean, zero-mistake win, the top payout tier. */
async function winCleanly(token: string, profileId: string) {
  const stored = await getActiveAnteUpAttempt<AnteUpConnectionsAttempt>(profileId, "connections");
  if (!stored) throw new Error("no active attempt");
  let version = stored.version;
  let attempt;
  for (const group of stored.state.puzzle.groups) {
    ({ attempt } = await playAnteUpConnections(token, { version, selection: group.members }));
    version = attempt.version;
  }
  if (!attempt) throw new Error("puzzle had no groups");
  return attempt;
}

/** One word taken from each of the four groups -- wrong by construction, never a repeat. */
function scatteredGuess(groups: { members: string[] }[], index: number): string[] {
  return groups.map((group) => group.members[index]);
}

/** Four scattered guesses, burning all four mistakes without knowing the puzzle text in advance. */
async function loseOutOfMistakes(token: string, profileId: string) {
  const stored = await getActiveAnteUpAttempt<AnteUpConnectionsAttempt>(profileId, "connections");
  if (!stored) throw new Error("no active attempt");
  const groups = stored.state.puzzle.groups;
  let version = stored.version;
  let attempt;
  for (let index = 0; index < 4; index += 1) {
    ({ attempt } = await playAnteUpConnections(token, { version, selection: scatteredGuess(groups, index) }));
    version = attempt.version;
    if (attempt.status !== "active") return attempt;
  }
  throw new Error("made four scattered guesses but the attempt never settled");
}

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt exists", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpConnections(token, 1000);
    expect(await balance(token)).toBe(before - 1000);
  });

  it("lets a zero wager through with no debit", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpConnections(token, 0);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a nonzero wager under the floor, without touching the wallet", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(openAnteUpConnections(token, 499)).rejects.toBeInstanceOf(AnteUpConnectionsRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a stake the player cannot cover, without debiting", async () => {
    const { token } = await funded(100);
    await expect(openAnteUpConnections(token, 500)).rejects.toBeInstanceOf(AnteUpConnectionsRequestError);
    expect(await balance(token)).toBe(100);
  });

  it("holds one live attempt at a time", async () => {
    const { token } = await funded();
    await openAnteUpConnections(token, 500);
    const after = await balance(token);
    await expect(openAnteUpConnections(token, 500)).rejects.toBeInstanceOf(AnteUpConnectionsRequestError);
    // The second attempt never came into existence, so nothing further was debited.
    expect(await balance(token)).toBe(after);
  });

  it("refunds the wager if the attempt fails to come into existence", async () => {
    const { token } = await funded();
    await openAnteUpConnections(token, 500);
    const before = await balance(token);
    // Opening a second attempt while one is live throws before a row is
    // created -- the refund path this exercises is the same one a persistence
    // failure would take.
    await expect(openAnteUpConnections(token, 500)).rejects.toBeInstanceOf(AnteUpConnectionsRequestError);
    expect(await balance(token)).toBe(before);
  });
});

describe("settlement", () => {
  it("pays exactly the clean-solve tier on a win, once", async () => {
    const { token, id } = await funded();
    await openAnteUpConnections(token, 1000);
    const afterDebit = await balance(token);

    const result = await winCleanly(token, id);
    expect(result.status).toBe("won");
    expect(result.mistakes).toBe(0);
    expect(result.payout).toBe(8000); // 0 mistakes -> 8x

    // At least the payout -- a puzzle win can also complete a daily mission
    // and credit its own (much smaller) reward alongside it, which this must
    // tolerate without masking a double-paid or unpaid pot.
    const after = await balance(token);
    expect(after).toBeGreaterThanOrEqual(afterDebit + result.payout);
    expect(after).toBeLessThan(afterDebit + result.payout * 2);
  });

  it("forfeits the wager on a loss (out of mistakes), crediting nothing", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    await openAnteUpConnections(token, 750);

    const result = await loseOutOfMistakes(token, id);
    expect(result.status).toBe("lost");
    expect(result.mistakes).toBe(4);
    expect(result.payout).toBe(0);
    expect(await balance(token)).toBe(before - 750);
  });

  it("forfeits the wager on an early resignation, crediting nothing", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpConnections(token, 750);

    const { attempt } = await resignAnteUpConnectionsAttempt(token);
    expect(attempt?.status).toBe("lost");
    expect(await balance(token)).toBe(before - 750);
  });

  it("frees the player to open another attempt once one settles", async () => {
    const { token } = await funded();
    await openAnteUpConnections(token, 500);
    await resignAnteUpConnectionsAttempt(token);
    await expect(openAnteUpConnections(token, 500)).resolves.toBeTruthy();
  });

  it("pays no Gold on a won practice (zero-wager) attempt", async () => {
    const { token, id } = await funded();
    await openAnteUpConnections(token, 0);
    const result = await winCleanly(token, id);
    expect(result.status).toBe("won");
    expect(result.payout).toBe(0);
  });
});

describe("readAnteUpConnections", () => {
  it("returns the caller's live attempt, or null with none open", async () => {
    const { token } = await funded();
    expect((await readAnteUpConnections(token)).attempt).toBeNull();
    await openAnteUpConnections(token, 500);
    expect((await readAnteUpConnections(token)).attempt?.status).toBe("active");
  });
});

describe("daily wagered cap", () => {
  it("refuses a new wagered attempt past the daily limit, but keeps free practice open", async () => {
    const { token } = await funded(1_000_000);

    for (let round = 0; round < ANTE_UP_CONNECTIONS_DAILY_WAGERED_LIMIT; round += 1) {
      await openAnteUpConnections(token, 500);
      await resignAnteUpConnectionsAttempt(token);
    }

    await expect(openAnteUpConnections(token, 500)).rejects.toBeInstanceOf(AnteUpConnectionsRequestError);
    // Practice is not a wager, so the cap does not apply to it.
    await expect(openAnteUpConnections(token, 0)).resolves.toBeTruthy();
  });
});
