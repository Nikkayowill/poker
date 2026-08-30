import "server-only";
import {
  cancelEmptyHeadsUpTable,
  getHeadsUpSeats,
  getHeadsUpTableById,
  getOpenHeadsUpTables,
  leaveHeadsUpTable,
} from "./heads-up-store";
import {
  cancelEmptyCribbageTable,
  getCribbageSeats,
  getCribbageTableById,
  getOpenCribbageTables,
  leaveCribbageTable,
} from "./cribbage-table-store";
import {
  cancelEmptySitAndGoTable,
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
 * forever -- a host opens it, then nobody joins, or the seat-claim right
 * after creating it fails -- because nothing sweeps a 'waiting' row the way
 * game-store.ts's archiveStaleGames sweeps an abandoned 'playing' one: a
 * pre-deal table has no linked game for that sweep (or heads-up/Sit & Go's
 * own getStaleActive*Tables) to find. Left alone, a stuck table both locks
 * its host's stake in escrow indefinitely AND keeps sitting in front of
 * ordinary quick-play matchmaking (findOpenHeadsUpTable/getOpenCribbageTables/
 * getOpenSitAndGoTables all return oldest-first), so a genuinely fresh
 * player can get paired into a days-old zombie table instead of another
 * live one -- confirmed live 2026-08-30: a heads-up table opened 2026-08-26
 * sat waiting with 5,000 Gold in escrow for four days with no way to see or
 * clear it. (That specific row turned out to have zero seated players at
 * all -- see cancelWaitingPvpTable's own comment -- which was itself a live
 * bug in openHeadsUpQuickPlay, fixed alongside this file.)
 *
 * Cancelling reuses each store's own leaveXTable -- the exact guarded,
 * pre-deal-only path a real player's own "leave" button already calls -- so
 * this can never touch a table that has since dealt out from under it, and
 * every refund goes through creditGoldByProfile the same as any other
 * refund in the app.
 *
 * Three parallel branches per function below, not one generic dispatch over
 * the three kinds: they don't share a common row shape (stake vs. entryFee,
 * a token on some seat rows and not others) closely enough to unify without
 * an `any` escape hatch this codebase doesn't otherwise use, and every
 * sibling store (heads-up-store.ts/cribbage-table-store.ts/sit-and-go-store.ts
 * themselves) already makes the same three-parallel-files choice on purpose.
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
  /** How many players this actually refunded -- 1 for the seatless path below, same as any other seat. */
  cancelledSeats: number;
  refunded: number;
  /** A refund credit failed and was never retried -- see refundSeats' own comment. Applies to the seatless path too: there, "the seat" is the host. */
  refundFailures: number;
}

/**
 * Force-cancels one still-waiting table and refunds whoever's seated,
 * through the same guarded, pre-deal-only leaveXTable a real "leave" click
 * uses. Throws rather than returning a quiet no-op "success" if the table
 * is gone, has since dealt, or turned out not to be cancellable after all --
 * an admin's stale list can be a moment out of date.
 *
 * A table can normally only ever be *seated* down to zero, not *created* at
 * zero (claimHeadsUpSeat/claimCribbageSeat/claimSitAndGoSeat all run right
 * after their own createXTableRow) -- except openHeadsUpQuickPlay's
 * create-new-table branch didn't clean up on a failed claim the way its own
 * invite/cribbage/Sit & Go siblings do, so it could leave exactly that kind
 * of zero-seat 'waiting' row behind (fixed in the same change as this
 * comment). That's confirmed to be exactly what the live table this file's
 * own header describes turned out to be: a heads-up row opened 2026-08-26
 * with zero rows in heads_up_table_players. Before this fix, cancelling it
 * meant looping over zero seats, calling leaveHeadsUpTable zero times, and
 * returning a clean, empty, HTTP-200 "success" while the row itself never
 * moved -- it "came back" on the very next refresh because nothing had
 * actually changed. The seatless case is now just a one-seat refund of the
 * host through refundSeats below, with cancelEmptyXTable (status='waiting',
 * zero seated, matching host) standing in for "leave" -- both paths get its
 * quiet-no-op guard for free.
 */
export async function cancelWaitingPvpTable(kind: PvpTableKind, tableId: string): Promise<CancelWaitingTableResult> {
  if (kind === "heads-up") {
    const table = await getHeadsUpTableById(tableId);
    if (!table || table.status !== "waiting") throw new Error("That table is no longer waiting.");
    const seats = await getHeadsUpSeats(tableId);
    if (seats.length === 0) {
      return refundSeats([{ playerId: table.hostId }], () => cancelEmptyHeadsUpTable(tableId, table.hostId), table.stake);
    }
    return refundSeats(seats, (playerId) => leaveHeadsUpTable(tableId, playerId), table.stake);
  }
  if (kind === "cribbage") {
    const table = await getCribbageTableById(tableId);
    if (!table || table.status !== "waiting") throw new Error("That table is no longer waiting.");
    const seats = await getCribbageSeats(tableId);
    if (seats.length === 0) {
      return refundSeats([{ playerId: table.hostId }], () => cancelEmptyCribbageTable(tableId, table.hostId), table.stake);
    }
    return refundSeats(seats, (playerId) => leaveCribbageTable(tableId, playerId), table.stake);
  }
  const table = await getSitAndGoTableById(tableId);
  if (!table || table.status !== "waiting") throw new Error("That table is no longer waiting.");
  const seats = await getSitAndGoSeats(tableId);
  if (seats.length === 0) {
    return refundSeats([{ playerId: table.hostId }], () => cancelEmptySitAndGoTable(tableId, table.hostId), table.entryFee);
  }
  return refundSeats(seats, (playerId) => leaveSitAndGoTable(tableId, playerId), table.entryFee);
}

/**
 * The seat (or, for a seatless table, the host) is already gone by the time
 * its credit is attempted -- leave()/cancelEmptyXTable() removed it first, to
 * make this whole call safe to retry -- so a failed credit here can't be
 * rolled back, unlike every other creditGoldByProfile call in this app,
 * which either can't fail this late or is allowed to leak in the player's
 * favor. It's still never swallowed: refundFailures surfaces it to the
 * caller (the admin console shows it rather than reporting a clean success),
 * and it's logged with enough to find and manually credit the player, the
 * same as settleHeadsUpIfFinished's own payout-failure log.
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
  // Every leave() call lost its race (the table dealt, someone else's "leave"
  // beat this one to the same seat, or -- the seatless path -- someone else's
  // cancel/deal already claimed it) between the read above and here -- an
  // ordinary outcome, but it must surface as an error, not a quiet empty
  // "success" the caller can't tell apart from having nothing left to do.
  if (cancelledSeats === 0) throw new Error("That table changed before it could be cancelled -- refresh and try again.");
  return { cancelledSeats, refunded, refundFailures };
}
