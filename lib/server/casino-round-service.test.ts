import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetArcadeRoundsForTest } from "./arcade-round-store";
import {
  CasinoRequestError,
  openCasinoRound,
  readCasinoRound,
  settleCasinoRound,
  type CasinoGame,
} from "./casino-round-service";
import { adjustGold, ensureProfile } from "./profile-store";

/**
 * The money contract every wager game in the arcade now shares.
 *
 * This is the module the four new casino games route their Gold through, so a
 * bug here is a bug in all four at once -- which is the whole reason it exists
 * as one module rather than four copies, and the reason it is worth testing
 * directly rather than only through a game.
 *
 * The test game below is deliberately trivial and fully deterministic: no
 * deck, no randomness, and an outcome chosen by the caller. That is the point.
 * The games' own arithmetic is pinned exactly on their pure functions
 * (lib/arcade/*.test.ts); what is checked here is the *ordering* -- who is
 * debited when, what happens when a step fails, and that nothing pays twice.
 */

interface TestRound {
  stake: number;
  /** What this round will pay back gross once settled. Set by the test. */
  gross: number;
  settled: boolean;
  /** Present only to prove the snapshot boundary drops it. */
  secret: string;
}

interface TestSnapshot {
  id: string;
  stake: number;
  gross: number;
  settled: boolean;
}

const STAKE = 1000;

/**
 * The id of the caller's live round.
 *
 * The service checks an id and a version against the round it found rather
 * than looking one up by id, so a test needs the real one. Read back through
 * the public read path on purpose: it means these tests reach the round the
 * same way a route does, through the snapshot boundary.
 */
async function roundId(token: string, forGame = game): Promise<string> {
  const view = await readCasinoRound(forGame, token);
  if (!view.round) throw new Error("no live round to address");
  return view.round.id;
}

/** How much the next `deal` should promise to pay back. Reset per test. */
let grossToPay = 0;
/** Set to make `deal` throw, standing in for an engine guarding a precondition. */
let dealThrows = false;

const game: CasinoGame<TestRound, TestSnapshot, undefined> = {
  id: "test-casino-game",
  label: "Test Game",
  snapshot: (stored) => ({
    id: stored.id,
    stake: stored.round.stake,
    gross: stored.round.gross,
    settled: stored.round.settled,
  }),
  deal: (stake) => {
    if (dealThrows) throw new Error("the engine refused this round");
    return { stake, gross: grossToPay, settled: false, secret: "the deck" };
  },
  payout: (round) => (round.settled ? round.gross : 0),
};

async function funded(gold: number) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  await adjustGold(profile.id, gold - profile.goldBalance);
  return token;
}

function settle(round: TestRound) {
  return { next: { ...round, settled: true }, settled: true };
}

beforeEach(() => {
  __resetArcadeRoundsForTest();
  grossToPay = 0;
  dealThrows = false;
});

describe("rule 1 -- the stake leaves before the round exists", () => {
  it("debits the stake on the deal", async () => {
    const token = await funded(5000);
    const result = await openCasinoRound(game, token, "1k", undefined);
    expect(result.resumed).toBe(false);
    expect(result.profile.goldBalance).toBe(4000);
    expect(result.round?.stake).toBe(STAKE);
  });

  it("refuses a stake the wallet cannot cover, and charges nothing", async () => {
    const token = await funded(999);
    await expect(openCasinoRound(game, token, "1k", undefined)).rejects.toBeInstanceOf(CasinoRequestError);
    const after = await readCasinoRound(game, token);
    expect(after.profile.goldBalance).toBe(999);
    expect(after.round).toBeNull();
  });

  it("refunds when the round cannot be built, rather than keeping the stake", async () => {
    // The hole this test exists for: `deal` used to run after the debit but
    // outside the refund path, so an engine throwing its own precondition took
    // the stake and gave back nothing.
    const token = await funded(5000);
    dealThrows = true;
    await expect(openCasinoRound(game, token, "1k", undefined)).rejects.toThrow(/refused/);
    const after = await readCasinoRound(game, token);
    expect(after.profile.goldBalance).toBe(5000);
    expect(after.round).toBeNull();
  });

  it("rejects an invalid choice before the wallet is touched at all", async () => {
    const picky: CasinoGame<TestRound, TestSnapshot, string> = {
      ...game,
      validate: (side) => (side === "ok" ? null : "That is not a bet this layout offers."),
      deal: (stake) => ({ stake, gross: 0, settled: false, secret: "the deck" }),
    };
    const token = await funded(5000);
    await expect(openCasinoRound(picky, token, "1k", "nonsense")).rejects.toBeInstanceOf(CasinoRequestError);
    const after = await readCasinoRound(picky, token);
    expect(after.profile.goldBalance).toBe(5000);
    expect(after.round).toBeNull();
  });
});

describe("resuming rather than dealing twice", () => {
  it("hands back a live round instead of taking a second stake", async () => {
    const token = await funded(5000);
    await openCasinoRound(game, token, "1k", undefined);
    const again = await openCasinoRound(game, token, "1k", undefined);
    expect(again.resumed).toBe(true);
    expect(again.profile.goldBalance).toBe(4000);
  });

  it("resumes at the same stake even when a different tier is asked for", async () => {
    const token = await funded(50_000);
    await openCasinoRound(game, token, "1k", undefined);
    const again = await openCasinoRound(game, token, "10k", undefined);
    expect(again.resumed).toBe(true);
    expect(again.round?.stake).toBe(STAKE);
    expect(again.profile.goldBalance).toBe(49_000);
  });

  it("charges exactly one stake under concurrent deals", async () => {
    const token = await funded(5000);
    const results = await Promise.all([
      openCasinoRound(game, token, "1k", undefined),
      openCasinoRound(game, token, "1k", undefined),
      openCasinoRound(game, token, "1k", undefined),
    ]);
    const opened = results.filter((result) => !result.resumed);
    expect(opened).toHaveLength(1);
    const after = await readCasinoRound(game, token);
    expect(after.profile.goldBalance).toBe(4000);
  });
});

describe("rule 2 -- a payout is credited only after the guarded write", () => {
  it("credits a winning round once", async () => {
    const token = await funded(5000);
    grossToPay = 3600;
    const opened = await openCasinoRound(game, token, "1k", undefined);
    expect(opened.profile.goldBalance).toBe(4000);

    const stored = await readCasinoRound(game, token);
    const settled = await settleCasinoRound(game, token, { roundId: await roundId(token), version: 1 }, settle);
    expect(settled.round?.settled).toBe(true);
    // 5000 - 1000 stake + 3600 gross.
    expect(settled.profile.goldBalance).toBe(7600);
    expect(stored.round).not.toBeNull();
  });

  it("settles exactly once under a double-fired action", async () => {
    const token = await funded(5000);
    grossToPay = 3600;
    await openCasinoRound(game, token, "1k", undefined);

    const id = await roundId(token);
    const results = await Promise.allSettled([
      settleCasinoRound(game, token, { roundId: id, version: 1 }, settle),
      settleCasinoRound(game, token, { roundId: id, version: 1 }, settle),
      settleCasinoRound(game, token, { roundId: id, version: 1 }, settle),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const after = await readCasinoRound(game, token);
    // Paid once, not three times. The version guard is the only thing between
    // this and 5000 - 1000 + 3600 * 3.
    expect(after.profile.goldBalance).toBe(7600);
  });

  it("refuses a stale version and carries the true round back", async () => {
    const token = await funded(5000);
    await openCasinoRound(game, token, "1k", undefined);
    await expect(
      settleCasinoRound(game, token, { roundId: await roundId(token), version: 99 }, settle),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an action addressed at somebody else's round id", async () => {
    const token = await funded(5000);
    await openCasinoRound(game, token, "1k", undefined);
    await expect(
      settleCasinoRound(game, token, { roundId: randomUUID(), version: 1 }, settle),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("404s when there is no round in progress", async () => {
    const token = await funded(5000);
    await expect(
      settleCasinoRound(game, token, { roundId: randomUUID(), version: 1 }, settle),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("turns a rejected action into a 409 and changes nothing", async () => {
    const token = await funded(5000);
    grossToPay = 3600;
    await openCasinoRound(game, token, "1k", undefined);
    await expect(
      settleCasinoRound(game, token, { roundId: await roundId(token), version: 1 }, () => ({
        reject: "not allowed here",
      })),
    ).rejects.toMatchObject({ status: 409 });

    const after = await readCasinoRound(game, token);
    expect(after.round?.settled).toBe(false);
    expect(after.profile.goldBalance).toBe(4000);
  });
});

describe("rule 3 -- settlement is a single credit, never a second debit", () => {
  it("leaves a loser down exactly the stake", async () => {
    const token = await funded(5000);
    grossToPay = 0;
    await openCasinoRound(game, token, "1k", undefined);
    const settled = await settleCasinoRound(game, token, { roundId: await roundId(token), version: 1 }, settle);
    expect(settled.profile.goldBalance).toBe(4000);
  });

  it("returns a pushed stake whole", async () => {
    // A push is `payout === stake`. Read as a *net* it would be a second debit
    // on a hand nobody lost.
    const token = await funded(5000);
    grossToPay = STAKE;
    await openCasinoRound(game, token, "1k", undefined);
    const settled = await settleCasinoRound(game, token, { roundId: await roundId(token), version: 1 }, settle);
    expect(settled.profile.goldBalance).toBe(5000);
  });

  it("holds `final === starting + gross - stake` across every outcome", async () => {
    for (const gross of [0, STAKE, 1500, 36_000]) {
      __resetArcadeRoundsForTest();
      const token = await funded(50_000);
      grossToPay = gross;
      await openCasinoRound(game, token, "1k", undefined);
      const settled = await settleCasinoRound(game, token, { roundId: await roundId(token), version: 1 }, settle);
      expect({ gross, balance: settled.profile.goldBalance }).toEqual({
        gross,
        balance: 50_000 - STAKE + gross,
      });
    }
  });
});

describe("a round that settles on the deal", () => {
  it("is credited after the write, and does not block the next one", async () => {
    const instant: CasinoGame<TestRound, TestSnapshot, undefined> = {
      ...game,
      id: "test-instant-game",
      deal: (stake) => ({ stake, gross: 2000, settled: true, secret: "the deck" }),
      settledOnDeal: () => true,
    };
    const token = await funded(5000);
    const first = await openCasinoRound(instant, token, "1k", undefined);
    expect(first.profile.goldBalance).toBe(6000);

    // Settled rounds do not hold the one-active-round slot, so a second deal
    // is a second round rather than a resume.
    const second = await openCasinoRound(instant, token, "1k", undefined);
    expect(second.resumed).toBe(false);
    expect(second.profile.goldBalance).toBe(7000);
  });
});

describe("the snapshot boundary", () => {
  it("is what the caller sees, not the stored round", async () => {
    const token = await funded(5000);
    await openCasinoRound(game, token, "1k", undefined);
    const view = await readCasinoRound(game, token);
    // `secret` lives on the round and is dropped by `snapshot`. Every path out
    // of this module goes through it, which is the only reason that holds.
    expect(view.round).not.toBeNull();
    expect("secret" in (view.round as object)).toBe(false);
    expect(JSON.stringify(view.round)).not.toContain("the deck");
  });

  it("reports no round for a caller who has not opened one", async () => {
    const view = await readCasinoRound(game, await funded(5000));
    expect(view.round).toBeNull();
  });
});

