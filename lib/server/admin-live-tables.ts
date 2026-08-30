import "server-only";
import {
  getHeadsUpSeats,
  getHeadsUpTableById,
  getOpenHeadsUpTables,
  leaveHeadsUpTable as leaveHeadsUpTableRow,
} from "./heads-up-store";
import {
  getCribbageSeats,
  getCribbageTableById,
  getOpenCribbageTables,
  leaveCribbageTable,
} from "./cribbage-table-store";
import {
  getSitAndGoSeats,
  getSitAndGoTableById,
  getOpenSitAndGoTables,
  leaveSitAndGoTable,
  SIT_AND_GO_SEATS,
} from "./sit-and-go-store";
import { creditGoldByProfile, getPublicProfilesByIds } from "./profile-store";

/** claimCribbageSeat's own hardcoded cap (lib/server/cribbage-table-store.ts) -- that store exports no constant for it. */
const CRIBBAGE_SEATS = 4;

/**
 * Admin visibility + cleanup for the three "waiting" PvP lobbies (heads-up,
 * cribbage, Sit & Go). Every one of them can leave a waiting table behind
 * forever -- a host opens it, then closes the tab without ever hitting
 * "leave" -- because nothing sweeps a 'waiting' row the way
 * game-store.ts's archiveStaleGames sweeps an abandoned 'playing' one: a
 * pre-deal table has no linked game for that sweep (or heads-up/Sit & Go's
 * own getStaleActive*Tables) to find. Left alone, a stuck table both locks
 * its host's stake in escrow indefinitely AND keeps sitting in front of
 * ordinary quick-play matchmaking (findOpenHeadsUpTable/getOpenCribbageTables/
 * getOpenSitAndGoTables all return oldest-first), so a genuinely fresh
 * player can get paired into a days-old zombie table instead of another
 * live one -- confirmed live 2026-08-30: a heads-up table opened 2026-08-26
 * sat waiting with 5,000 Gold in escrow for four days with no way to see or
 * clear it.
 *
 * Cancelling reuses each store's own leaveXTable -- the exact guarded,
 * pre-deal-only path a real player's own "leave" button already calls -- so
 * this can never touch a table that has since dealt out from under it, and
 * every refund goes through creditGoldByProfile the same as any other
 * refund in the app.
 *
 * Deliberately a manual, admin-picks-one-table action rather than an
 * automatic age-based sweep: unlike an abandoned mid-hand table, a
 * genuinely-still-waiting host hasn't done anything wrong -- they just
 * haven't found an opponent yet, which can take a while at a quiet tier.
 * Only a human looking at "this one is 4 days old" should cancel it.
 */

export type PvpTableKind = "heads-up" | "cribbage" | "sit-and-go";

export interface WaitingPvpTableView {
  kind: PvpTableKind;
  id: string;
  hostId: string;
  hostName: string;
  stake: number;
  label: string;
  seatedCount: number;
  capacity: number;
  createdAt: string;
}

/** Every currently-waiting table across all three PvP lobbies, oldest first -- the admin console's own list. */
export async function listWaitingPvpTables(): Promise<WaitingPvpTableView[]> {
  const [headsUp, cribbage, sitAndGo] = await Promise.all([
    getOpenHeadsUpTables(),
    getOpenCribbageTables(),
    getOpenSitAndGoTables(),
  ]);

  const hostIds = [...headsUp, ...cribbage, ...sitAndGo].map((table) => table.hostId);
  const profiles = await getPublicProfilesByIds(hostIds);
  const nameOf = (id: string) => profiles.get(id)?.displayName ?? "Player";

  const rows = await Promise.all([
    ...headsUp.map(async (table): Promise<WaitingPvpTableView> => ({
      kind: "heads-up",
      id: table.id,
      hostId: table.hostId,
      hostName: nameOf(table.hostId),
      stake: table.stake,
      label: `Heads-Up · ${table.tier}`,
      seatedCount: (await getHeadsUpSeats(table.id)).length,
      capacity: 2,
      createdAt: table.createdAt,
    })),
    ...cribbage.map(async (table): Promise<WaitingPvpTableView> => ({
      kind: "cribbage",
      id: table.id,
      hostId: table.hostId,
      hostName: nameOf(table.hostId),
      stake: table.stake,
      label: "Cribbage",
      seatedCount: (await getCribbageSeats(table.id)).length,
      capacity: CRIBBAGE_SEATS,
      createdAt: table.createdAt,
    })),
    ...sitAndGo.map(async (table): Promise<WaitingPvpTableView> => ({
      kind: "sit-and-go",
      id: table.id,
      hostId: table.hostId,
      hostName: nameOf(table.hostId),
      stake: table.entryFee,
      label: `Sit & Go · ${table.tier}`,
      seatedCount: (await getSitAndGoSeats(table.id)).length,
      capacity: SIT_AND_GO_SEATS,
      createdAt: table.createdAt,
    })),
  ]);

  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface CancelWaitingTableResult {
  cancelledSeats: number;
  refunded: number;
  /** A seat was removed but its credit failed and was never retried -- see refundSeats' own comment. */
  refundFailures: number;
}

/**
 * Force-cancels one still-waiting table and refunds every seated player's
 * stake, one seat at a time through the same leaveXTable guard a real
 * "leave" click uses. Throws if the table is gone or has since dealt --
 * an admin's stale list can be a moment out of date, and this must never
 * touch an active match.
 */
export async function cancelWaitingPvpTable(kind: PvpTableKind, tableId: string): Promise<CancelWaitingTableResult> {
  if (kind === "heads-up") {
    const table = await getHeadsUpTableById(tableId);
    if (!table || table.status !== "waiting") throw new Error("That table is no longer waiting.");
    const seats = await getHeadsUpSeats(tableId);
    return refundSeats(seats, (playerId) => leaveHeadsUpTableRow(tableId, playerId), table.stake);
  }
  if (kind === "cribbage") {
    const table = await getCribbageTableById(tableId);
    if (!table || table.status !== "waiting") throw new Error("That table is no longer waiting.");
    const seats = await getCribbageSeats(tableId);
    return refundSeats(seats, (playerId) => leaveCribbageTable(tableId, playerId), table.stake);
  }
  const table = await getSitAndGoTableById(tableId);
  if (!table || table.status !== "waiting") throw new Error("That table is no longer waiting.");
  const seats = await getSitAndGoSeats(tableId);
  return refundSeats(seats, (playerId) => leaveSitAndGoTable(tableId, playerId), table.entryFee);
}

/**
 * The seat is already gone by the time its credit is attempted (leave()
 * removed it to make the cancel itself safe to retry), so a failed credit
 * here can't be rolled back -- unlike every other creditGoldByProfile call
 * in this app, which either can't fail this late or is allowed to leak in
 * the player's favor. It's still never swallowed: refundFailures surfaces
 * it to the caller (the admin console shows it rather than reporting a
 * clean success), and it's logged with enough to find and manually credit
 * the player, the same as settleHeadsUpIfFinished's own payout-failure log.
 */
async function refundSeats(
  seats: { playerId: string }[],
  leave: (playerId: string) => Promise<unknown>,
  stake: number,
): Promise<CancelWaitingTableResult> {
  let cancelledSeats = 0;
  let refunded = 0;
  let refundFailures = 0;
  for (const seat of seats) {
    const left = await leave(seat.playerId);
    if (!left) continue;
    cancelledSeats += 1;
    try {
      await creditGoldByProfile(seat.playerId, stake);
      refunded += stake;
    } catch (error) {
      refundFailures += 1;
      console.error("admin.pvp_table_cancel_refund_failed", { playerId: seat.playerId, stake, error });
    }
  }
  return { cancelledSeats, refunded, refundFailures };
}
