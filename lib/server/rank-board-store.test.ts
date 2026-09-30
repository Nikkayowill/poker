import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetFriendsMemory, respondToFriendRequest, sendFriendRequest } from "./friends-store";
import { ensureProfile } from "./profile-store";
import { getFriendsRankBoard, getGlobalRankBoard } from "./rank-board-store";
import { __resetSoloEarningsMemory, recordSoloResult } from "./solo-earnings-store";

async function newPlayer(name: string) {
  const token = randomUUID();
  const profile = await ensureProfile(token, name);
  return { token, id: profile.id };
}

async function befriend(a: string, b: string) {
  const sent = await sendFriendRequest(a, b);
  if (sent.status !== "sent") throw new Error(`expected sent, got ${sent.status}`);
  await respondToFriendRequest(b, sent.requestId, "accept");
}

/** One settled easy-band wager. Net is payout minus the 1,000 stake. */
async function settle(player: { token: string; id: string }, payout: number) {
  await recordSoloResult(player.id, player.token, { game: "sudoku", correlationId: randomUUID(), wager: 1_000, payout });
}

beforeEach(() => {
  __resetSoloEarningsMemory();
  __resetFriendsMemory();
});

describe("getGlobalRankBoard", () => {
  it("ranks by rank points and leaves out players who have not played", async () => {
    const low = await newPlayer("Low");
    const high = await newPlayer("High");
    await newPlayer("Idle");
    await settle(low, 3_000);
    await settle(high, 9_000);

    const { entries, mine } = await getGlobalRankBoard(10, null);

    expect(entries.map((entry) => entry.displayName)).toEqual(["High", "Low"]);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(entries[0].points).toBeGreaterThan(entries[1].points);
    expect(mine).toBeNull();
  });

  it("carries title, level and difficulty on each row, and no win-loss counters", async () => {
    const player = await newPlayer("Solo");
    await settle(player, 5_000);

    const { entries } = await getGlobalRankBoard(10, null);

    expect(entries[0]).toMatchObject({ level: expect.any(Number), title: expect.any(String), difficulty: expect.any(String) });
    for (const key of ["wins", "losses", "draws", "currentStreak"]) expect(entries[0]).not.toHaveProperty(key);
  });

  it("pins the viewer's own row, with their real position, when they are outside the list", async () => {
    const first = await newPlayer("First");
    const second = await newPlayer("Second");
    await settle(first, 9_000);
    await settle(second, 5_000);

    const { entries, mine } = await getGlobalRankBoard(1, second.id);

    expect(entries.map((entry) => entry.displayName)).toEqual(["First"]);
    expect(mine).toMatchObject({ displayName: "Second", rank: 2 });
  });

  it("does not repeat the viewer's row when they are already listed", async () => {
    const only = await newPlayer("Only");
    await settle(only, 5_000);
    expect((await getGlobalRankBoard(10, only.id)).mine).toBeNull();
  });

  it("gives a viewer with nothing to rank no pinned row", async () => {
    const played = await newPlayer("Played");
    const idle = await newPlayer("Idle");
    await settle(played, 5_000);
    expect((await getGlobalRankBoard(1, idle.id)).mine).toBeNull();
  });

  it("orders equal points the same way on every read", async () => {
    const a = await newPlayer("A");
    const b = await newPlayer("B");
    await settle(a, 5_000);
    await settle(b, 5_000);

    const first = (await getGlobalRankBoard(10, null)).entries.map((entry) => entry.profileId);
    const second = (await getGlobalRankBoard(10, null)).entries.map((entry) => entry.profileId);

    expect(first).toEqual(second);
    expect(first).toEqual([a.id, b.id].sort());
  });

  it("puts a player who has lost their way to zero points at the bottom", async () => {
    const winner = await newPlayer("Winner");
    const loser = await newPlayer("Loser");
    await settle(winner, 5_000);
    await settle(loser, 0);

    const { entries } = await getGlobalRankBoard(10, null);

    expect(entries.map((entry) => entry.displayName)).toEqual(["Winner", "Loser"]);
    expect(entries[1].points).toBe(0);
  });
});

describe("getFriendsRankBoard", () => {
  it("ranks the viewer and their friends together, and nobody else", async () => {
    const me = await newPlayer("Me");
    const friend = await newPlayer("Friend");
    const stranger = await newPlayer("Stranger");
    await befriend(me.id, friend.id);
    await settle(me, 3_000);
    await settle(friend, 9_000);
    await settle(stranger, 20_000);

    const entries = await getFriendsRankBoard(me.id);

    expect(entries.map((entry) => entry.displayName)).toEqual(["Friend", "Me"]);
    expect(entries.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  it("keeps a friend who has not played, at zero points", async () => {
    const me = await newPlayer("Me");
    const quiet = await newPlayer("Quiet");
    await befriend(me.id, quiet.id);
    await settle(me, 5_000);

    const entries = await getFriendsRankBoard(me.id);

    expect(entries.map((entry) => entry.displayName)).toEqual(["Me", "Quiet"]);
    expect(entries[1]).toMatchObject({ points: 0, level: 1, difficulty: null });
  });

  it("is just the viewer when they have no friends", async () => {
    const me = await newPlayer("Me");
    const entries = await getFriendsRankBoard(me.id);
    expect(entries.map((entry) => entry.displayName)).toEqual(["Me"]);
  });
});
