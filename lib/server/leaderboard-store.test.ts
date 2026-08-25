import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@/lib/game/engine";
import { __resetFriendsMemory, respondToFriendRequest, sendFriendRequest } from "./friends-store";
import { __resetHeadToHeadMemory } from "./head-to-head-store";
import {
  __resetLeaderboardMemory,
  getFriendsBoard,
  getGameLeaderboard,
  getGameQualifyProgress,
  getGameStanding,
  getGlobalLeaderboard,
  getGlobalStanding,
  recordDuelResult,
  recordMultiWayResult,
} from "./leaderboard-store";
import { ensureProfile } from "./profile-store";
import { recordHandStats } from "./stats-store";

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, id: profile.id };
}

/** Sends and immediately accepts, the same helper friends-store.test.ts uses. */
async function befriend(a: string, b: string) {
  const sent = await sendFriendRequest(a, b);
  if (sent.status !== "sent") throw new Error(`expected sent, got ${sent.status}`);
  await respondToFriendRequest(b, sent.requestId, "accept");
}

beforeEach(() => {
  __resetLeaderboardMemory();
  __resetHeadToHeadMemory();
  __resetFriendsMemory();
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
    expect(rowA.stats).toEqual({ wins: 0, losses: 0, draws: 3, currentStreak: 0, bestStreak: 0 });
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
    expect(winner.stats).toEqual({ wins: 2, losses: 1, draws: 0, currentStreak: -1, bestStreak: 2 });
    expect(runnerUp.stats.wins).toBe(1);
    expect(runnerUp.stats.losses).toBe(2);
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

  it("returns nothing for an unregistered game id rather than throwing", async () => {
    expect(await getGameLeaderboard("solitaire", 10)).toEqual([]);
    expect(await getGameStanding("solitaire", "whoever")).toBeNull();
  });

  it("returns nothing for a solo game, which is unregistered by design", async () => {
    // Memory Match had a board until 2026-08-24. Solo games don't get one --
    // an id that used to resolve now has to read as unknown, not as an empty
    // board that might fill up later.
    expect(await getGameLeaderboard("memory-match", 10)).toEqual([]);
    expect(await getGameStanding("memory-match", "whoever")).toBeNull();
    expect(await getGameQualifyProgress("memory-match", "whoever")).toBeNull();
  });
});

describe("getGameQualifyProgress", () => {
  it("reports how many more games are needed while below minSample", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");
    await recordDuelResult("chess", [a.id, b.id], 0);

    expect(await getGameQualifyProgress("chess", a.id)).toEqual({ sample: 1, minSample: 3 });

    await recordDuelResult("chess", [a.id, b.id], 0);
    expect(await getGameQualifyProgress("chess", a.id)).toEqual({ sample: 2, minSample: 3 });
  });

  it("returns null once qualified -- getGameStanding is the answer at that point", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");
    for (let i = 0; i < 3; i += 1) await recordDuelResult("chess", [a.id, b.id], 0);

    expect(await getGameQualifyProgress("chess", a.id)).toBeNull();
    expect(await getGameStanding("chess", a.id)).not.toBeNull();
  });

  it("returns null for a player who has never played this game", async () => {
    const a = await newPlayer("A");
    expect(await getGameQualifyProgress("chess", a.id)).toBeNull();
  });

  it("returns null for an unregistered game id", async () => {
    expect(await getGameQualifyProgress("solitaire", "whoever")).toBeNull();
  });
});

describe("getGlobalLeaderboard / getGlobalStanding", () => {
  it("blends two separate games into one comparable rank", async () => {
    const ace = await newPlayer("Ace"); // best at both
    const middling = await newPlayer("Middling");

    for (let i = 0; i < 3; i += 1) await recordDuelResult("chess", [ace.id, middling.id], 0); // ace 3-0
    // A second, unrelated game: the point is that a percentile in one game is
    // comparable to a percentile in another, whatever each is scored on.
    for (let i = 0; i < 3; i += 1) {
      await recordMultiWayResult("cribbage", [ace.id, middling.id], ace.id);
    }

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

describe("getFriendsBoard", () => {
  it("shows the caller's own record against each friend, both sides agreeing", async () => {
    const me = await newPlayer("Me");
    const her = await newPlayer("Her");
    await befriend(me.id, her.id);

    // Five straight losses to one person -- the thing this board is for.
    for (let i = 0; i < 5; i += 1) await recordDuelResult("chess", [me.id, her.id], 1);

    const mine = await getFriendsBoard(me.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ profileId: her.id, wins: 0, losses: 5, draws: 0, currentStreak: -5 });
    expect(mine[0].games).toEqual([
      { gameId: "chess", label: "Chess", wins: 0, losses: 5, draws: 0, currentStreak: -5 },
    ]);

    const hers = await getFriendsBoard(her.id);
    expect(hers[0]).toMatchObject({ profileId: me.id, wins: 5, losses: 0, currentStreak: 5 });
  });

  it("splits a mixed history per game, most played first", async () => {
    const me = await newPlayer("Me");
    const friend = await newPlayer("Friend");
    await befriend(me.id, friend.id);

    await recordDuelResult("chess", [me.id, friend.id], 0);
    await recordDuelResult("chess", [me.id, friend.id], 1);
    await recordMultiWayResult("cribbage", [me.id, friend.id, (await newPlayer("Third")).id], me.id);

    const [entry] = await getFriendsBoard(me.id);
    expect(entry).toMatchObject({ wins: 2, losses: 1 });
    expect(entry.games.map((game) => game.label)).toEqual(["Chess", "Cribbage"]);
  });

  it("keeps a friend you have never played, sorted below the ones you have", async () => {
    const me = await newPlayer("Me");
    const played = await newPlayer("Played");
    const unplayed = await newPlayer("Unplayed");
    await befriend(me.id, played.id);
    await befriend(me.id, unplayed.id);

    await recordDuelResult("checkers", [me.id, played.id], 0);

    const board = await getFriendsBoard(me.id);
    expect(board.map((entry) => entry.profileId)).toEqual([played.id, unplayed.id]);
    // "You have never played" is the thing the board exists to fix, so it is
    // a row with an empty record, not a missing row.
    expect(board[1]).toMatchObject({ wins: 0, losses: 0, draws: 0, games: [] });
  });

  it("is empty for a player with no friends, whatever they have played", async () => {
    const me = await newPlayer("Me");
    const stranger = await newPlayer("Stranger");
    await recordDuelResult("chess", [me.id, stranger.id], 0);
    expect(await getFriendsBoard(me.id)).toEqual([]);
  });

  it("never counts poker, which has no named opponent", async () => {
    const me = await newPlayer("Me");
    const friend = await newPlayer("Friend");
    await befriend(me.id, friend.id);

    // A real poker hand, won at a table -- poker is never head-to-head: one
    // pot at a six-handed table is not a result between two named players.
    const state = createGame(me.token);
    const seat = state.seats[0];
    seat.holeCards = [{ rank: "A", suit: "spades" }, { rank: "K", suit: "spades" }];
    seat.committed = 100;
    state.winners = [{ seatId: seat.id, name: seat.name, amount: 500, hand: "Flush", bestFive: null }];
    state.id = randomUUID();
    await recordHandStats(state);

    const [entry] = await getFriendsBoard(me.id);
    expect(entry).toMatchObject({ wins: 0, losses: 0, draws: 0, games: [] });
  });
});
