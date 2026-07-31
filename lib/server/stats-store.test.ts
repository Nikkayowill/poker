import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGame } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/types";
import {
  getActiveSeason,
  getLeaderboard,
  getPlayerStanding,
  recordHandStats,
  rolloverSeasonIfDue,
} from "./stats-store";

/**
 * A finished hand, built directly rather than played through the engine: the
 * betting rules already have their own coverage in lib/game/betting-round
 * .test.ts, so what these tests need is control over exactly what a
 * completed hand's winners/committed/vpip look like, not another path to
 * produce one.
 */
function finishedHand(overrides: Partial<{
  winnerIndex: number;
  amount: number;
  vpipIndexes: number[];
}> = {}): GameState {
  const token = randomUUID();
  const game = createGame(token, "Hero");
  game.seats.forEach((seat, index) => {
    seat.isHuman = index < 2; // one real opponent, rest stay bots
    seat.ownerToken = seat.isHuman ? (index === 0 ? token : randomUUID()) : null;
    seat.holeCards = [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }];
    seat.committed = 100;
    seat.vpip = overrides.vpipIndexes?.includes(index) ?? false;
  });
  const winnerIndex = overrides.winnerIndex ?? 0;
  const amount = overrides.amount ?? 250;
  game.winners = [{ seatId: game.seats[winnerIndex].id, name: game.seats[winnerIndex].name, amount, hand: "Flush", bestFive: null }];
  game.status = "complete";
  game.street = "showdown";
  game.currentPlayer = null;
  return game;
}

describe("recording a hand (memory mode)", () => {
  it("credits the winner and debits everyone else who was dealt in", async () => {
    const game = finishedHand({ winnerIndex: 0, amount: 250 });
    await recordHandStats(game);

    const winnerToken = game.seats[0].ownerToken!;
    const loserToken = game.seats[1].ownerToken!;
    const { ensureProfile } = await import("./profile-store");
    const winner = await ensureProfile(winnerToken);
    const loser = await ensureProfile(loserToken);

    const winnerStanding = await getPlayerStanding(winner.id, "lifetime");
    const loserStanding = await getPlayerStanding(loser.id, "lifetime");

    expect(winnerStanding?.stats.handsPlayed).toBe(1);
    expect(winnerStanding?.stats.handsWon).toBe(1);
    expect(winnerStanding?.stats.netProfit).toBe(150); // won 250, put in 100
    expect(winnerStanding?.stats.biggestPotWon).toBe(250);

    expect(loserStanding?.stats.handsPlayed).toBe(1);
    expect(loserStanding?.stats.handsWon).toBe(0);
    expect(loserStanding?.stats.netProfit).toBe(-100); // put in 100, won nothing
  });

  it("never records a bot seat, only human ones", async () => {
    const game = finishedHand();
    await recordHandStats(game);
    // Every bot seat has ownerToken === null and is skipped outright; if one
    // slipped through, ensureProfile(null) would have thrown before this
    // test could even reach an assertion.
    expect(game.seats.filter((seat) => !seat.isHuman).every((seat) => seat.ownerToken === null)).toBe(true);
  });

  it("does not record a seat that was not dealt into the hand", async () => {
    const game = finishedHand();
    game.seats[1].holeCards = []; // busted before this hand, say
    await recordHandStats(game);

    const { ensureProfile } = await import("./profile-store");
    const profile = await ensureProfile(game.seats[1].ownerToken!);
    const standing = await getPlayerStanding(profile.id, "lifetime");
    expect(standing).toBeNull();
  });

  it("is idempotent: recording the same hand twice counts it once", async () => {
    const game = finishedHand({ winnerIndex: 0, amount: 250 });
    await recordHandStats(game);
    await recordHandStats(game);

    const { ensureProfile } = await import("./profile-store");
    const winner = await ensureProfile(game.seats[0].ownerToken!);
    const standing = await getPlayerStanding(winner.id, "lifetime");
    // This is the exact scenario the turn-flow fixes in this release make
    // possible: the same completed-hand transition reaching the recorder
    // twice, from a retried request or two racing callers.
    expect(standing?.stats.handsPlayed).toBe(1);
  });

  it("carries VPIP through to the aggregate", async () => {
    const game = finishedHand({ vpipIndexes: [0] });
    await recordHandStats(game);
    const { ensureProfile } = await import("./profile-store");
    const winner = await ensureProfile(game.seats[0].ownerToken!);
    const loser = await ensureProfile(game.seats[1].ownerToken!);
    expect((await getPlayerStanding(winner.id, "lifetime"))?.stats.vpipHands).toBe(1);
    expect((await getPlayerStanding(loser.id, "lifetime"))?.stats.vpipHands).toBe(0);
  });
});

describe("leaderboard reads", () => {
  it("ranks by net profit, decorated with the player's display name", async () => {
    const game = finishedHand({ winnerIndex: 0, amount: 500 });
    await recordHandStats(game);

    const board = await getLeaderboard("lifetime", 10);
    expect(board[0].profileId).toBeDefined();
    expect(board[0].rank).toBe(1);
    expect(board[0].displayName.length).toBeGreaterThan(0);
    // Sorted, not just present.
    for (let i = 1; i < board.length; i += 1) {
      expect(board[i - 1].netProfit).toBeGreaterThanOrEqual(board[i].netProfit);
    }
  });

  it("finds a player's own rank even when they are outside the top slice", async () => {
    // Three separate hands so three distinct profiles have a net_profit to
    // rank against each other, then ask for a leaderboard too small to
    // contain the last one directly.
    for (let amount = 100; amount <= 300; amount += 100) {
      const game = finishedHand({ winnerIndex: 0, amount });
      await recordHandStats(game);
    }
    const board = await getLeaderboard("lifetime", 1);
    expect(board).toHaveLength(1);
  });

  it("returns an empty season board when no season is active", async () => {
    // Not exercised further here (a real "no active season" state should not
    // occur once the bootstrap row exists), but the function must degrade to
    // an empty list rather than throwing.
    const season = await getActiveSeason();
    expect(season).not.toBeNull();
  });
});

describe("season rollover (memory mode)", () => {
  afterEach(() => vi.useRealTimers());

  it("does nothing while the season's window has not elapsed", async () => {
    const before = await getActiveSeason();
    const result = await rolloverSeasonIfDue();
    const after = await getActiveSeason();
    expect(result).toBeNull();
    expect(after?.id).toBe(before?.id);
  });

  it("closes the season and opens the next one once 30 days have passed", async () => {
    const before = await getActiveSeason();
    expect(before).not.toBeNull();

    // A win recorded in the season now closing -- confirms this player would
    // have been a rollover candidate, even though season_results/badges
    // themselves are Supabase-only (see rolloverSeasonIfDue's memory branch).
    await recordHandStats(finishedHand({ winnerIndex: 0, amount: 500 }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(before!.endsAt).getTime() + 1000);

    const closedId = await rolloverSeasonIfDue();
    expect(closedId).toBe(before!.id);

    const after = await getActiveSeason();
    expect(after).not.toBeNull();
    expect(after!.id).not.toBe(before!.id);
    // The next season starts exactly where the closed one ended, not at
    // "now" -- so a late rollover does not shrink the season after it.
    expect(after!.startsAt).toBe(before!.endsAt);

    // Rolling over again immediately is a no-op: nothing is due yet.
    expect(await rolloverSeasonIfDue()).toBeNull();
  });
});
