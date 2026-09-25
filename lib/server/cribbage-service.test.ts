import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRIBBAGE_TURN_MS } from "@/lib/cribbage/engine";
import {
  CribbageRequestError,
  joinCribbageTable,
  leaveCribbageTable,
  listOpenCribbageTables,
  openCribbageTable,
  playCribbageMove,
  readCribbageTableById,
  readMyCribbageTable,
  resignCribbageTable,
  startCribbageTableAsHost,
} from "./cribbage-service";
import { __resetCribbageTablesForTest } from "./cribbage-table-store";
import { __resetLeaderboardMemory, getGameLeaderboard } from "./leaderboard-store";
import { adjustGold, ensureProfile } from "./profile-store";

/**
 * The cribbage money contract, in memory mode.
 *
 * Same conservation argument pvp-match-service.test.ts makes: a table has no
 * house, so whatever moves Gold between the seated players, their COMBINED
 * balance must be exactly what it was before anyone staked anything. That
 * has to survive a normal win, a resignation, a pre-start leave and a lost
 * version race alike -- checking totals catches a bug that pays the winner
 * twice just as well as one that fails to debit a joiner.
 */

const STAKE = 1000;

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

async function group(n: number) {
  const players = await Promise.all(Array.from({ length: n }, () => funded()));
  return {
    players,
    async total() {
      return (await Promise.all(players.map((p) => balance(p.token)))).reduce((a, b) => a + b, 0);
    },
  };
}

beforeEach(() => {
  __resetCribbageTablesForTest();
  __resetLeaderboardMemory();
});

describe("opening and joining", () => {
  it("debits the host when the table opens, and seats them at seat 0", async () => {
    const { players: [host] } = await group(1);
    const before = await balance(host.token);

    const { table } = await openCribbageTable(host.token, STAKE);
    expect(await balance(host.token)).toBe(before - STAKE);
    expect(table.yourSeat).toBe(0);
    expect(table.status).toBe("waiting");
    expect(table.isHost).toBe(true);
  });

  it("debits a joiner and seats them at the next open seat", async () => {
    const { players: [host, joiner] } = await group(2);
    const { table: opened } = await openCribbageTable(host.token, STAKE);
    const before = await balance(joiner.token);

    const { table: joined } = await joinCribbageTable(joiner.token, opened.id);
    expect(await balance(joiner.token)).toBe(before - STAKE);
    expect(joined.yourSeat).toBe(1);
    expect(joined.status).toBe("waiting"); // still short of both thresholds
  });

  it("rejects a player already seated somewhere else", async () => {
    const { players: [host, other] } = await group(2);
    const { table: mine } = await openCribbageTable(host.token, STAKE);
    await openCribbageTable(other.token, STAKE);

    await expect(joinCribbageTable(other.token, mine.id)).rejects.toBeInstanceOf(CribbageRequestError);
  });

  it("rejects joining a table that cannot afford it, without seating them", async () => {
    const { players: [host] } = await group(1);
    const { table } = await openCribbageTable(host.token, STAKE);
    const poor = await funded(500);

    await expect(joinCribbageTable(poor.token, table.id)).rejects.toThrow(/need/i);
    const { table: reread } = await readCribbageTableById(host.token, table.id);
    expect(reread.players).toHaveLength(1);
  });

  it("auto-starts the instant the 4th seat fills, with no host action needed", async () => {
    const { players } = await group(4);
    const { table: opened } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, opened.id);
    await joinCribbageTable(players[2].token, opened.id);
    const { table: full } = await joinCribbageTable(players[3].token, opened.id);

    expect(full.status).toBe("active");
    expect(full.players).toHaveLength(4);
    expect(full.state).not.toBeNull();
  });

  it("a vacated middle seat can be refilled, and the table still fills to a real 4", async () => {
    const { players } = await group(4);
    const { table: opened } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, opened.id); // seat 1
    await joinCribbageTable(players[2].token, opened.id); // seat 2
    await leaveCribbageTable(players[1].token, opened.id); // frees seat 1

    const { table: rejoined } = await joinCribbageTable(players[1].token, opened.id);
    expect(rejoined.yourSeat).toBe(1); // lands on the vacated seat, not a new seat 3

    const { table: full } = await joinCribbageTable(players[3].token, opened.id);
    expect(full.status).toBe("active");
    expect(full.players.map((p) => p.seat).sort()).toEqual([0, 1, 2, 3]);
    // Every seat is a distinct player -- no collision, no seat left double-booked.
    expect(new Set(full.players.map((p) => p.profileId)).size).toBe(4);
  });
});

describe("the host-start-at-3 escape hatch", () => {
  it("lets the host start early once 3 are seated, and refuses anyone else", async () => {
    const { players } = await group(3);
    const { table: opened } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, opened.id);
    const { table: threeSeated } = await joinCribbageTable(players[2].token, opened.id);
    expect(threeSeated.canStart).toBe(false); // not the host's own view yet

    const asNonHost = await readCribbageTableById(players[1].token, opened.id);
    expect(asNonHost.table.canStart).toBe(false);
    await expect(startCribbageTableAsHost(players[1].token, opened.id)).rejects.toBeInstanceOf(CribbageRequestError);

    const asHost = await readCribbageTableById(players[0].token, opened.id);
    expect(asHost.table.canStart).toBe(true);
    const { table: started } = await startCribbageTableAsHost(players[0].token, opened.id);
    expect(started.status).toBe("active");
    expect(started.players).toHaveLength(3);
  });

  it("refuses to start with fewer than 3 seated", async () => {
    const { players } = await group(2);
    const { table } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, table.id);
    await expect(startCribbageTableAsHost(players[0].token, table.id)).rejects.toBeInstanceOf(CribbageRequestError);
  });
});

describe("leaving before the deal", () => {
  it("refunds exactly once, and rejects a second leave", async () => {
    const { players: [host, joiner] } = await group(2);
    const { table } = await openCribbageTable(host.token, STAKE);
    const before = await balance(joiner.token);
    await joinCribbageTable(joiner.token, table.id);

    const left = await leaveCribbageTable(joiner.token, table.id);
    // `table: null` is what takes the client out of the waiting room.
    expect(left.table).toBeNull();
    expect(await balance(joiner.token)).toBe(before);

    await expect(leaveCribbageTable(joiner.token, table.id)).rejects.toBeInstanceOf(CribbageRequestError);
    expect(await balance(joiner.token)).toBe(before);
  });

  it("hands the host role to the next-seated player rather than cancelling a table others already staked into", async () => {
    const { players: [host, second, third] } = await group(3);
    const { table } = await openCribbageTable(host.token, STAKE);
    await joinCribbageTable(second.token, table.id);
    await joinCribbageTable(third.token, table.id);

    await leaveCribbageTable(host.token, table.id);
    const { table: after } = await readCribbageTableById(second.token, table.id);
    expect(after.hostId).toBe((await ensureProfile(second.token)).id);
    expect(after.players).toHaveLength(2);
  });

  it("cancels an empty table when its last seat leaves", async () => {
    const { players: [host] } = await group(1);
    const { table } = await openCribbageTable(host.token, STAKE);
    await leaveCribbageTable(host.token, table.id);
    // No live table to poll for any more -- confirmed indirectly via readMyCribbageTable.
    const { table: mine } = await readMyCribbageTable(host.token);
    expect(mine).toBeNull();
  });
});

/** Every seated player discards their first card, in seat order -- legal, order-independent. */
async function discardAll(tokens: string[], tableId: string) {
  for (const token of tokens) {
    const { table } = await readCribbageTableById(token, tableId);
    const card = table.state?.yourHand[0];
    if (!card) continue;
    await playCribbageMove(token, { tableId, version: table.version, move: { type: "discard", card } });
  }
}

/** Plays out pegging: whoever's turn it is plays the lowest legal card, or goes. */
async function playOutPegging(tokens: string[], tableId: string) {
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 500) throw new Error("Pegging did not conclude.");
    const { table } = await readCribbageTableById(tokens[0], tableId);
    if (table.status !== "active" || table.state?.phase !== "pegging") return;
    const turnSeat = table.state.pegging?.turn;
    const mover = tokens[turnSeat as number];
    const { table: view } = await readCribbageTableById(mover, tableId);
    const hand = [...(view.state?.yourHand ?? [])].sort((a, b) => a.rank - b.rank);
    const count = view.state?.pegging?.count ?? 0;
    const playable = hand.find((card) => Math.min(card.rank, 10) + count <= 31);
    const move = playable ? { type: "peg", card: playable } : { type: "go" };
    await playCribbageMove(mover, { tableId, version: view.version, move });
  }
}

async function playFullTable(tokens: string[], tableId: string) {
  let hands = 0;
  for (;;) {
    hands += 1;
    if (hands > 300) throw new Error("Match did not conclude.");
    const { table } = await readCribbageTableById(tokens[0], tableId);
    if (table.status !== "active") return;
    await discardAll(tokens, tableId);
    await playOutPegging(tokens, tableId);
  }
}


/** Opens a 3-seat table and deals it. */
async function startedTable(tokens: string[]) {
  const { table: opened } = await openCribbageTable(tokens[0], STAKE);
  await joinCribbageTable(tokens[1], opened.id);
  await joinCribbageTable(tokens[2], opened.id);
  const { table } = await startCribbageTableAsHost(tokens[0], opened.id);
  return table;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("playing a table to completion", () => {
  it("conserves Gold across a full 3-player game -- the group's total never moves", async () => {
    const { players, total } = await group(3);
    const before = await total();

    const { table: opened } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, opened.id);
    const { table: started } = await joinCribbageTable(players[2].token, opened.id);
    expect(started.status).toBe("waiting");
    await startCribbageTableAsHost(players[0].token, opened.id);

    const tokens = players.map((p) => p.token);
    await playFullTable(tokens, opened.id);

    const { table: finished } = await readCribbageTableById(players[0].token, opened.id);
    expect(finished.status).toBe("completed");
    expect(finished.winnerId).not.toBeNull();
    expect(await total()).toBe(before); // zero-sum within the group -- no house, no rake.
  });

  it("rejects a move sent against a stale version, without applying it", async () => {
    const { players } = await group(3);
    const { table: opened } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, opened.id);
    await joinCribbageTable(players[2].token, opened.id);
    const { table: started } = await startCribbageTableAsHost(players[0].token, opened.id);

    await expect(
      playCribbageMove(players[0].token, {
        tableId: opened.id,
        version: started.version - 1,
        move: { type: "discard", card: { rank: 1, suit: "S" } },
      }),
    ).rejects.toBeInstanceOf(CribbageRequestError);
  });
});

describe("resigning", () => {
  it("forfeits only the resigner's stake: the others are refunded and split it, exactly once", async () => {
    const { players, total } = await group(3);
    const before = await total();
    const balances = await Promise.all(players.map((p) => balance(p.token)));
    const table = await startedTable(players.map((p) => p.token));

    const { table: resigned } = await resignCribbageTable(players[0].token, table.id);
    expect(resigned.status).toBe("completed");
    expect(resigned.winnerId).toBeNull();
    expect(resigned.forfeitedIds).toEqual([players[0].id]);
    expect(resigned.yourPayout).toBe(0);
    expect(await balance(players[0].token)).toBe(balances[0] - STAKE);
    expect(await balance(players[1].token)).toBe(balances[1] + STAKE / 2);
    expect(await balance(players[2].token)).toBe(balances[2] + STAKE / 2);
    expect(await total()).toBe(before);

    // A second resign call on an already-settled table is a harmless no-op --
    // it must not pay anything again.
    const { table: again } = await resignCribbageTable(players[1].token, table.id);
    expect(again.status).toBe("completed");
    expect(await total()).toBe(before);
  });

  it("gives two colluders no way to take a stranger's stake", async () => {
    const { players } = await group(3);
    const [friendA, friendB, stranger] = players;
    const pairBefore = (await balance(friendA.token)) + (await balance(friendB.token));
    const strangerBefore = await balance(stranger.token);
    const table = await startedTable(players.map((p) => p.token));

    await resignCribbageTable(friendA.token, table.id);
    expect(await balance(stranger.token)).toBeGreaterThanOrEqual(strangerBefore);
    expect((await balance(friendA.token)) + (await balance(friendB.token))).toBeLessThan(pairBefore);
  });

  it("surfaces the result to a seated player whose own poll never triggered the settlement", async () => {
    const { players } = await group(3);
    const table = await startedTable(players.map((p) => p.token));

    await resignCribbageTable(players[0].token, table.id);

    // players[1] never called resignCribbageTable or any other move -- a
    // plain readMyCribbageTable poll is the only way they find out.
    const { table: seenByOther } = await readMyCribbageTable(players[1].token);
    expect(seenByOther?.status).toBe("completed");
    expect(seenByOther?.winnerId).toBeNull();
    expect(seenByOther?.forfeitedIds).toEqual([players[0].id]);
    expect(seenByOther?.yourPayout).toBe(STAKE + STAKE / 2);
  });
});

describe("the turn clock", () => {
  it("forfeits a seat that never discards, settled by another player's poll", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    const { players, total } = await group(3);
    const before = await total();
    const balances = await Promise.all(players.map((p) => balance(p.token)));
    const tokens = players.map((p) => p.token);
    const table = await startedTable(tokens);

    // Seats 1 and 2 discard; seat 0 walks away.
    for (const token of tokens.slice(1)) {
      const { table: view } = await readCribbageTableById(token, table.id);
      const card = view.state?.yourHand[0];
      if (!card) throw new Error("No hand dealt.");
      await playCribbageMove(token, { tableId: table.id, version: view.version, move: { type: "discard", card } });
    }

    vi.setSystemTime(Date.now() + CRIBBAGE_TURN_MS - 1_000);
    expect((await readMyCribbageTable(tokens[1])).table?.status).toBe("active");

    vi.setSystemTime(Date.now() + 2_000);
    const { table: seen } = await readMyCribbageTable(tokens[1]);
    expect(seen?.status).toBe("completed");
    expect(seen?.state?.winReason).toBe("Timeout");
    expect(seen?.forfeitedIds).toEqual([players[0].id]);
    expect(await balance(tokens[0])).toBe(balances[0] - STAKE);
    expect(await balance(tokens[1])).toBe(balances[1] + STAKE / 2);
    expect(await total()).toBe(before);

    // Polling again pays nothing more.
    await readMyCribbageTable(tokens[2]);
    expect(await total()).toBe(before);
  });

  it("settles the forfeit when the staller finally sends a move", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    const { players, total } = await group(3);
    const before = await total();
    const table = await startedTable(players.map((p) => p.token));
    const { table: view } = await readCribbageTableById(players[0].token, table.id);
    const card = view.state?.yourHand[0];
    if (!card) throw new Error("No hand dealt.");

    vi.setSystemTime(Date.now() + CRIBBAGE_TURN_MS + 1);
    const { table: late } = await playCribbageMove(players[0].token, {
      tableId: table.id,
      version: view.version,
      move: { type: "discard", card },
    });
    expect(late.status).toBe("completed");
    // Nobody had discarded, so the whole table forfeited and everyone is refunded.
    expect(late.forfeitedIds).toHaveLength(3);
    expect(late.yourPayout).toBe(STAKE);
    expect(await total()).toBe(before);
  });
});

describe("per-game leaderboard stats", () => {
  it("credits a win to whoever the table pays and a loss to every other seated player", async () => {
    const { players } = await group(3);
    const tokens = players.map((p) => p.token);

    // Three played-out tables, past cribbage's minSample (3), so a ranked
    // board exists to check.
    for (let round = 0; round < 3; round += 1) {
      const table = await startedTable(tokens);
      await playFullTable(tokens, table.id);
    }

    const board = await getGameLeaderboard("cribbage", 10);
    expect(board).toHaveLength(3);
    const total = board.reduce((sum, row) => sum + row.stats.wins + row.stats.losses, 0);
    // Every one of the 3 tables produced exactly one win and two losses.
    expect(total).toBe(3 * 3);
    expect(board.reduce((sum, row) => sum + row.stats.wins, 0)).toBe(3);
  });

  it("records nothing for a table that ended on a forfeit, since nobody won it", async () => {
    const { players } = await group(3);
    const tokens = players.map((p) => p.token);
    for (let round = 0; round < 3; round += 1) {
      const table = await startedTable(tokens);
      await resignCribbageTable(tokens[0], table.id);
    }
    expect(await getGameLeaderboard("cribbage", 10)).toHaveLength(0);
  });
});

describe("the lobby list", () => {
  it("lists open tables with a live seated count", async () => {
    const { players } = await group(2);
    const { table } = await openCribbageTable(players[0].token, STAKE);
    await joinCribbageTable(players[1].token, table.id);

    const { tables } = await listOpenCribbageTables(players[0].token);
    const mine = tables.find((t) => t.id === table.id);
    expect(mine?.seatedCount).toBe(2);
    expect(mine?.mine).toBe(true);
  });
});
