import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Duel escrow paths that only go wrong when something fails partway: a sweep
 * run by another player, an accept that throws after its claim, a challenger
 * who never makes the first move, and a payout replayed by hand.
 *
 * The match store and the block check are wrapped so a test can make them
 * throw at the exact point a real outage would. Everything else is the real
 * memory-mode code.
 */

const hooks = vi.hoisted(() => ({
  beforeCreateMatch: null as null | (() => Promise<void>),
  afterCreateMatch: null as null | (() => Promise<void>),
  blocked: null as null | (() => Promise<boolean>),
}));

vi.mock("./pvp-match-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pvp-match-store")>();
  return {
    ...actual,
    createPvpMatch: async (input: Parameters<typeof actual.createPvpMatch>[0]) => {
      if (hooks.beforeCreateMatch) await hooks.beforeCreateMatch();
      const match = await actual.createPvpMatch(input);
      if (hooks.afterCreateMatch) await hooks.afterCreateMatch();
      return match;
    },
  };
});

vi.mock("./friends-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./friends-store")>();
  return {
    ...actual,
    isBlockedEitherWay: async (a: string, b: string) =>
      hooks.blocked ? hooks.blocked() : actual.isBlockedEitherWay(a, b),
  };
});

import {
  DuelRequestError,
  OPENING_MOVE_WINDOW_MS,
  STRANDED_CLAIM_AFTER_MS,
  acceptDuelChallenge,
  cancelDuelChallenge,
  listDuelChallenges,
  openDuelChallenge,
  playDuelMove,
  readDuelMatch,
  resignDuelMatch,
  sweepStrandedDuelClaims,
} from "./pvp-match-service";
import { __resetHeadToHeadMemory, getHeadToHeadRecords } from "./head-to-head-store";
import { __resetLeaderboardMemory } from "./leaderboard-store";
import {
  __resetPvpChallengesForTest,
  claimChallenge,
  listStrandedClaims,
} from "./pvp-challenge-store";
import {
  ActivePvpMatchExists,
  __resetPvpMatchesForTest,
  createPvpMatch,
  getPvpMatchByChallengeId,
} from "./pvp-match-store";
import { adjustGold, creditGoldByProfileLedgered, ensureProfile } from "./profile-store";

const STAKE = 1000;
const START = 10_000;

async function funded(gold = START) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

/** Ledger rows written under this key, credit side. */
function credits(correlationId: string): number {
  return globalThis.__riverGoldLedger?.has(`${correlationId}:credit`) ? 1 : 0;
}

let clock = Date.parse("2026-09-25T12:00:00.000Z");
function advance(ms: number) {
  clock += ms;
  vi.setSystemTime(clock);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  hooks.beforeCreateMatch = null;
  hooks.afterCreateMatch = null;
  hooks.blocked = null;
  __resetPvpChallengesForTest();
  __resetPvpMatchesForTest();
  __resetLeaderboardMemory();
  __resetHeadToHeadMemory();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("expired challenges swept by someone else", () => {
  it("refunds a stale challenge exactly once when another player's open sweeps it", async () => {
    const a = await funded();
    const b = await funded();
    const c = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    expect(await balance(a.token)).toBe(START - STAKE);

    advance(11 * 60_000);

    // B's open sweeps A's lapsed row. The sweep used to drop what it reclaimed.
    await openDuelChallenge(b.token, "chess", STAKE, null);
    expect(await balance(a.token)).toBe(START);

    // Later sweeps find nothing left to refund.
    await openDuelChallenge(c.token, "checkers", STAKE, null);
    await listDuelChallenges(c.token, "chess");
    expect(await balance(a.token)).toBe(START);
    expect(credits(`pvp_challenge_stake:${challenge.id}`)).toBe(1);
  });
});

describe("a failed accept", () => {
  it("cancels and refunds the challenger when the claim cannot be reopened", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);

    // While B's accept is in flight, A opens a second chess challenge, so
    // reopening the first would clash with the one-open-per-game index.
    hooks.beforeCreateMatch = async () => {
      hooks.beforeCreateMatch = null;
      await openDuelChallenge(a.token, "chess", STAKE, null);
      throw new ActivePvpMatchExists("chess");
    };

    await expect(acceptDuelChallenge(b.token, challenge.id)).rejects.toBeInstanceOf(DuelRequestError);

    // A holds only the second challenge's escrow, B paid nothing.
    expect(await balance(a.token)).toBe(START - STAKE);
    expect(await balance(b.token)).toBe(START);
    const { challenges } = await listDuelChallenges(b.token, "chess");
    expect(challenges.map((entry) => entry.id)).not.toContain(challenge.id);

    // Nothing stranded, so a later sweep pays nothing more.
    advance(STRANDED_CLAIM_AFTER_MS + 1);
    expect(await sweepStrandedDuelClaims()).toEqual({ refunded: 0, linked: 0 });
    expect(credits(`pvp_challenge_stake:${challenge.id}`)).toBe(1);
  });

  it("reopens the claim when the block check throws after it", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);

    hooks.blocked = async () => {
      throw new Error("friends store down");
    };
    await expect(acceptDuelChallenge(b.token, challenge.id)).rejects.toThrow("friends store down");
    expect(await balance(b.token)).toBe(START);

    // Back in the pool, and acceptable once the outage clears.
    hooks.blocked = null;
    const { match } = await acceptDuelChallenge(b.token, challenge.id);
    expect(match.pot).toBe(STAKE * 2);
  });

  it("refunds the acceptor under the ledgered key when the match insert fails", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);

    hooks.beforeCreateMatch = async () => {
      throw new Error("insert failed");
    };
    await expect(acceptDuelChallenge(b.token, challenge.id)).rejects.toThrow("insert failed");

    expect(await balance(b.token)).toBe(START);
    expect(await balance(a.token)).toBe(START - STAKE);
    const acceptRefunds = [...(globalThis.__riverGoldLedger?.entries() ?? [])].filter(
      ([key, entry]) => entry.profileId === b.id && key.startsWith("pvp_accept_stake:") && key.endsWith(":credit"),
    );
    expect(acceptRefunds).toHaveLength(1);
    const { challenges } = await listDuelChallenges(b.token, "chess");
    expect(challenges.map((entry) => entry.id)).toContain(challenge.id);
  });

  it("keeps a match whose insert landed but reported failure", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);

    hooks.afterCreateMatch = async () => {
      throw new Error("connection reset");
    };
    const { match } = await acceptDuelChallenge(b.token, challenge.id);

    // Not refunded: both stakes are in a live pot.
    expect(await balance(a.token) + await balance(b.token)).toBe(START * 2 - STAKE * 2);
    expect((await getPvpMatchByChallengeId(challenge.id))?.id).toBe(match.id);
    expect(await listStrandedClaims(new Date(Date.now() + STRANDED_CLAIM_AFTER_MS))).toHaveLength(0);
  });
});

describe("stranded claims", () => {
  it("refunds a claim that never became a match, exactly once", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    // The process dies right after the claim.
    expect(await claimChallenge(challenge.id, b.id)).not.toBeNull();

    // Too young to be anything but an accept still in flight.
    expect(await sweepStrandedDuelClaims()).toEqual({ refunded: 0, linked: 0 });
    expect(await balance(a.token)).toBe(START - STAKE);

    advance(STRANDED_CLAIM_AFTER_MS + 1);
    expect(await sweepStrandedDuelClaims()).toEqual({ refunded: 1, linked: 0 });
    expect(await balance(a.token)).toBe(START);

    expect(await sweepStrandedDuelClaims()).toEqual({ refunded: 0, linked: 0 });
    expect(await balance(a.token)).toBe(START);
    expect(await balance(b.token)).toBe(START);
  });

  it("links a match the claim never recorded, and refunds nothing", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    await claimChallenge(challenge.id, b.id);
    // The process dies between writing the match and linking it.
    await createPvpMatch({
      id: randomUUID(),
      challengeId: challenge.id,
      game: "chess",
      players: [a.id, b.id],
      tier: "custom",
      stake: STAKE,
      state: {},
    });

    advance(STRANDED_CLAIM_AFTER_MS + 1);
    expect(await sweepStrandedDuelClaims()).toEqual({ refunded: 0, linked: 1 });
    expect(await balance(a.token)).toBe(START - STAKE);
    expect(await sweepStrandedDuelClaims()).toEqual({ refunded: 0, linked: 0 });
  });
});

describe("the first move", () => {
  async function started() {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    const { match } = await acceptDuelChallenge(b.token, challenge.id);
    return { a, b, match };
  }

  it("calls the match off and returns both stakes once when the challenger never moves", async () => {
    const { a, b, match } = await started();
    advance(OPENING_MOVE_WINDOW_MS);

    const { match: read } = await readDuelMatch(b.token, "chess");
    expect(read?.status).toBe("settled");
    expect(read?.winnerSeat).toBeNull();
    expect(read?.outcome).toEqual({ winner: null, reason: "No first move" });
    expect(await balance(a.token)).toBe(START);
    expect(await balance(b.token)).toBe(START);

    // Reading again, or resigning, pays nothing more.
    await readDuelMatch(a.token, "chess");
    await resignDuelMatch(b.token, match.id);
    expect(await balance(a.token)).toBe(START);
    expect(await balance(b.token)).toBe(START);

    // Not a draw on anybody's record.
    expect((await getHeadToHeadRecords(a.id, [b.id])).get(b.id)).toBeUndefined();
  });

  it.each(["mancala", "liars-dice"] as const)(
    "calls off a %s match the challenger never opens, now that it runs a clock",
    async (game) => {
      const a = await funded();
      const b = await funded();
      const { challenge } = await openDuelChallenge(a.token, game, STAKE, null);
      await acceptDuelChallenge(b.token, challenge.id);
      advance(OPENING_MOVE_WINDOW_MS);

      const { match: read } = await readDuelMatch(b.token, game);
      expect(read?.outcome).toEqual({ winner: null, reason: "No first move" });
      expect(await balance(a.token)).toBe(START);
      expect(await balance(b.token)).toBe(START);
    },
  );

  it("refuses a first move that comes after the window, and refunds both", async () => {
    const { a, b, match } = await started();
    const { match: seen } = await readDuelMatch(a.token, "chess");
    const move = (seen?.state as { legalMoves: unknown[] }).legalMoves[0];

    advance(OPENING_MOVE_WINDOW_MS + 1);
    await expect(
      playDuelMove(a.token, { matchId: match.id, version: seen!.version, move }),
    ).rejects.toBeInstanceOf(DuelRequestError);
    expect(await balance(a.token)).toBe(START);
    expect(await balance(b.token)).toBe(START);
  });

  it("lets a match run normally once the challenger has moved", async () => {
    const { a, b, match } = await started();
    const { match: seen } = await readDuelMatch(a.token, "chess");
    const move = (seen?.state as { legalMoves: unknown[] }).legalMoves[0];
    await playDuelMove(a.token, { matchId: match.id, version: seen!.version, move });

    advance(OPENING_MOVE_WINDOW_MS * 2);
    const { match: read } = await readDuelMatch(b.token, "chess");
    expect(read?.status).toBe("active");
    expect(await balance(a.token) + await balance(b.token)).toBe(START * 2 - STAKE * 2);
  });
});

describe("ledgered payouts", () => {
  it("pays a win under the match key, so a replay pays nothing", async () => {
    const a = await funded();
    const b = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    const { match } = await acceptDuelChallenge(b.token, challenge.id);
    await resignDuelMatch(b.token, match.id);
    expect(await balance(a.token)).toBe(START + STAKE);

    const replay = await creditGoldByProfileLedgered(a.id, STAKE * 2, `pvp_match_payout:${match.id}:0`, "replay");
    expect(replay).toMatchObject({ success: true, alreadyApplied: true });
    expect(await balance(a.token)).toBe(START + STAKE);
  });

  it("refunds a cancel under the challenge key, so a replay pays nothing", async () => {
    const a = await funded();
    const { challenge } = await openDuelChallenge(a.token, "chess", STAKE, null);
    await cancelDuelChallenge(a.token, challenge.id);
    expect(await balance(a.token)).toBe(START);

    const replay = await creditGoldByProfileLedgered(a.id, STAKE, `pvp_challenge_stake:${challenge.id}`, "replay");
    expect(replay).toMatchObject({ success: true, alreadyApplied: true });
    expect(await balance(a.token)).toBe(START);
  });
});
