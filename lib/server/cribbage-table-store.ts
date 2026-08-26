import "server-only";
import { randomUUID } from "crypto";
import type { CribbageSeat, CribbageState } from "@/lib/cribbage/engine";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for cribbage tables: the join-table shape lib/server/
 * pvp-match-store.ts can't use, since it's fixed at 2 players. Twin-branch,
 * same as every other store here: Supabase when configured, an in-process
 * Map otherwise, and the memory branch replicates the same guards the
 * migration's constraints and RPCs enforce, because `npm test` and a no-env
 * dev server both run on it.
 *
 * Dealing a table into existence is one code path regardless of what
 * triggered it: a 4th join filling the table, or the host starting early
 * once 3 are seated, both go through `dealCribbageTable`. Two separate paths
 * that could each write `status = 'active'` would be two places a race
 * could deal the same table twice.
 */

export type CribbageTableStatus = "waiting" | "active" | "completed" | "cancelled";

export interface StoredCribbageTable {
  id: string;
  hostId: string;
  stake: number;
  status: CribbageTableStatus;
  version: number;
  state: CribbageState | null;
  winnerId: string | null;
  createdAt: string;
  startedAt: string | null;
  settledAt: string | null;
}

export interface CribbageSeatRow {
  seat: CribbageSeat;
  playerId: string;
  joinedAt: string;
}

/** A guard genuinely failed (table full, already started, not the host, too few players): an ordinary outcome, not a fault. */
export class CribbageTableNotJoinable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CribbageTableNotJoinable";
  }
}

declare global {
  var __riverRoomCribbageTables: Map<string, StoredCribbageTable> | undefined;
  var __riverRoomCribbageSeats: Map<string, CribbageSeatRow[]> | undefined;
}

const memoryTables = globalThis.__riverRoomCribbageTables ?? new Map<string, StoredCribbageTable>();
globalThis.__riverRoomCribbageTables = memoryTables;
const memorySeats = globalThis.__riverRoomCribbageSeats ?? new Map<string, CribbageSeatRow[]>();
globalThis.__riverRoomCribbageSeats = memorySeats;

/** Test seam only: the memory branch is process-global, so suites must not let tables leak into each other. */
export function __resetCribbageTablesForTest(): void {
  memoryTables.clear();
  memorySeats.clear();
}

function cloneTable(table: StoredCribbageTable): StoredCribbageTable {
  return { ...table, state: table.state ? structuredClone(table.state) : null };
}

const TABLE_COLUMNS = "id, host_id, stake, status, version, state, winner_id, created_at, started_at, settled_at";

interface TableRow {
  id: string;
  host_id: string;
  stake: number | string;
  status: string;
  version: number | string;
  state: unknown;
  winner_id: string | null;
  created_at: string;
  started_at: string | null;
  settled_at: string | null;
}

function fromRow(row: TableRow): StoredCribbageTable {
  return {
    id: String(row.id),
    hostId: String(row.host_id),
    stake: Number(row.stake),
    status: String(row.status) as CribbageTableStatus,
    version: Number(row.version),
    state: (row.state as CribbageState | null) ?? null,
    winnerId: row.winner_id ? String(row.winner_id) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

// ---- reads ------------------------------------------------------------

export async function getCribbageTableById(id: string): Promise<StoredCribbageTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryTables.get(id);
    return found ? cloneTable(found) : null;
  }
  const { data, error } = await supabase
    .from("cribbage_tables")
    .select(TABLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load that cribbage table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/** Every seat at a table, ordered by seat number; this is the pegging/dealer turn order. */
export async function getCribbageSeats(tableId: string): Promise<CribbageSeatRow[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...(memorySeats.get(tableId) ?? [])].sort((a, b) => a.seat - b.seat);
  }
  const { data, error } = await supabase
    .from("cribbage_table_players")
    .select("seat, player_id, joined_at")
    .eq("table_id", tableId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`Could not load that table's seats: ${error.message}`);
  return (data ?? []).map((row) => ({
    seat: Number(row.seat),
    playerId: String(row.player_id),
    joinedAt: String(row.joined_at),
  }));
}

/**
 * How many are seated at each of these tables, in one round trip. Feeds the
 * lobby list, which every connected browser polls every 2s. One query
 * grouped in JS rather than one `getCribbageSeats` call per table, since the
 * latter scales DB load linearly with how many open tables there are, on a
 * path that's already hit at a fixed cadence regardless of load.
 */
export async function getSeatCountsForTables(tableIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (tableIds.length === 0) return counts;

  const supabase = adminClient();
  if (!supabase) {
    for (const id of tableIds) counts.set(id, (memorySeats.get(id) ?? []).length);
    return counts;
  }

  const { data, error } = await supabase
    .from("cribbage_table_players")
    .select("table_id")
    .in("table_id", tableIds);
  if (error) throw new Error(`Could not load seated counts: ${error.message}`);
  for (const row of data ?? []) {
    const id = String(row.table_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Open (waiting) tables at this stake, newest first: the lobby list. */
export async function getOpenCribbageTables(stake?: number): Promise<StoredCribbageTable[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryTables.values()]
      .filter((table) => table.status === "waiting" && (stake === undefined || table.stake === stake))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneTable);
  }
  let query = supabase.from("cribbage_tables").select(TABLE_COLUMNS).eq("status", "waiting");
  if (stake !== undefined) query = query.eq("stake", stake);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load open cribbage tables: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as TableRow));
}

/**
 * The caller's own live (waiting or active) table, if any.
 *
 * Picks the most recent rather than erroring on more than one row: see
 * cribbage_table_players_player_idx's comment in the migration. "One live
 * table per player" is an application-level guard here, not a hard
 * constraint, so this has to degrade gracefully rather than assume at most
 * one row can exist.
 */
export async function getActiveCribbageTableFor(playerId: string): Promise<StoredCribbageTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const seatedTableIds = new Set(
      [...memorySeats.entries()].filter(([, seats]) => seats.some((s) => s.playerId === playerId)).map(([id]) => id),
    );
    const candidates = [...memoryTables.values()]
      .filter((table) => seatedTableIds.has(table.id) && (table.status === "waiting" || table.status === "active"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return candidates[0] ? cloneTable(candidates[0]) : null;
  }

  const { data: seatRows, error: seatError } = await supabase
    .from("cribbage_table_players")
    .select("table_id")
    .eq("player_id", playerId);
  if (seatError) throw new Error(`Could not load your cribbage tables: ${seatError.message}`);
  const tableIds = [...new Set((seatRows ?? []).map((row) => String(row.table_id)))];
  if (tableIds.length === 0) return null;

  const { data, error } = await supabase
    .from("cribbage_tables")
    .select(TABLE_COLUMNS)
    .in("id", tableIds)
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load your cribbage table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/**
 * How long after a table completes it still counts as "recently completed"
 * for getRecentlyCompletedCribbageTableFor. Same reasoning as pvp-match-
 * store.ts's SETTLED_MATCH_GRACE_MS: it only needs to outlast one poll cycle
 * with room for jitter, since a client that has already picked the result up
 * once holds onto it locally until the player dismisses it.
 */
const COMPLETED_TABLE_GRACE_MS = 20_000;

/**
 * A table this player was seated at that completed moments ago.
 *
 * getActiveCribbageTableFor stops returning a table the instant it
 * completes, which is correct for the "are you already at a table" gate,
 * but it means a seated player whose own request didn't do the settling
 * (someone else's move crossed 121, or someone else resigned) has no other
 * way to find out: their next poll would return nothing and silently drop
 * them back to the lobby.
 */
export async function getRecentlyCompletedCribbageTableFor(playerId: string): Promise<StoredCribbageTable | null> {
  const supabase = adminClient();
  const cutoff = Date.now() - COMPLETED_TABLE_GRACE_MS;

  if (!supabase) {
    const seatedTableIds = new Set(
      [...memorySeats.entries()].filter(([, seats]) => seats.some((s) => s.playerId === playerId)).map(([id]) => id),
    );
    const candidates = [...memoryTables.values()]
      .filter(
        (t) =>
          seatedTableIds.has(t.id)
          && t.status === "completed"
          && t.settledAt !== null
          && Date.parse(t.settledAt) >= cutoff,
      )
      .sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));
    return candidates[0] ? cloneTable(candidates[0]) : null;
  }

  const { data: seatRows, error: seatError } = await supabase
    .from("cribbage_table_players")
    .select("table_id")
    .eq("player_id", playerId);
  if (seatError) throw new Error(`Could not load your cribbage tables: ${seatError.message}`);
  const tableIds = [...new Set((seatRows ?? []).map((row) => String(row.table_id)))];
  if (tableIds.length === 0) return null;

  const { data, error } = await supabase
    .from("cribbage_tables")
    .select(TABLE_COLUMNS)
    .in("id", tableIds)
    .eq("status", "completed")
    .gte("settled_at", new Date(cutoff).toISOString())
    .order("settled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load your cribbage table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

// ---- writes -------------------------------------------------------------

/** Opens a bare table, host not yet seated; the caller seats them with claimCribbageSeat right after. */
export async function createCribbageTableRow(hostId: string, stake: number): Promise<StoredCribbageTable> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const table: StoredCribbageTable = {
      id: randomUUID(),
      hostId,
      stake,
      status: "waiting",
      version: 1,
      state: null,
      winnerId: null,
      createdAt: now,
      startedAt: null,
      settledAt: null,
    };
    memoryTables.set(table.id, cloneTable(table));
    memorySeats.set(table.id, []);
    return cloneTable(table);
  }

  const { data, error } = await supabase
    .from("cribbage_tables")
    .insert({ host_id: hostId, stake, status: "waiting", version: 1 })
    .select(TABLE_COLUMNS)
    .single();
  if (error) throw new Error(`Could not open a cribbage table: ${error.message}`);
  return fromRow(data as TableRow);
}

/**
 * Assigns the next open seat (0-3) to `playerId`. Throws
 * CribbageTableNotJoinable for every ordinary reason this can fail (full,
 * already started, gone); the caller (the service) turns that into a
 * player-facing message. Anything else is a real fault.
 */
export async function claimCribbageSeat(
  tableId: string,
  playerId: string,
): Promise<{ seat: CribbageSeat; seatedCount: number; hostId: string }> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table) throw new CribbageTableNotJoinable("No such table.");
    if (table.status !== "waiting") throw new CribbageTableNotJoinable("That table is no longer taking players.");
    const seats = memorySeats.get(tableId) ?? [];
    if (seats.some((s) => s.playerId === playerId)) {
      throw new CribbageTableNotJoinable("You are already seated at that table.");
    }
    if (seats.length >= 4) throw new CribbageTableNotJoinable("That table is full.");
    // The lowest open seat, not the seated count: a seat vacated by an
    // earlier leave is a real gap. Assigning `seats.length` there would
    // collide with whoever already holds the highest seat number and
    // permanently strand the vacated seat, matching the exact race the
    // migration's claim_cribbage_seat RPC closes on the Supabase branch.
    const taken = new Set(seats.map((s) => s.seat));
    let seat = 0;
    while (taken.has(seat)) seat += 1;
    const next = [...seats, { seat: seat as CribbageSeat, playerId, joinedAt: new Date().toISOString() }];
    memorySeats.set(tableId, next);
    return { seat, seatedCount: next.length, hostId: table.hostId };
  }

  const { data, error } = await supabase
    .rpc("claim_cribbage_seat", { p_table_id: tableId, p_player_id: playerId })
    .single();
  if (error) {
    if (error.code === "23505") throw new CribbageTableNotJoinable("You are already seated at that table.");
    if (error.code === "P0001") throw new CribbageTableNotJoinable(error.message);
    throw new Error(`Could not join that cribbage table: ${error.message}`);
  }
  const result = data as { seat: number; seated_count: number; host_id: string };
  return { seat: result.seat as CribbageSeat, seatedCount: result.seated_count, hostId: String(result.host_id) };
}

/**
 * The one transition out of 'waiting'. Returns null when the guard failed
 * (the seated count no longer matches what `state` was built for, table
 * already started, caller is not the host for an early start) rather than
 * throwing. It's an ordinary race outcome, treated the same way a lost
 * optimistic-concurrency write is treated elsewhere: nothing happened, and
 * in particular nothing was paid.
 *
 * `expectedSeats` must match the seated count exactly, not merely satisfy a
 * floor: see the migration's own header on deal_cribbage_table for why a
 * ">=" guard here is a real money bug (a join racing a host's early start
 * can strand a seated, debited player's Gold for good).
 */
export async function dealCribbageTable(input: {
  tableId: string;
  actorId: string;
  requireHost: boolean;
  expectedSeats: number;
  state: CribbageState;
}): Promise<StoredCribbageTable | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const table = memoryTables.get(input.tableId);
    if (!table || table.status !== "waiting") return null;
    if (input.requireHost && table.hostId !== input.actorId) return null;
    const seatedCount = (memorySeats.get(input.tableId) ?? []).length;
    if (seatedCount !== input.expectedSeats) return null;
    const dealt: StoredCribbageTable = {
      ...table,
      status: "active",
      state: structuredClone(input.state),
      version: table.version + 1,
      startedAt: now,
    };
    memoryTables.set(input.tableId, cloneTable(dealt));
    return cloneTable(dealt);
  }

  const { data, error } = await supabase
    .rpc("deal_cribbage_table", {
      p_table_id: input.tableId,
      p_actor_id: input.actorId,
      p_require_host: input.requireHost,
      p_expected_seats: input.expectedSeats,
      p_state: input.state,
    })
    .single();
  if (error) {
    if (error.code === "P0001") return null;
    throw new Error(`Could not start that cribbage table: ${error.message}`);
  }
  return data ? fromRow(data as TableRow) : null;
}

/**
 * Unwinds a table whose host could not be seated right after creation.
 * Guarded (still 'waiting', genuinely zero seats) so it can never touch a
 * table anyone has actually joined. Returns whether it actually cancelled
 * one, so the caller does not report success for a table that was somehow
 * already gone.
 */
export async function cancelEmptyCribbageTable(tableId: string, hostId: string): Promise<boolean> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table || table.status !== "waiting" || table.hostId !== hostId) return false;
    if ((memorySeats.get(tableId) ?? []).length > 0) return false;
    memoryTables.delete(tableId);
    memorySeats.delete(tableId);
    return true;
  }

  const { data, error } = await supabase
    .rpc("cancel_empty_cribbage_table", { p_table_id: tableId, p_host_id: hostId })
    .maybeSingle();
  if (error) throw new Error(`Could not clean up that cribbage table: ${error.message}`);
  return Boolean(data);
}

/** Pre-deal only. Returns the removed seat, or null if there was nothing to leave (already started, not seated). */
export async function leaveCribbageTable(
  tableId: string,
  playerId: string,
): Promise<CribbageSeatRow | null> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table || table.status !== "waiting") return null;
    const seats = memorySeats.get(tableId) ?? [];
    const left = seats.find((s) => s.playerId === playerId);
    if (!left) return null;
    const remaining = seats.filter((s) => s.playerId !== playerId);
    memorySeats.set(tableId, remaining);
    if (remaining.length === 0) {
      memoryTables.set(tableId, { ...table, status: "cancelled" });
    } else if (table.hostId === playerId) {
      const newHost = [...remaining].sort((a, b) => a.seat - b.seat)[0];
      memoryTables.set(tableId, { ...table, hostId: newHost.playerId });
    }
    return left;
  }

  const { data, error } = await supabase
    .rpc("leave_cribbage_table", { p_table_id: tableId, p_player_id: playerId })
    .maybeSingle();
  if (error) throw new Error(`Could not leave that cribbage table: ${error.message}`);
  if (!data) return null;
  const row = data as { seat: number; player_id: string; joined_at: string };
  return { seat: row.seat as CribbageSeat, playerId: String(row.player_id), joinedAt: String(row.joined_at) };
}

/**
 * Writes the next state, but only if nobody else already did: identical
 * contract to lib/server/pvp-match-store.ts's advancePvpMatch, generalized
 * from a winner seat to a winner profile id since cribbage has no fixed
 * seat-to-profile mapping the way a 2-tuple duel does.
 *
 * Returns null on a lost race. The caller must not pay out on a null
 * return; this guard is the entire reason a pot is credited exactly once.
 */
export async function advanceCribbageTable(
  current: StoredCribbageTable,
  next: CribbageState,
  settle: { winnerId: string } | null,
): Promise<StoredCribbageTable | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const now = new Date().toISOString();
  const status: CribbageTableStatus = settle ? "completed" : "active";

  if (!supabase) {
    const stored = memoryTables.get(current.id);
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredCribbageTable = {
      ...stored,
      version,
      status,
      state: next,
      winnerId: settle ? settle.winnerId : null,
      settledAt: settle ? now : null,
    };
    memoryTables.set(current.id, cloneTable(updated));
    return cloneTable(updated);
  }

  const { data, error } = await supabase
    .from("cribbage_tables")
    .update({
      version,
      status,
      state: next,
      winner_id: settle ? settle.winnerId : null,
      settled_at: settle ? now : null,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(TABLE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not save that cribbage table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}
