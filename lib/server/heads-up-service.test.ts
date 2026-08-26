import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyPlayerAction } from "@/lib/game/engine";
import { TIER_CONFIG } from "@/lib/game/tiers";
import { getStoredGame, updateStoredGame } from "./game-store";
import {
  HeadsUpRequestError,
  joinHeadsUpTable,
  leaveHeadsUpTable,
  openHeadsUpInvite,
  openHeadsUpQuickPlay,
  readMyHeadsUpTable,
  readPendingHeadsUpInviteFor,
  settleHeadsUpIfFinished,
} from "./heads-up-service";
import { __resetHeadsUpTablesForTest } from "./heads-up-store";
import { __resetHeadToHeadMemory, getHeadToHeadRecords } from "./head-to-head-store";
import { __resetLeaderboardMemory, getGameLeaderboard } from "./leaderboard-store";
import { adjustGold, ensureProfile } from "./profile-store";

/**
 * The heads-up money contract, in memory mode. Same conservation argument
 * cribbage-service.test.ts makes: no house, so the two seated players'
 * COMBINED balance must be exactly what it was before either staked
 * anything, whatever actually happened along the way.
 */

const STAKE = TIER_CONFIG["1k"].minBuyIn;

async function funded(gold = 10_000) {
  const token = randomUUID();
  const profile = await ensureProfile(token);
  const delta = gold - profile.goldBalance;
  if (delta !== 0) await adjustGold(profile.id, delta);
  return { token, id: profile.id };
}

async function balance(token: string): Promise<number> {
  return (await ensureProfile(token)).goldBalance;
}

async function pair(gold = 10_000) {
  const [a, b] = await Promise.all([funded(gold), funded(gold)]);
  return {
    a,
    b,
    async total() {
      return (await balance(a.token)) + (await balance(b.token));
    },
  };
}

beforeEach(() => {
  __resetHeadsUpTablesForTest();
  __resetLeaderboardMemory();
  __resetHeadToHeadMemory();
});

describe("quick play", () => {
  it("debits the first seeker and opens a waiting table, seated at seat 0", async () => {
    const { a } = await pair();
    const before = await balance(a.token);

    const { table } = await openHeadsUpQuickPlay(a.token, "1k");
    expect(await balance(a.token)).toBe(before - STAKE);
    expect(table.status).toBe("waiting");
    expect(table.yourSeat).toBe(0);
    expect(table.isHost).toBe(true);
    expect(table.gameId).toBeNull();
  });

  it("matches a second seeker into the first's open table and deals immediately", async () => {
    const { a, b } = await pair();
    const { table: opened } = await openHeadsUpQuickPlay(a.token, "1k");

    const { table: matched } = await openHeadsUpQuickPlay(b.token, "1k");
    expect(matched.id).toBe(opened.id);
    expect(matched.status).toBe("active");
    expect(matched.gameId).not.toBeNull();
    expect(matched.players).toHaveLength(2);
    expect(new Set(matched.players.map((p) => p.profileId)).size).toBe(2);
  });

  it("never matches a seeker into their own open table", async () => {
    const { a } = await pair();
    const { table: opened } = await openHeadsUpQuickPlay(a.token, "1k");
    // A second quick-play call from the SAME player must not "match" their
    // own table -- that would seat one person in both chairs.
    await expect(openHeadsUpQuickPlay(a.token, "1k")).rejects.toBeInstanceOf(HeadsUpRequestError);
    const { table: stillWaiting } = await readMyHeadsUpTable(a.token);
    expect(stillWaiting?.id).toBe(opened.id);
    expect(stillWaiting?.status).toBe("waiting");
  });

  it("opens a separate table once the first is full, rather than overfilling it", async () => {
    const { a, b } = await pair();
    const c = await funded();
    await openHeadsUpQuickPlay(a.token, "1k");
    const { table: full } = await openHeadsUpQuickPlay(b.token, "1k");
    expect(full.status).toBe("active");

    const { table: fresh } = await openHeadsUpQuickPlay(c.token, "1k");
    expect(fresh.id).not.toBe(full.id);
    expect(fresh.status).toBe("waiting");
  });

  it("rejects a seeker who cannot afford the tier, without opening a table", async () => {
    const poor = await funded(500);
    await expect(openHeadsUpQuickPlay(poor.token, "1k")).rejects.toThrow(/need/i);
    const { table } = await readMyHeadsUpTable(poor.token);
    expect(table).toBeNull();
  });
});

describe("inviting a friend", () => {
  it("reserves the table for the invitee and refuses everyone else", async () => {
    const { a, b } = await pair();
    const stranger = await funded();

    const { table } = await openHeadsUpInvite(a.token, "1k", b.id);
    expect(table.status).toBe("waiting");

    await expect(joinHeadsUpTable(stranger.token, table.id)).rejects.toThrow(/reserved/i);
    const { table: joined } = await joinHeadsUpTable(b.token, table.id);
    expect(joined.status).toBe("active");
    expect(joined.players.map((p) => p.profileId).sort()).toEqual([a.id, b.id].sort());
  });

  it("surfaces the invite to the invitee's own pending-invite read", async () => {
    const { a, b } = await pair();
    const { table } = await openHeadsUpInvite(a.token, "1k", b.id);

    const pending = await readPendingHeadsUpInviteFor(b.id);
    expect(pending.map((t) => t.id)).toContain(table.id);

    // Not the inviter's own read -- this is "invites addressed to me", not
    // "tables I opened".
    const notMine = await readPendingHeadsUpInviteFor(a.id);
    expect(notMine.map((t) => t.id)).not.toContain(table.id);
  });

  it("an open quick-play seeker never matches into an invite-locked table", async () => {
    const { a, b } = await pair();
    const seeker = await funded();
    await openHeadsUpInvite(a.token, "1k", b.id);

    const { table } = await openHeadsUpQuickPlay(seeker.token, "1k");
    expect(table.status).toBe("waiting"); // opened their own, didn't match the reserved one
  });
});

describe("leaving before the deal", () => {
  it("refunds exactly once, and rejects a second leave", async () => {
    const a = await funded();
    const { table } = await openHeadsUpQuickPlay(a.token, "1k");
    const before = await balance(a.token);

    await leaveHeadsUpTable(a.token, table.id);
    expect(await balance(a.token)).toBe(before + STAKE);

    await expect(leaveHeadsUpTable(a.token, table.id)).rejects.toBeInstanceOf(HeadsUpRequestError);
    expect(await balance(a.token)).toBe(before + STAKE);
  });
});

describe("playing a match to completion", () => {
  /**
   * Forces the dealt game straight to a bust: seat 0 checks down a river
   * where seat 1 is already covered for its whole stack, mirroring
   * lib/game/heads-up.test.ts's own engine-level scenario. This exercises
   * the SERVICE's settlement wiring (game_id lookup, seat-position ->
   * profile mapping, the credit, the leaderboard write), not the betting
   * rounds themselves -- those are the engine's own job and already tested
   * in lib/game/heads-up.test.ts.
   */
  async function forceLoserBust(gameId: string, winnerToken: string) {
    const state = await getStoredGame(gameId);
    if (!state) throw new Error("no such game");
    state.status = "playing";
    state.street = "river";
    state.community = [
      { rank: "2", suit: "clubs" }, { rank: "3", suit: "diamonds" }, { rank: "7", suit: "hearts" },
      { rank: "8", suit: "spades" }, { rank: "9", suit: "clubs" },
    ];
    state.currentPlayer = 0;
    state.currentBet = 0;
    state.seats.forEach((seat) => {
      seat.acted = true;
      seat.streetBet = 0;
    });
    state.seats[0].acted = false;
    state.seats[0].status = "active";
    state.seats[0].stack = 500;
    state.seats[0].committed = 500;
    state.seats[0].holeCards = [{ rank: "A", suit: "spades" }, { rank: "A", suit: "diamonds" }];
    state.seats[1].status = "all-in";
    state.seats[1].stack = 0;
    state.seats[1].committed = 500;
    state.seats[1].holeCards = [{ rank: "K", suit: "spades" }, { rank: "K", suit: "diamonds" }];

    const handOver = applyPlayerAction(state, { type: "check" }, winnerToken);
    await updateStoredGame(handOver, { type: "check" }, winnerToken);
    // The match isn't flagged finished until the NEXT hand's setup runs
    // (setupHand's funded<2 check) -- see heads-up.test.ts's own note.
    const finished = applyPlayerAction(handOver, { type: "next-hand" }, winnerToken);
    await updateStoredGame(finished, { type: "next-hand" }, winnerToken);
    return finished;
  }

  it("pays the winner the full pot exactly once, with Gold conserved across the pair", async () => {
    const { a, b, total } = await pair();
    const before = await total();
    const aBefore = await balance(a.token);
    const bBefore = await balance(b.token);

    // a opens (seat 0), b matches (seat 1) -- deterministic seat order.
    const { table: opened } = await openHeadsUpQuickPlay(a.token, "1k");
    const { table: matched } = await openHeadsUpQuickPlay(b.token, "1k");
    expect(matched.id).toBe(opened.id);
    expect(matched.gameId).not.toBeNull();

    const finished = await forceLoserBust(matched.gameId!, a.token);
    expect(finished.tournament?.winnerProfileId).toBe(finished.seats[0].profileId);

    await settleHeadsUpIfFinished(finished);
    expect(await balance(a.token)).toBe(aBefore - STAKE + STAKE * 2); // net +STAKE
    expect(await balance(b.token)).toBe(bBefore - STAKE); // lost their stake
    expect(await total()).toBe(before); // zero-sum within the pair -- no house, no rake.

    // A second settlement attempt (the actions route and the advance route
    // can both discover the same finish) must be a safe no-op, not a second
    // payout -- rule 2/3 in this file's own header.
    await settleHeadsUpIfFinished(finished);
    expect(await total()).toBe(before);

    const h2h = await getHeadToHeadRecords(a.id, [b.id]);
    expect(h2h.get(b.id)?.wins).toBe(1);
  });

  it("settles a match ended by forfeit (leaving mid-match) the same way as a natural bust", async () => {
    const { a, b, total } = await pair();
    const before = await total();
    const { table: opened } = await openHeadsUpQuickPlay(a.token, "1k");
    const { table: matched } = await openHeadsUpQuickPlay(b.token, "1k");
    expect(matched.id).toBe(opened.id);

    const state = await getStoredGame(matched.gameId!);
    if (!state) throw new Error("no such game");
    // Leaving mid-hand is refused (engine.ts) -- simulate the between-hands
    // window a real leave has to land in.
    state.status = "complete";
    const afterLeave = applyPlayerAction(state, { type: "leave-seat" }, a.token);
    await updateStoredGame(afterLeave, { type: "leave-seat" }, a.token);
    expect(afterLeave.seats[0].status).toBe("out");
    // Forfeiting zeroes the seat but doesn't itself decide the match -- same
    // lazy detection heads-up.test.ts pins: the winner is only recorded once
    // the next setupHand call finds fewer than two funded seats.
    expect(afterLeave.tournament?.winnerProfileId).toBeNull();

    const finished = applyPlayerAction(afterLeave, { type: "next-hand" }, b.token);
    await updateStoredGame(finished, { type: "next-hand" }, b.token);
    expect(finished.tournament?.winnerProfileId).toBe(finished.seats[1].profileId); // b's seat

    await settleHeadsUpIfFinished(finished);
    expect(await balance(b.token)).toBeGreaterThan(await balance(a.token));
    expect(await total()).toBe(before);
  });

  describe("per-game leaderboard stats", () => {
    it("credits a win to the winner and a loss to the other seat, once qualified", async () => {
      const { a, b } = await pair();

      // Three matches, same two players -- winLossRecordContract's minSample
      // (3) has to clear before a ranked row shows up at all, same reasoning
      // cribbage-service.test.ts's own leaderboard test loops for.
      for (let round = 0; round < 3; round += 1) {
        await openHeadsUpQuickPlay(a.token, "1k");
        const { table: matched } = await openHeadsUpQuickPlay(b.token, "1k");
        const finished = await forceLoserBust(matched.gameId!, a.token);
        await settleHeadsUpIfFinished(finished);
      }

      const board = await getGameLeaderboard("heads-up", 10);
      const aRow = board.find((row) => row.profileId === a.id);
      expect(aRow?.stats.wins).toBe(3);
      const bRow = board.find((row) => row.profileId === b.id);
      expect(bRow?.stats.losses).toBe(3);
    });
  });
});
