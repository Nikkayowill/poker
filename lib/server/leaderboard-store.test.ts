import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import {
  __resetLeaderboardMemory,
  getGameLeaderboard,
  getGameStanding,
  getGlobalLeaderboard,
  getGlobalStanding,
  recordDuelResult,
  recordMetricResult,
  recordMultiWayResult,
} from "./leaderboard-store";
import { ensureProfile } from "./profile-store";
import { recordHandStats } from "./stats-store";

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, id: profile.id };
}

beforeEach(() => {
  __resetLeaderboardMemory();
});

describe("recordDuelResult", () => {
  it("credits a win to the winner and a loss to the loser, from either seat", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");

    await recordDuelResult("chess", [a.id, b.id], 0);

    const [standingA, standingB] = await Promise.all([
      getGameStanding("chess", a.id),
      getGameStanding("chess", b.id),
    ]);
    // Below minSample (3), so no rank yet -- but the raw record still moved.
    expect(standingA).toBeNull();
    expect(standingB).toBeNull();
  });

  it("credits both players a draw, not a win or a loss", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");

    for (let i = 0; i < 3; i += 1) await recordDuelResult("chess", [a.id, b.id], null);

    const board = await getGameLeaderboard("chess", 10);
    const rowA = board.find((row) => row.profileId === a.id)!;
    expect(rowA.stats).toEqual({ wins: 0, losses: 0, draws: 3, metricSum: 0, metricCount: 0, currentStreak: 0, bestStreak: 0 });
  });

  it("tracks a live streak that resets on a loss, and remembers the best one", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");

    await recordDuelResult("chess", [a.id, b.id], 0); // a wins
    await recordDuelResult("chess", [a.id, b.id], 0); // a wins again
    await recordDuelResult("chess", [b.id, a.id], 0); // b wins this one (a loses)

    const board = await getGameLeaderboard("chess", 10);
    const rowA = board.find((row) => row.profileId === a.id)!;
    expect(rowA.stats.wins).toBe(2);
    expect(rowA.stats.losses).toBe(1);
    expect(rowA.stats.currentStreak).toBe(-1);
    expect(rowA.stats.bestStreak).toBe(2);
  });
});

describe("recordMultiWayResult", () => {
  it("credits the winner a win and every other seat a loss", async () => {
    const players = await Promise.all(["P0", "P1", "P2", "P3"].map(newPlayer));
    const ids = players.map((p) => p.id);

    await recordMultiWayResult("cribbage", ids, ids[2]);
    await recordMultiWayResult("cribbage", ids, ids[2]);
    await recordMultiWayResult("cribbage", ids, ids[0]);

    const board = await getGameLeaderboard("cribbage", 10);
    const winner = board.find((row) => row.profileId === ids[2])!;
    const runnerUp = board.find((row) => row.profileId === ids[0])!;
    expect(winner.stats).toEqual({ wins: 2, losses: 1, draws: 0, metricSum: 0, metricCount: 0, currentStreak: -1, bestStreak: 2 });
    expect(runnerUp.stats.wins).toBe(1);
    expect(runnerUp.stats.losses).toBe(2);
  });
});

describe("recordMetricResult", () => {
  it("accumulates sum and count for a read-time average, never storing the average itself", async () => {
    const a = await newPlayer("A");
    await recordMetricResult("memory-match", a.id, 8);
    await recordMetricResult("memory-match", a.id, 12);
    await recordMetricResult("memory-match", a.id, 10);

    const board = await getGameLeaderboard("memory-match", 10);
    const row = board.find((entry) => entry.profileId === a.id)!;
    expect(row.stats.metricSum).toBe(30);
    expect(row.stats.metricCount).toBe(3);
    expect(row.cells.avgTurns).toBe("10.0");
  });
});

describe("getGameLeaderboard / getGameStanding", () => {
  it("gates a player out until they clear the game's minSample", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");
    await recordDuelResult("chess", [a.id, b.id], 0);
    await recordDuelResult("chess", [a.id, b.id], 0);

    expect(await getGameLeaderboard("chess", 10)).toHaveLength(0);
    expect(await getGameStanding("chess", a.id)).toBeNull();

    await recordDuelResult("chess", [a.id, b.id], 0); // 3rd decided game clears minSample
    expect(await getGameLeaderboard("chess", 10)).toHaveLength(2);
    expect((await getGameStanding("chess", a.id))!.rank).toBe(1);
  });

  it("ranks a win/loss game by win rate, best first", async () => {
    // Two independent pairs, four distinct win rates -- no ties to break,
    // so the ordering is unambiguous regardless of insertion order.
    const a = await newPlayer("A");
    const b = await newPlayer("B");
    const c = await newPlayer("C");
    const d = await newPlayer("D");

    for (let i = 0; i < 3; i += 1) await recordDuelResult("chess", [a.id, b.id], 0); // a: 3-0 (100%)
    await recordDuelResult("chess", [c.id, d.id], 0);
    await recordDuelResult("chess", [c.id, d.id], 0);
    await recordDuelResult("chess", [d.id, c.id], 0); // c: 2-1 (67%), d: 1-2 (33%)

    const board = await getGameLeaderboard("chess", 10);
    expect(board.map((row) => row.profileId)).toEqual([a.id, c.id, d.id, b.id]);
    expect(board[0].cells.winRate).toBe("100%");
  });

  it("ranks a lower_better game ascending -- fewer average turns is better", async () => {
    const fast = await newPlayer("Fast");
    const slow = await newPlayer("Slow");
    for (let i = 0; i < 3; i += 1) await recordMetricResult("memory-match", fast.id, 8);
    for (let i = 0; i < 3; i += 1) await recordMetricResult("memory-match", slow.id, 20);

    const board = await getGameLeaderboard("memory-match", 10);
    expect(board.map((row) => row.profileId)).toEqual([fast.id, slow.id]);
  });

  it("returns nothing for an unregistered game id rather than throwing", async () => {
    expect(await getGameLeaderboard("solitaire", 10)).toEqual([]);
    expect(await getGameStanding("solitaire", "whoever")).toBeNull();
  });
});

describe("getGlobalLeaderboard / getGlobalStanding", () => {
  it("blends a win/loss game and an average-metric game into one comparable rank", async () => {
    const ace = await newPlayer("Ace"); // best at both
    const middling = await newPlayer("Middling");

    for (let i = 0; i < 3; i += 1) await recordDuelResult("chess", [ace.id, middling.id], 0); // ace 3-0
    for (let i = 0; i < 3; i += 1) await recordMetricResult("memory-match", ace.id, 8); // ace: fast
    for (let i = 0; i < 3; i += 1) await recordMetricResult("memory-match", middling.id, 20); // middling: slow

    const board = await getGlobalLeaderboard(10);
    expect(board[0].profileId).toBe(ace.id);
    expect(board[0].gamesCounted).toBe(2);

    const standing = await getGlobalStanding(middling.id);
    expect(standing).not.toBeNull();
    expect(standing!.rank).toBe(2);
  });

  it("excludes a player from the blend entirely until they qualify in at least one game", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");
    await recordDuelResult("chess", [a.id, b.id], 0); // only 1 decided game -- under minSample

    expect(await getGlobalStanding(a.id)).toBeNull();
    expect((await getGlobalLeaderboard(10)).find((row) => row.profileId === a.id)).toBeUndefined();
  });

  it("folds poker in as one more score source once a player clears its own hand-count floor", async () => {
    const grinder = await newPlayer("Grinder");
    const casual = await newPlayer("Casual");

    // 20 hands is player_stats' own qualifying floor for the Global blend
    // (POKER_MIN_HANDS in leaderboard-store.ts) -- below it, poker
    // contributes nothing for this player, the same minSample gate every
    // other game gets.
    for (let hand = 0; hand < 20; hand += 1) {
      const state = createGame(grinder.token);
      const seat = state.seats[0];
      seat.holeCards = [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }];
      seat.committed = 100;
      state.winners = [{ seatId: seat.id, name: seat.name, amount: 500, hand: "Flush", bestFive: null }];
      state.id = randomUUID();
      state.handNumber = hand;
      await recordHandStats(state);
    }

    const board = await getGlobalLeaderboard(10);
    expect(board.some((row) => row.profileId === grinder.id)).toBe(true);
    expect(await getGlobalStanding(casual.id)).toBeNull();
  });
});
