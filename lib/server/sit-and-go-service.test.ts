import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gameStore from "./game-store";
import { createStoredGame, getStoredGame } from "./game-store";
import { __resetLeaderboardMemory, getGameLeaderboard } from "./leaderboard-store";
import { adjustGold, creditGoldByProfileLedgered, ensureProfile } from "./profile-store";
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
  sweepUndealtSitAndGoTables,
  type SitAndGoTableView,
} from "./sit-and-go-service";
import * as sitAndGoStore from "./sit-and-go-store";
import {
  __backdateSitAndGoTableStartForTest,
  __resetSitAndGoTablesForTest,
  claimSitAndGoSeat,
  getSitAndGoTableById,
  leaveSitAndGoTable as leaveSitAndGoTableRow,
} from "./sit-and-go-store";

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
/** This profile's memory-mode gold_ledger rows, keyed `${correlationId}:${kind}` like the real unique index. */
function ledgerRows(profileId: string) {
  return [...(globalThis.__riverGoldLedger ?? new Map()).entries()]
    .filter(([, row]) => row.profileId === profileId)
    .map(([key, row]) => ({ key, amount: row.amount, kind: row.kind }));
}

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

afterEach(() => {
  vi.restoreAllMocks();
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

describe("Gold ledger", () => {
  it("records each entry fee as a ledgered debit the reconcile sweep can see", async () => {
    const { players: [host, joiner] } = await group(2);
    const { table } = await openSitAndGoTable(host.token, TIER);
    await joinSitAndGoTable(joiner.token, table.id);

    const [hostRow] = ledgerRows(host.id);
    expect(hostRow.key).toMatch(/^sit_and_go_open_fee:.+:debit$/);
    expect(hostRow.amount).toBe(-ENTRY_FEE);
    const [joinerRow] = ledgerRows(joiner.id);
    expect(joinerRow.key).toMatch(/^sit_and_go_join_fee:.+:debit$/);
    expect(joinerRow.amount).toBe(-ENTRY_FEE);
  });

  it("refunds a join that finds the table already dealt against the same ledger entry", async () => {
    const { players } = await group(6);
    const full = await registerSix(players);
    const late = await funded();
    const before = await balance(late.token);

    await expect(joinSitAndGoTable(late.token, full.id)).rejects.toBeInstanceOf(SitAndGoRequestError);
    expect(await balance(late.token)).toBe(before);
    const rows = ledgerRows(late.id);
    expect(rows.map((r) => r.kind).sort()).toEqual(["credit", "debit"]);
    const correlationIds = rows.map((r) => r.key.replace(/:(debit|credit)$/, ""));
    expect(correlationIds[0]).toBe(correlationIds[1]);
  });
});

describe("a deal whose game can't be started", () => {
  it("cancels the table and refunds every entry fee once when the game write fails", async () => {
    const { players, total } = await group(6);
    const before = await total();
    vi.spyOn(gameStore, "createStoredGame").mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const last = await registerSix(players);
    expect(last.status).toBe("cancelled");
    expect(last.gameId).toBeNull();
    expect(await total()).toBe(before);
    for (const player of players) {
      expect((await readMySitAndGoTable(player.token)).table).toBeNull();
    }
  });

  it("archives the game and refunds when the game can't be linked to the table", async () => {
    const { players, total } = await group(6);
    const before = await total();
    const realCreate = gameStore.createStoredGame;
    const written: string[] = [];
    vi.spyOn(gameStore, "createStoredGame").mockImplementation(async (state) => {
      written.push(state.id);
      return realCreate(state);
    });
    vi.spyOn(sitAndGoStore, "setSitAndGoGameId").mockResolvedValueOnce(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const last = await registerSix(players);
    expect(last.status).toBe("cancelled");
    expect(written).toHaveLength(1);
    expect((await getStoredGame(written[0]))?.status).toBe("archived");
    expect(await total()).toBe(before);
  });

  it("sweeps a table a crash left active with no game, refunding each fee exactly once", async () => {
    const { players, total } = await group(6);
    const before = await total();
    // Both deal-failure paths out: the table stays active with no game,
    // which is what a crash between the two deal steps leaves behind.
    vi.spyOn(gameStore, "createStoredGame").mockRejectedValueOnce(new Error("crash"));
    vi.spyOn(sitAndGoStore, "cancelStaleSitAndGoTable").mockResolvedValueOnce(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const stuck = await registerSix(players);
    expect(stuck.status).toBe("active");
    expect(stuck.gameId).toBeNull();
    expect(await total()).toBe(before - ENTRY_FEE * 6);

    // Too fresh to sweep: a real deal could still be finishing.
    expect(await sweepUndealtSitAndGoTables()).toBe(0);

    __backdateSitAndGoTableStartForTest(stuck.id, new Date(Date.now() - 10 * 60 * 1000).toISOString());
    expect(await sweepUndealtSitAndGoTables()).toBe(1);
    expect((await getSitAndGoTableById(stuck.id))?.status).toBe("cancelled");
    expect(await total()).toBe(before);

    expect(await sweepUndealtSitAndGoTables()).toBe(0);
    expect(await total()).toBe(before);
    // Everyone is free to register again.
    const { table } = await openSitAndGoTable(players[0].token, TIER);
    expect(table.status).toBe("waiting");
  });

  it("builds the game from the seats read after the table is locked", async () => {
    const { players } = await group(6);
    const newcomer = await funded();
    const realDeal = sitAndGoStore.dealSitAndGoTable;
    vi.spyOn(sitAndGoStore, "dealSitAndGoTable").mockImplementationOnce(async (tableId, expectedSeats) => {
      // Between the pre-deal seat count and the lock, one registrant is
      // swapped for another. The count still matches.
      await leaveSitAndGoTableRow(tableId, players[1].id);
      await claimSitAndGoSeat(tableId, newcomer.id, newcomer.token, `test_stake:${newcomer.id}`);
      return realDeal(tableId, expectedSeats);
    });

    const dealt = await registerSix(players);
    expect(dealt.status).toBe("active");
    const game = await getStoredGame(dealt.gameId!);
    const seated = game?.seats.map((seat) => seat.profileId) ?? [];
    expect(seated).toContain(newcomer.id);
    expect(seated).not.toContain(players[1].id);
  });
});

describe("leaving before the deal", () => {
  it("credits the refund under the entry fee's own correlation id, so the reconcile cron can't refund it again", async () => {
    const { players: [host, joiner] } = await group(2);
    const { table } = await openSitAndGoTable(host.token, TIER);
    const before = await balance(joiner.token);
    await joinSitAndGoTable(joiner.token, table.id);
    await leaveSitAndGoTable(joiner.token, table.id);

    const rows = ledgerRows(joiner.id);
    expect(rows.map((row) => row.kind).sort()).toEqual(["credit", "debit"]);
    const [feeId, refundId] = rows.map((row) => row.key.replace(/:(debit|credit)$/, ""));
    expect(refundId).toBe(feeId);

    const cron = await creditGoldByProfileLedgered(joiner.id, ENTRY_FEE, feeId, "reconciliation_refund:test");
    expect(cron).toMatchObject({ success: true, alreadyApplied: true });
    expect(await balance(joiner.token)).toBe(before);
  });

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

  it("pays the prize pool once, under the table's ledger key, however often it is settled", async () => {
    const { players, total } = await group(6);
    const before = await total();
    const full = await registerSix(players);
    const game = (await getStoredGame(full.gameId!))!;
    const winner = game.seats[0];
    const winnerToken = players.find((player) => player.id === winner.profileId)!.token;
    const winnerBefore = await balance(winnerToken);
    game.tournament = { ...game.tournament!, winnerProfileId: winner.profileId };

    const paid = await settleSitAndGoIfFinished(game);
    expect(paid?.goldBalance).toBe(winnerBefore + ENTRY_FEE * 6);
    // A completed table must not pay a second pot, ledger row or not.
    expect(await settleSitAndGoIfFinished(game)).toBeNull();
    expect(await balance(winnerToken)).toBe(winnerBefore + ENTRY_FEE * 6);
    expect(await total()).toBe(before);
    expect(ledgerRows(winner.profileId!).some((row) => row.key === `sit_and_go_payout:${full.id}:credit`)).toBe(true);
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
