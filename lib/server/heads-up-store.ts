import "server-only";
import { randomUUID } from "crypto";
import type { StakesTier } from "@/lib/game/tiers";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for heads-up match tables: the thin escrow/matchmaking wrapper
 * around a real poker game, not the poker state itself (see the migration's
 * own header, supabase/migrations/20260826140000_heads_up_tables.sql). Twin
 * branch, same as every other store here: Supabase when configured, an
 * in-process Map otherwise, mirroring lib/server/cribbage-table-store.ts's
 * shape at 2 seats instead of 3-4 and a `game_id` link instead of its own
 * `state` column.
 *
 * Dealing a table into existence is one code path (dealHeadsUpTableIfReady
 * in heads-up-service.ts) regardless of what triggered it: an open quick-play
 * table's 2nd seat filling, or a specific friend accepting an invite. Both
 * call claimHeadsUpSeat then dealHeadsUpTable, same "one path can deal" shape
 * cribbage's own store documents.
 */

export type HeadsUpTableStatus = "waiting" | "active" | "completed" | "cancelled";

export interface StoredHeadsUpTable {
  id: string;
  hostId: string;
  tier: StakesTier;
  stake: number;
  status: HeadsUpTableStatus;
  version: number;
  inviteeId: string | null;
  gameId: string | null;
  winnerId: string | null;
  createdAt: string;
  startedAt: string | null;
  settledAt: string | null;
}

export interface HeadsUpSeatRow {
  seat: 0 | 1;
  playerId: string;
  /**
   * The session token this seat joined with -- what createHeadsUpGame's own
   * entrant.token needs to build a real, actionable poker Seat.ownerToken.
   * See the migration's own comment on this column for why it's captured
   * here rather than derived at deal time.
   */
  token: string;
  joinedAt: string;
}

/** A guard genuinely failed (table full, already started, reserved for someone else): an ordinary outcome, not a fault. */
export class HeadsUpTableNotJoinable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadsUpTableNotJoinable";
  }
}

declare global {
  var __riverRoomHeadsUpTables: Map<string, StoredHeadsUpTable> | undefined;
  var __riverRoomHeadsUpSeats: Map<string, HeadsUpSeatRow[]> | undefined;
}

const memoryTables = globalThis.__riverRoomHeadsUpTables ?? new Map<string, StoredHeadsUpTable>();
globalThis.__riverRoomHeadsUpTables = memoryTables;
const memorySeats = globalThis.__riverRoomHeadsUpSeats ?? new Map<string, HeadsUpSeatRow[]>();
globalThis.__riverRoomHeadsUpSeats = memorySeats;

/** Test seam only: the memory branch is process-global, so suites must not let tables leak into each other. */
export function __resetHeadsUpTablesForTest(): void {
  memoryTables.clear();
  memorySeats.clear();
}

function cloneTable(table: StoredHeadsUpTable): StoredHeadsUpTable {
  return { ...table };
}

const TABLE_COLUMNS =
  "id, host_id, tier, stake, status, version, invitee_id, game_id, winner_id, created_at, started_at, settled_at";

interface TableRow {
  id: string;
  host_id: string;
  tier: string;
  stake: number | string;
  status: string;
  version: number | string;
  invitee_id: string | null;
  game_id: string | null;
  winner_id: string | null;
  created_at: string;
  started_at: string | null;
  settled_at: string | null;
}

function fromRow(row: TableRow): StoredHeadsUpTable {
  return {
    id: String(row.id),
    hostId: String(row.host_id),
    tier: row.tier as StakesTier,
    stake: Number(row.stake),
    status: String(row.status) as HeadsUpTableStatus,
    version: Number(row.version),
    inviteeId: row.invitee_id ? String(row.invitee_id) : null,
    gameId: row.game_id ? String(row.game_id) : null,
    winnerId: row.winner_id ? String(row.winner_id) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

// ---- reads ------------------------------------------------------------

export async function getHeadsUpTableById(id: string): Promise<StoredHeadsUpTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryTables.get(id);
    return found ? cloneTable(found) : null;
  }
  const { data, error } = await supabase
    .from("heads_up_tables")
    .select(TABLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load that heads-up table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/** The table currently linked to this game_id, if any -- used by the stale-table refund sweep. */
export async function getHeadsUpTableByGameId(gameId: string): Promise<StoredHeadsUpTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    for (const table of memoryTables.values()) {
      if (table.gameId === gameId) return cloneTable(table);
    }
    return null;
  }
  const { data, error } = await supabase
    .from("heads_up_tables")
    .select(TABLE_COLUMNS)
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw new Error(`Could not load that heads-up table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

export async function getHeadsUpSeats(tableId: string): Promise<HeadsUpSeatRow[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...(memorySeats.get(tableId) ?? [])].sort((a, b) => a.seat - b.seat);
  }
  const { data, error } = await supabase
    .from("heads_up_table_players")
    .select("seat, player_id, token, joined_at")
    .eq("table_id", tableId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`Could not load that table's seats: ${error.message}`);
  return (data ?? []).map((row) => ({
    seat: Number(row.seat) as 0 | 1,
    playerId: String(row.player_id),
    token: String(row.token),
    joinedAt: String(row.joined_at),
  }));
}

/** Waiting tables reserved for this specific player -- their own pending-invite poll. */
export async function getHeadsUpTablesInvitingPlayer(playerId: string): Promise<StoredHeadsUpTable[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryTables.values()]
      .filter((table) => table.status === "waiting" && table.inviteeId === playerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneTable);
  }
  const { data, error } = await supabase
    .from("heads_up_tables")
    .select(TABLE_COLUMNS)
    .eq("status", "waiting")
    .eq("invitee_id", playerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load your heads-up invites: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as TableRow));
}

/**
 * The caller's own live (waiting or active) table, if any. Picks the most
 * recent rather than erroring on more than one row, same reasoning as
 * cribbage-table-store.ts's getActiveCribbageTableFor: "one live table per
 * player" is an application-level guard, not a hard constraint.
 */
export async function getActiveHeadsUpTableFor(playerId: string): Promise<StoredHeadsUpTable | null> {
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
    .from("heads_up_table_players")
    .select("table_id")
    .eq("player_id", playerId);
  if (seatError) throw new Error(`Could not load your heads-up tables: ${seatError.message}`);
  const tableIds = [...new Set((seatRows ?? []).map((row) => String(row.table_id)))];
  if (tableIds.length === 0) return null;

  const { data, error } = await supabase
    .from("heads_up_tables")
    .select(TABLE_COLUMNS)
    .in("id", tableIds)
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load your heads-up table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/**
 * The oldest open (non-invite) waiting table at this tier that isn't the
 * caller's own -- the quick-play matchmaking primitive. Deliberately simpler
 * than the cash lobby's findOpenPublicGame (lib/server/game-store.ts): no
 * session-liveness ranking, since a stale opponent here costs nothing worse
 * than an idle seat the existing turn-clock/AFK-forfeit machinery
 * (releaseInactiveSeats -> forfeitTournamentSeat in lib/game/engine.ts)
 * already resolves in the joiner's favor, and a pre-deal waiting row is
 * refundable any time via leaveHeadsUpTable regardless.
 */
export async function findOpenHeadsUpTable(tier: StakesTier, callerId: string): Promise<StoredHeadsUpTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const candidates = [...memoryTables.values()]
      .filter((table) => table.status === "waiting" && table.tier === tier && table.inviteeId === null && table.hostId !== callerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return candidates[0] ? cloneTable(candidates[0]) : null;
  }

  const { data, error } = await supabase
    .from("heads_up_tables")
    .select(TABLE_COLUMNS)
    .eq("status", "waiting")
    .eq("tier", tier)
    .is("invitee_id", null)
    .neq("host_id", callerId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not search for an open heads-up table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

// ---- writes -------------------------------------------------------------

/** Opens a bare table, host not yet seated; the caller seats them with claimHeadsUpSeat right after. */
export async function createHeadsUpTableRow(
  hostId: string,
  tier: StakesTier,
  stake: number,
  inviteeId: string | null,
): Promise<StoredHeadsUpTable> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const table: StoredHeadsUpTable = {
      id: randomUUID(),
      hostId,
      tier,
      stake,
      status: "waiting",
      version: 1,
      inviteeId,
      gameId: null,
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
    .from("heads_up_tables")
    .insert({ host_id: hostId, tier, stake, status: "waiting", version: 1, invitee_id: inviteeId })
    .select(TABLE_COLUMNS)
    .single();
  if (error) throw new Error(`Could not open a heads-up table: ${error.message}`);
  return fromRow(data as TableRow);
}

/**
 * Assigns the next open seat (0 or 1) to `playerId`. Throws
 * HeadsUpTableNotJoinable for every ordinary reason this can fail (full,
 * already started, reserved for someone else, gone); the caller (the
 * service) turns that into a player-facing message.
 */
export async function claimHeadsUpSeat(
  tableId: string,
  playerId: string,
  token: string,
): Promise<{ seat: 0 | 1; seatedCount: number; hostId: string }> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table) throw new HeadsUpTableNotJoinable("No such table.");
    if (table.status !== "waiting") throw new HeadsUpTableNotJoinable("That table is no longer taking players.");
    if (table.inviteeId !== null && table.inviteeId !== playerId && table.hostId !== playerId) {
      throw new HeadsUpTableNotJoinable("This table is reserved for someone else.");
    }
    const seats = memorySeats.get(tableId) ?? [];
    if (seats.some((s) => s.playerId === playerId)) {
      throw new HeadsUpTableNotJoinable("You are already seated at that table.");
    }
    if (seats.length >= 2) throw new HeadsUpTableNotJoinable("That table is full.");
    const seat: 0 | 1 = seats.some((s) => s.seat === 0) ? 1 : 0;
    const next = [...seats, { seat, playerId, token, joinedAt: new Date().toISOString() }];
    memorySeats.set(tableId, next);
    return { seat, seatedCount: next.length, hostId: table.hostId };
  }

  const { data, error } = await supabase
    .rpc("claim_heads_up_seat", { p_table_id: tableId, p_player_id: playerId, p_token: token })
    .single();
  if (error) {
    if (error.code === "23505") throw new HeadsUpTableNotJoinable("You are already seated at that table.");
    if (error.code === "P0001") throw new HeadsUpTableNotJoinable(error.message);
    throw new Error(`Could not join that heads-up table: ${error.message}`);
  }
  const result = data as { seat: number; seated_count: number; host_id: string };
  return { seat: result.seat as 0 | 1, seatedCount: result.seated_count, hostId: String(result.host_id) };
}

/**
 * The one transition out of 'waiting', once both seats are filled. Returns
 * null when the guard failed (seated count changed, table already dealt)
 * rather than throwing -- an ordinary race outcome, same as
 * dealCribbageTable.
 */
export async function dealHeadsUpTable(input: {
  tableId: string;
  expectedSeats: number;
  gameId: string;
}): Promise<StoredHeadsUpTable | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const table = memoryTables.get(input.tableId);
    if (!table || table.status !== "waiting") return null;
    const seatedCount = (memorySeats.get(input.tableId) ?? []).length;
    if (seatedCount !== input.expectedSeats) return null;
    const dealt: StoredHeadsUpTable = {
      ...table,
      status: "active",
      gameId: input.gameId,
      version: table.version + 1,
      startedAt: now,
    };
    memoryTables.set(input.tableId, cloneTable(dealt));
    return cloneTable(dealt);
  }

  const { data, error } = await supabase
    .rpc("deal_heads_up_table", { p_table_id: input.tableId, p_game_id: input.gameId })
    .single();
  if (error) {
    if (error.code === "P0001") return null;
    throw new Error(`Could not start that heads-up table: ${error.message}`);
  }
  return data ? fromRow(data as TableRow) : null;
}

/** Unwinds a table whose host could not be seated right after creation. */
export async function cancelEmptyHeadsUpTable(tableId: string, hostId: string): Promise<boolean> {
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
    .rpc("cancel_empty_heads_up_table", { p_table_id: tableId, p_host_id: hostId })
    .maybeSingle();
  if (error) throw new Error(`Could not clean up that heads-up table: ${error.message}`);
  return Boolean(data);
}

/** Pre-deal only. Returns the removed seat, or null if there was nothing to leave. */
export async function leaveHeadsUpTable(
  tableId: string,
  playerId: string,
): Promise<HeadsUpSeatRow | null> {
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
    .rpc("leave_heads_up_table", { p_table_id: tableId, p_player_id: playerId })
    .maybeSingle();
  if (error) throw new Error(`Could not leave that heads-up table: ${error.message}`);
  if (!data) return null;
  const row = data as { seat: number; player_id: string; token: string; joined_at: string };
  return {
    seat: row.seat as 0 | 1,
    playerId: String(row.player_id),
    token: String(row.token),
    joinedAt: String(row.joined_at),
  };
}

/**
 * Pays a match out: version-guarded 'active' -> 'completed'. Returns null on
 * a lost race (someone else already settled this table, or it was cancelled
 * out from under it), and a null return must never be paid -- same contract
 * as advanceCribbageTable/advancePvpMatch.
 */
export async function settleHeadsUpTable(
  current: StoredHeadsUpTable,
  winnerId: string,
): Promise<StoredHeadsUpTable | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const stored = memoryTables.get(current.id);
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredHeadsUpTable = {
      ...stored,
      status: "completed",
      winnerId,
      version: stored.version + 1,
      settledAt: now,
    };
    memoryTables.set(current.id, cloneTable(updated));
    return cloneTable(updated);
  }

  const { data, error } = await supabase
    .rpc("settle_heads_up_table", {
      p_table_id: current.id,
      p_expected_version: current.version,
      p_winner_id: winnerId,
    })
    .single();
  if (error) {
    // A guard-only function returns no row rather than raising, but the
    // Supabase client still surfaces "no rows" as an error on .single().
    if (error.code === "PGRST116") return null;
    throw new Error(`Could not settle that heads-up table: ${error.message}`);
  }
  return data ? fromRow(data as TableRow) : null;
}

/**
 * Closes an active table both players have abandoned, refunding nobody by
 * itself -- the caller (refundAbandonedHeadsUp in game-store.ts) does the
 * refund, using each seat's ORIGINAL entry fee, only once this returns a
 * row. See the migration's own header on why that distinction matters.
 */
export async function cancelStaleHeadsUpTable(current: StoredHeadsUpTable): Promise<StoredHeadsUpTable | null> {
  const supabase = adminClient();

  if (!supabase) {
    const stored = memoryTables.get(current.id);
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredHeadsUpTable = { ...stored, status: "cancelled", version: stored.version + 1 };
    memoryTables.set(current.id, cloneTable(updated));
    return cloneTable(updated);
  }

  const { data, error } = await supabase
    .rpc("cancel_stale_heads_up_table", { p_table_id: current.id, p_expected_version: current.version })
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(`Could not cancel that heads-up table: ${error.message}`);
  }
  return data ? fromRow(data as TableRow) : null;
}
