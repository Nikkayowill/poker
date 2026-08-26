import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createStoredGame, getStoredGame } from "./game-store";
import { __resetLeaderboardMemory, getGameLeaderboard } from "./leaderboard-store";
import { adjustGold, ensureProfile } from "./profile-store";
import {
  joinSitAndGoTable,
  leaveSitAndGoTable,
  listOpenSitAndGoTables,
  openSitAndGoTable,
  readMySitAndGoTable,
  readSitAndGoLobby,
  readSitAndGoTableById,
  settleSitAndGoIfFinished,
  SitAndGoRequestError,
  type SitAndGoTableView,
} from "./sit-and-go-service";
import { __resetSitAndGoTablesForTest } from "./sit-and-go-store";

/**
 * The Sit & Go money contract, in memory mode.
 *
 * Same conservation argument cribbage-service.test.ts makes: a table has no
 * house, so whatever moves Gold between the six registered players, their
 * COMBINED balance must be exactly what it was before anyone paid an entry
 * fee. That has to survive a normal win, a pre-deal leave and a lost
 * settlement race alike.
 */

const TIER = "1k";
const ENTRY_FEE = 1000; // TIER_CONFIG["1k"].minBuyIn

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

/** Registers all 6 players; the 6th join deals the table. Returns the dealt view. */
async function registerSix(players: Array<{ token: string }>): Promise<SitAndGoTableView> {
  const { table: opened } = await openSitAndGoTable(players[0].token, TIER);
  let last = opened;
  for (let i = 1; i < 6; i += 1) {
    const { table } = await joinSitAndGoTable(players[i].token, opened.id);
    last = table;
  }
  return last;
}

beforeEach(() => {
  __resetSitAndGoTablesForTest();
  __resetLeaderboardMemory();
});

describe("opening and joining", () => {
  it("debits the host when the table opens, and registers them at seat 0", async () => {
    const { players: [host] } = await group(1);
    const before = await balance(host.token);

    const { table } = await openSitAndGoTable(host.token, TIER);
    expect(await balance(host.token)).toBe(before - ENTRY_FEE);
    expect(table.yourSeat).toBe(0);
    expect(table.status).toBe("waiting");
    expect(table.isHost).toBe(true);
  });

  it("debits a joiner and registers them at the next open seat", async () => {
    const { players: [host, joiner] } = await group(2);
    const { table: opened } = await openSitAndGoTable(host.token, TIER);
    const before = await balance(joiner.token);

    const { table: joined } = await joinSitAndGoTable(joiner.token, opened.id);
    expect(await balance(joiner.token)).toBe(before - ENTRY_FEE);
    expect(joined.yourSeat).toBe(1);
    expect(joined.status).toBe("waiting");
  });

  it("rejects a player already registered somewhere else", async () => {
    const { players: [host, other] } = await group(2);
    const { table: mine } = await openSitAndGoTable(host.token, TIER);
    await openSitAndGoTable(other.token, TIER);

    await expect(joinSitAndGoTable(other.token, mine.id)).rejects.toBeInstanceOf(SitAndGoRequestError);
  });

  it("rejects joining a table that cannot afford it, without registering them", async () => {
    const { players: [host] } = await group(1);
    const { table } = await openSitAndGoTable(host.token, TIER);
    const poor = await funded(500);

    await expect(joinSitAndGoTable(poor.token, table.id)).rejects.toThrow(/need/i);
    const { table: reread } = await readSitAndGoTableById(host.token, table.id);
    expect(reread.seatedCount).toBe(1);
  });

  it("auto-deals the instant the 6th seat fills, with every seat funded at the tier's own stack", async () => {
    const { players } = await group(6);
    const full = await registerSix(players);

    expect(full.status).toBe("active");
    expect(full.seatedCount).toBe(6);
    expect(full.gameId).not.toBeNull();
    expect(full.prizePool).toBe(ENTRY_FEE * 6);

    const game = await getStoredGame(full.gameId!);
    expect(game?.seats).toHaveLength(6);
    expect(game?.tournament?.entryFee).toBe(ENTRY_FEE);
    for (const seat of game!.seats) {
      expect(seat.isHuman).toBe(true);
      // The two blind seats have already posted for hand 1 -- see the
      // matching assertion in engine.test.ts.
      expect(seat.stack + seat.committed).toBe(ENTRY_FEE);
    }
  });

  it("a vacated middle seat can be refilled, and the table still fills to a real 6", async () => {
    const { players } = await group(6);
    const { table: opened } = await openSitAndGoTable(players[0].token, TIER);
    await joinSitAndGoTable(players[1].token, opened.id); // seat 1
    await joinSitAndGoTable(players[2].token, opened.id); // seat 2
    await leaveSitAndGoTable(players[1].token, opened.id); // frees seat 1

    const { table: rejoined } = await joinSitAndGoTable(players[1].token, opened.id);
    expect(rejoined.yourSeat).toBe(1); // lands on the vacated seat

    await joinSitAndGoTable(players[3].token, opened.id);
    await joinSitAndGoTable(players[4].token, opened.id);
    const { table: full } = await joinSitAndGoTable(players[5].token, opened.id);
    expect(full.status).toBe("active");
    expect(full.seatedCount).toBe(6);
  });
});

describe("leaving before the deal", () => {
  it("refunds exactly once, and rejects a second leave", async () => {
    const { players: [host, joiner] } = await group(2);
    const { table } = await openSitAndGoTable(host.token, TIER);
    const before = await balance(joiner.token);
    await joinSitAndGoTable(joiner.token, table.id);

    await leaveSitAndGoTable(joiner.token, table.id);
    expect(await balance(joiner.token)).toBe(before);

    await expect(leaveSitAndGoTable(joiner.token, table.id)).rejects.toBeInstanceOf(SitAndGoRequestError);
    expect(await balance(joiner.token)).toBe(before);
  });

  it("hands the host role to the next-registered player rather than cancelling a table others already staked into", async () => {
    const { players: [host, second, third] } = await group(3);
    const { table } = await openSitAndGoTable(host.token, TIER);
    await joinSitAndGoTable(second.token, table.id);
    await joinSitAndGoTable(third.token, table.id);

    await leaveSitAndGoTable(host.token, table.id);
    const { table: after } = await readSitAndGoTableById(second.token, table.id);
    expect(after.hostId).toBe((await ensureProfile(second.token)).id);
    expect(after.seatedCount).toBe(2);
  });

  it("cancels an empty table when its last seat leaves", async () => {
    const { players: [host] } = await group(1);
    const { table } = await openSitAndGoTable(host.token, TIER);
    await leaveSitAndGoTable(host.token, table.id);
    const { table: mine } = await readMySitAndGoTable(host.token);
    expect(mine).toBeNull();
  });
});

describe("settlement", () => {
  it("conserves Gold across a full table -- the group's total never moves", async () => {
    const { players, total } = await group(6);
    const before = await total();
    const winnerBefore = await balance(players[0].token);

    const full = await registerSix(players);
    const game = (await getStoredGame(full.gameId!))!;

    // Simulate the poker engine having just decided a winner -- the same
    // shape setupHand's own elimination branch produces. This is exactly
    // what the /actions and /advance routes hand to settleSitAndGoIfFinished.
    const winner = game.seats[0];
    game.tournament = { ...game.tournament!, winnerProfileId: winner.profileId };

    await settleSitAndGoIfFinished(game);
    const { table: settled } = await readSitAndGoTableById(players[0].token, full.id);
    expect(settled.status).toBe("completed");
    expect(settled.winnerId).toBe(winner.profileId);
    expect(await total()).toBe(before); // zero-sum within the group -- no house, no rake.
    // Paid its entry fee, then won the whole 6-seat pool: net +5x entry.
    expect(await balance(players[0].token)).toBe(winnerBefore + ENTRY_FEE * 5);
  });

  it("pays out exactly once even if the same finished state is handed in twice", async () => {
    const { players } = await group(6);
    const full = await registerSix(players);
    const game = (await getStoredGame(full.gameId!))!;
    const winner = game.seats[0];
    const before = await balance(players[0].token);
    game.tournament = { ...game.tournament!, winnerProfileId: winner.profileId };

    await settleSitAndGoIfFinished(game);
    await settleSitAndGoIfFinished(game); // e.g. a second poll racing the first

    expect(await balance(players[0].token)).toBe(before + ENTRY_FEE * 6);
  });

  it("is a no-op for a table with no winner yet", async () => {
    const { players } = await group(6);
    const full = await registerSix(players);
    const game = (await getStoredGame(full.gameId!))!;
    await settleSitAndGoIfFinished(game); // tournament.winnerProfileId is still null
    const { table: stillActive } = await readSitAndGoTableById(players[0].token, full.id);
    expect(stillActive.status).toBe("active");
  });
});

describe("elimination mid-tournament", () => {
  it("frees a busted player to register elsewhere long before the table they lost concludes", async () => {
    const { players } = await group(6);
    const full = await registerSix(players);
    const game = (await getStoredGame(full.gameId!))!;

    // Player 0 busts out (permanently -- "out", not the mid-hand "all-in"
    // reading), the other five keep playing. The table itself is still very
    // much active: nobody has won yet.
    game.seats[0].stack = 0;
    game.seats[0].status = "out";
    await createStoredGame(game);

    // Without the elimination check, this would 409 "already registered" --
    // the player_row for the table they just lost is never deleted.
    await expect(openSitAndGoTable(players[0].token, TIER)).resolves.toMatchObject({
      table: { status: "waiting" },
    });
    // And readMySitAndGoTable must not hand them back the game they lost --
    // that's what SitAndGoShell's redirect effect reads to decide whether
    // to bounce the browser back into a live poker table.
    const { table: mine } = await readMySitAndGoTable(players[0].token);
    expect(mine?.tier).toBe(TIER);
    expect(mine?.status).toBe("waiting"); // the NEW table, not the old one
  });

  it("still reports the original table as the player's own while they're still alive in it", async () => {
    const { players } = await group(6);
    const full = await registerSix(players);
    // Nobody has busted -- every seat should still read as actively registered.
    const { table: mine } = await readMySitAndGoTable(players[0].token);
    expect(mine?.id).toBe(full.id);
    expect(mine?.status).toBe("active");
  });
});

describe("per-game leaderboard stats", () => {
  it("credits a win to whoever the table pays and a loss to every other registered player", async () => {
    const { players } = await group(6);

    for (let round = 0; round < 3; round += 1) {
      const full = await registerSix(players);
      const game = (await getStoredGame(full.gameId!))!;
      const winner = game.seats[0];
      game.tournament = { ...game.tournament!, winnerProfileId: winner.profileId };
      await settleSitAndGoIfFinished(game);
    }

    const board = await getGameLeaderboard("sit-and-go", 10);
    expect(board).toHaveLength(6);
    const totalRecords = board.reduce((sum, row) => sum + row.stats.wins + row.stats.losses, 0);
    expect(totalRecords).toBe(3 * 6);
    expect(board.reduce((sum, row) => sum + row.stats.wins, 0)).toBe(3);
  });
});

describe("the lobby list", () => {
  it("lists open tables with a live registered count", async () => {
    const { players } = await group(2);
    const { table } = await openSitAndGoTable(players[0].token, TIER);
    await joinSitAndGoTable(players[1].token, table.id);

    const { tables } = await listOpenSitAndGoTables(players[0].token);
    const mine = tables.find((t) => t.id === table.id);
    expect(mine?.seatedCount).toBe(2);
    expect(mine?.mine).toBe(true);
  });
});

describe("readSitAndGoLobby", () => {
  // The route's own single-resolve entry point: same answer as calling
  // readMySitAndGoTable and, only if that comes back empty,
  // listOpenSitAndGoTables -- but resolving the caller's profile once
  // instead of twice. See sit-and-go-service.ts's own comment on why that
  // second resolve mattered enough to fix.
  it("reports the caller's own live table, with no open-table list alongside it", async () => {
    const { players } = await group(1);
    const { table } = await openSitAndGoTable(players[0].token, TIER);

    const { table: lobbyTable, tables } = await readSitAndGoLobby(players[0].token);
    expect(lobbyTable?.id).toBe(table.id);
    expect(tables).toEqual([]);
  });

  it("falls back to the open-table list for a caller with no live registration", async () => {
    const { players } = await group(2);
    const { table } = await openSitAndGoTable(players[0].token, TIER);

    const { table: lobbyTable, tables } = await readSitAndGoLobby(players[1].token);
    expect(lobbyTable).toBeNull();
    expect(tables.find((t) => t.id === table.id)?.seatedCount).toBe(1);
  });
});
