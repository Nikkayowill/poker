import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTE_UP_MEMORY_DAILY_WAGERED_LIMIT,
  AnteUpMemoryRequestError,
  flipAnteUpMemory,
  openAnteUpMemory,
  resignAnteUpMemoryAttempt,
} from "./ante-up-memory-service";
import { __resetAnteUpAttemptsForTest, getActiveAnteUpAttempt } from "./ante-up-store";
import { adjustGold, ensureProfile } from "./profile-store";
import { ANTE_UP_MEMORY_MAX_TURNS, MIN_ANTE_UP_WAGER, type AnteUpMemoryAttempt } from "@/lib/arcade/ante-up-memory";
import type { Card } from "@/lib/game/types";

/**
 * The Ante Up: Memory Match money contract, in memory mode.
 *
 * Same three ordering rules as ante-up-service.test.ts (Sudoku) -- the wager
 * leaves exactly once at open, a win credits exactly the settled payout
 * exactly once, and a loss (turn-cap forfeit or resignation) credits nothing
 * at all. The one thing unique to this game: there is no natural loss to
 * drive with a solve-wrong helper, so the forfeit test has to deliberately
 * mismatch the same two tiles over and over until the turn cap is exceeded.
 */

const GAME = "memory-match";

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

/** One tile index per rank -- 8 indices, every one a different rank from every other. */
function distinctRankIndices(tiles: Pick<Card, "rank">[]): number[] {
  const seen = new Set<string>();
  const indices: number[] = [];
  tiles.forEach((tile, index) => {
    if (seen.has(tile.rank)) return;
    seen.add(tile.rank);
    indices.push(index);
  });
  return indices;
}

/**
 * Clears the live attempt by reading the true tile layout straight off the
 * store (the service-side truth, same move ante-up-service.test.ts makes
 * against the Sudoku solution) and pairing every rank in the order it first
 * appears. That always completes a match on its very next flip, so this
 * clears the board in exactly MEMORY_PAIRS turns -- the top payout tier --
 * regardless of how the board was shuffled.
 */
async function clearActiveAttempt(token: string, profileId: string) {
  const stored = await getActiveAnteUpAttempt<AnteUpMemoryAttempt>(profileId, GAME);
  if (!stored) throw new Error("no active attempt");

  const tiles = stored.state.board.tiles;
  const seen = new Map<string, number>();
  const pairs: [number, number][] = [];
  tiles.forEach((card, index) => {
    const prior = seen.get(card.rank);
    if (prior === undefined) {
      seen.set(card.rank, index);
    } else {
      pairs.push([prior, index]);
      seen.delete(card.rank);
    }
  });

  let version = stored.version;
  let attempt;
  for (const [a, b] of pairs) {
    ({ attempt } = await flipAnteUpMemory(token, { version, index: a }));
    version = attempt.version;
    if (attempt.status !== "active") break;
    ({ attempt } = await flipAnteUpMemory(token, { version, index: b }));
    version = attempt.version;
    if (attempt.status !== "active") break;
  }
  if (!attempt) throw new Error("cleared no pairs");
  return attempt;
}

/**
 * Clicks through one tile per rank in rotation until the turn cap forfeits
 * the attempt. Consecutive clicks always land on different ranks, so every
 * turn is a mismatch -- same idiom lib/arcade/ante-up-memory.test.ts's
 * forceMismatches uses, generalized here since the service deals a real
 * shuffled board rather than a hand-ordered one.
 */
async function forfeitByTurnCap(token: string, profileId: string) {
  const stored = await getActiveAnteUpAttempt<AnteUpMemoryAttempt>(profileId, GAME);
  if (!stored) throw new Error("no active attempt");
  const cycle = distinctRankIndices(stored.state.board.tiles);

  let version = stored.version;
  let attempt;
  let step = 0;
  do {
    ({ attempt } = await flipAnteUpMemory(token, { version, index: cycle[step % cycle.length] }));
    version = attempt.version;
    step += 1;
    if (step > 100) throw new Error("stuck forcing a turn-cap forfeit");
  } while (attempt.status === "active");
  return attempt;
}

beforeEach(() => {
  __resetAnteUpAttemptsForTest();
});

describe("wagering", () => {
  it("debits the wager before the attempt exists", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpMemory(token, 1000);
    expect(await balance(token)).toBe(before - 1000);
  });

  it("lets a zero wager through with no debit", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpMemory(token, 0);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a nonzero wager under the floor, without touching the wallet", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await expect(openAnteUpMemory(token, MIN_ANTE_UP_WAGER - 1)).rejects.toBeInstanceOf(AnteUpMemoryRequestError);
    expect(await balance(token)).toBe(before);
  });

  it("refuses a stake the player cannot cover, without debiting", async () => {
    const { token } = await funded(100);
    await expect(openAnteUpMemory(token, 500)).rejects.toBeInstanceOf(AnteUpMemoryRequestError);
    expect(await balance(token)).toBe(100);
  });

  it("refuses opening a failed create's Gold to be lost -- a second attempt never debits again", async () => {
    const { token } = await funded();
    await openAnteUpMemory(token, 500);
    const after = await balance(token);
    await expect(openAnteUpMemory(token, 500)).rejects.toBeInstanceOf(AnteUpMemoryRequestError);
    expect(await balance(token)).toBe(after);
  });
});

describe("settlement", () => {
  it("pays exactly the top multiple on a fastest-possible win, once", async () => {
    const { token, id } = await funded();
    await openAnteUpMemory(token, 1000);
    const afterDebit = await balance(token);

    const result = await clearActiveAttempt(token, id);
    expect(result.status).toBe("won");
    expect(result.turns).toBe(8); // MEMORY_PAIRS -- pairing every rank on sight is the fastest possible clear
    expect(result.payout).toBe(6000); // wager * the top-tier multiplier

    // At least the payout -- a win can also complete a daily mission and
    // credit its own (much smaller) reward alongside it. A win crediting less
    // than the payout, or more than double it, is the real bug this guards.
    const after = await balance(token);
    expect(after).toBeGreaterThanOrEqual(afterDebit + result.payout);
    expect(after).toBeLessThan(afterDebit + result.payout * 2);
  });

  it("forfeits the wager when turns exceed the cap, crediting nothing", async () => {
    const { token, id } = await funded();
    const before = await balance(token);
    await openAnteUpMemory(token, 750);

    const result = await forfeitByTurnCap(token, id);
    expect(result.status).toBe("lost");
    expect(result.turns).toBeGreaterThan(ANTE_UP_MEMORY_MAX_TURNS);
    expect(result.payout).toBe(0);
    expect(await balance(token)).toBe(before - 750);
  });

  it("forfeits the wager on an early resignation, crediting nothing", async () => {
    const { token } = await funded();
    const before = await balance(token);
    await openAnteUpMemory(token, 750);

    const { attempt } = await resignAnteUpMemoryAttempt(token);
    expect(attempt?.status).toBe("lost");
    expect(attempt?.payout).toBe(0);
    expect(await balance(token)).toBe(before - 750);
  });

  it("frees the player to open another attempt once one settles", async () => {
    const { token } = await funded();
    await openAnteUpMemory(token, 500);
    await resignAnteUpMemoryAttempt(token);
    await expect(openAnteUpMemory(token, 500)).resolves.toBeTruthy();
  });

  it("credits no Gold on a won practice (zero-wager) attempt", async () => {
    const { token, id } = await funded();
    await openAnteUpMemory(token, 0);
    const before = await balance(token);
    const result = await clearActiveAttempt(token, id);
    expect(result.status).toBe("won");
    expect(result.payout).toBe(0);
    expect(await balance(token)).toBe(before);
  });
});

describe("daily wagered cap", () => {
  it("refuses a new wagered attempt past the daily limit, but keeps free practice open", async () => {
    const { token } = await funded(1_000_000);

    for (let round = 0; round < ANTE_UP_MEMORY_DAILY_WAGERED_LIMIT; round += 1) {
      await openAnteUpMemory(token, 500);
      await resignAnteUpMemoryAttempt(token);
    }

    await expect(openAnteUpMemory(token, 500)).rejects.toBeInstanceOf(AnteUpMemoryRequestError);
    // Practice is not a wager, so the cap does not apply to it.
    await expect(openAnteUpMemory(token, 0)).resolves.toBeTruthy();
  });
});
