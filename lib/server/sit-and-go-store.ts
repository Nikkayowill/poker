import "server-only";
import { randomUUID } from "crypto";
import { SEAT_COUNT } from "@/lib/game/engine";
import type { StakesTier } from "@/lib/game/tiers";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for Sit & Go registration/lobby tables. Twin-branch, same as
 * every other store here: Supabase when configured, an in-process Map
 * otherwise, replicating the same guards the migration's constraints and
 * RPCs enforce, because `npm test` and a no-env dev server both run on it.
 *
 * This is NOT the poker game itself -- once a table deals, the actual hands
 * live in the existing games/game_state_private tables via
 * lib/server/game-store.ts, addressed by `gameId` below. This store only
 * ever answers "is a table open, who's registered, has it dealt yet."
 *
 * Dealing is two guarded steps, not one, unlike cribbage's single
 * deal_cribbage_table RPC -- see the migration's own header for why: this
 * table's "state" is a second row in a different table, which can't be
 * written speculatively before the deal guard succeeds without risking an
 * orphaned games row on a lost race.
 */

type SitAndGoTableStatus = "waiting" | "active" | "completed" | "cancelled";

export interface StoredSitAndGoTable {
  id: string;
  hostId: string;
  tier: StakesTier;
  entryFee: number;
  status: SitAndGoTableStatus;
  version: number;
  gameId: string | null;
  prizePool: number | null;
  winnerId: string | null;
  createdAt: string;
  startedAt: string | null;
  settledAt: string | null;
}

export interface SitAndGoSeatRow {
  seat: number;
  playerId: string;
  token: string;
  joinedAt: string;
}

/** A guard genuinely failed (table full, already started, gone): an ordinary outcome, not a fault. */
export class SitAndGoTableNotJoinable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SitAndGoTableNotJoinable";
  }
}

// SEAT_COUNT (lib/game/engine.ts) is the one TS-side source of truth; only
// the migration's own `seat < 6`/`>= 6` literals can't share it (SQL can't
// import a TS constant) -- same unavoidable duplication cribbage's own
// `MAX_SEATS = 4` has against its migration's `seat < 4`.
export const SIT_AND_GO_SEATS = SEAT_COUNT;

declare global {
  var __riverRoomSitAndGoTables: Map<string, StoredSitAndGoTable> | undefined;
  var __riverRoomSitAndGoSeats: Map<string, SitAndGoSeatRow[]> | undefined;
}

const memoryTables = globalThis.__riverRoomSitAndGoTables ?? new Map<string, StoredSitAndGoTable>();
globalThis.__riverRoomSitAndGoTables = memoryTables;
const memorySeats = globalThis.__riverRoomSitAndGoSeats ?? new Map<string, SitAndGoSeatRow[]>();
globalThis.__riverRoomSitAndGoSeats = memorySeats;

/** Test seam only: the memory branch is process-global, so suites must not let tables leak into each other. */
export function __resetSitAndGoTablesForTest(): void {
  memoryTables.clear();
  memorySeats.clear();
}

function cloneTable(table: StoredSitAndGoTable): StoredSitAndGoTable {
  return { ...table };
}

const TABLE_COLUMNS =
  "id, host_id, tier, entry_fee, status, version, game_id, prize_pool, winner_id, created_at, started_at, settled_at";

interface TableRow {
  id: string;
  host_id: string;
  tier: string;
  entry_fee: number | string;
  status: string;
  version: number | string;
  game_id: string | null;
  prize_pool: number | string | null;
  winner_id: string | null;
  created_at: string;
  started_at: string | null;
  settled_at: string | null;
}

function fromRow(row: TableRow): StoredSitAndGoTable {
  return {
    id: String(row.id),
    hostId: String(row.host_id),
    tier: row.tier as StakesTier,
    entryFee: Number(row.entry_fee),
    status: String(row.status) as SitAndGoTableStatus,
    version: Number(row.version),
    gameId: row.game_id ? String(row.game_id) : null,
    prizePool: row.prize_pool === null || row.prize_pool === undefined ? null : Number(row.prize_pool),
    winnerId: row.winner_id ? String(row.winner_id) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

// ---- reads ------------------------------------------------------------

export async function getSitAndGoTableById(id: string): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryTables.get(id);
    return found ? cloneTable(found) : null;
  }
  const { data, error } = await supabase
    .from("sit_and_go_tables")
    .select(TABLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load that Sit & Go table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/** Every seat at a table, ordered by seat number; this is the seat position the dealt game uses. */
export async function getSitAndGoSeats(tableId: string): Promise<SitAndGoSeatRow[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...(memorySeats.get(tableId) ?? [])].sort((a, b) => a.seat - b.seat);
  }
  const { data, error } = await supabase
    .from("sit_and_go_table_players")
    .select("seat, player_id, token, joined_at")
    .eq("table_id", tableId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`Could not load that table's seats: ${error.message}`);
  return (data ?? []).map((row) => ({
    seat: Number(row.seat),
    playerId: String(row.player_id),
    token: String(row.token),
    joinedAt: String(row.joined_at),
  }));
}

/**
 * How many are registered at each of these tables, in one round trip. Feeds
 * the lobby list, which every connected browser polls every 2s -- same
 * reasoning as cribbage's getSeatCountsForTables.
 */
export async function getSeatCountsForSitAndGoTables(tableIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (tableIds.length === 0) return counts;

  const supabase = adminClient();
  if (!supabase) {
    for (const id of tableIds) counts.set(id, (memorySeats.get(id) ?? []).length);
    return counts;
  }

  const { data, error } = await supabase
    .from("sit_and_go_table_players")
    .select("table_id")
    .in("table_id", tableIds);
  if (error) throw new Error(`Could not load registered counts: ${error.message}`);
  for (const row of data ?? []) {
    const id = String(row.table_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Open (waiting) tables at this tier, newest first: the lobby list. */
export async function getOpenSitAndGoTables(tier?: StakesTier): Promise<StoredSitAndGoTable[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryTables.values()]
      .filter((table) => table.status === "waiting" && (tier === undefined || table.tier === tier))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(cloneTable);
  }
  let query = supabase.from("sit_and_go_tables").select(TABLE_COLUMNS).eq("status", "waiting");
  if (tier !== undefined) query = query.eq("tier", tier);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not load open Sit & Go tables: ${error.message}`);
  return (data ?? []).map((row) => fromRow(row as TableRow));
}

/**
 * The caller's own live (waiting or active) table, if any.
 *
 * Picks the most recent rather than erroring on more than one row -- same
 * accepted, narrow race as sit_and_go_table_players_player_idx's comment in
 * the migration: "one live table per player" is an application-level guard,
 * not a hard constraint.
 */
export async function getActiveSitAndGoTableFor(playerId: string): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const registeredTableIds = new Set(
      [...memorySeats.entries()].filter(([, seats]) => seats.some((s) => s.playerId === playerId)).map(([id]) => id),
    );
    const candidates = [...memoryTables.values()]
      .filter((table) => registeredTableIds.has(table.id) && (table.status === "waiting" || table.status === "active"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return candidates[0] ? cloneTable(candidates[0]) : null;
  }

  const { data: seatRows, error: seatError } = await supabase
    .from("sit_and_go_table_players")
    .select("table_id")
    .eq("player_id", playerId);
  if (seatError) throw new Error(`Could not load your Sit & Go tables: ${seatError.message}`);
  const tableIds = [...new Set((seatRows ?? []).map((row) => String(row.table_id)))];
  if (tableIds.length === 0) return null;

  const { data, error } = await supabase
    .from("sit_and_go_tables")
    .select(TABLE_COLUMNS)
    .in("id", tableIds)
    .in("status", ["waiting", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load your Sit & Go table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/** The registration row behind a dealt game, if any -- the settlement path's way back from a GameState to its table. */
export async function getSitAndGoTableByGameId(gameId: string): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = [...memoryTables.values()].find((table) => table.gameId === gameId);
    return found ? cloneTable(found) : null;
  }
  const { data, error } = await supabase
    .from("sit_and_go_tables")
    .select(TABLE_COLUMNS)
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw new Error(`Could not load that Sit & Go table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/**
 * Batched getSitAndGoTableByGameId, keyed by game id. Feeds
 * archiveStaleGames's stale-tournament check: that sweep looks at up to
 * STALE_SWEEP_LIMIT games per call, most of them ordinary cash tables, and
 * checking each one individually would be one query per candidate on the
 * Supabase branch -- the same N+1 shape getSeatCountsForSitAndGoTables
 * already exists to avoid for the seat-count case.
 */
export async function getSitAndGoTablesByGameIds(gameIds: string[]): Promise<Map<string, StoredSitAndGoTable>> {
  const result = new Map<string, StoredSitAndGoTable>();
  if (gameIds.length === 0) return result;

  const supabase = adminClient();
  if (!supabase) {
    const wanted = new Set(gameIds);
    for (const table of memoryTables.values()) {
      if (table.gameId && wanted.has(table.gameId)) result.set(table.gameId, cloneTable(table));
    }
    return result;
  }

  const { data, error } = await supabase.from("sit_and_go_tables").select(TABLE_COLUMNS).in("game_id", gameIds);
  if (error) throw new Error(`Could not load Sit & Go tables: ${error.message}`);
  for (const row of data ?? []) {
    const table = fromRow(row as TableRow);
    if (table.gameId) result.set(table.gameId, table);
  }
  return result;
}

// ---- writes -------------------------------------------------------------

/** Opens a bare table, host not yet seated; the caller seats them with claimSitAndGoSeat right after. */
export async function createSitAndGoTableRow(
  hostId: string,
  tier: StakesTier,
  entryFee: number,
): Promise<StoredSitAndGoTable> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const table: StoredSitAndGoTable = {
      id: randomUUID(),
      hostId,
      tier,
      entryFee,
      status: "waiting",
      version: 1,
      gameId: null,
      prizePool: null,
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
    .from("sit_and_go_tables")
    .insert({ host_id: hostId, tier, entry_fee: entryFee, status: "waiting", version: 1 })
    .select(TABLE_COLUMNS)
    .single();
  if (error) throw new Error(`Could not open a Sit & Go table: ${error.message}`);
  return fromRow(data as TableRow);
}

/**
 * Assigns the next open seat (0-5) to `playerId`, and persists the session
 * token they registered with alongside it -- the poker engine authorizes
 * actions by token, not profile id, so the dealt game needs it. Throws
 * SitAndGoTableNotJoinable for every ordinary reason this can fail; the
 * caller (the service) turns that into a player-facing message.
 */
export async function claimSitAndGoSeat(
  tableId: string,
  playerId: string,
  token: string,
): Promise<{ seat: number; seatedCount: number; hostId: string }> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table) throw new SitAndGoTableNotJoinable("No such table.");
    if (table.status !== "waiting") throw new SitAndGoTableNotJoinable("That table is no longer taking players.");
    const seats = memorySeats.get(tableId) ?? [];
    if (seats.some((s) => s.playerId === playerId)) {
      throw new SitAndGoTableNotJoinable("You are already registered at that table.");
    }
    if (seats.length >= SIT_AND_GO_SEATS) throw new SitAndGoTableNotJoinable("That table is full.");
    const taken = new Set(seats.map((s) => s.seat));
    let seat = 0;
    while (taken.has(seat)) seat += 1;
    const next = [...seats, { seat, playerId, token, joinedAt: new Date().toISOString() }];
    memorySeats.set(tableId, next);
    return { seat, seatedCount: next.length, hostId: table.hostId };
  }

  const { data, error } = await supabase
    .rpc("claim_sit_and_go_seat", { p_table_id: tableId, p_player_id: playerId, p_token: token })
    .single();
  if (error) {
    if (error.code === "23505") throw new SitAndGoTableNotJoinable("You are already registered at that table.");
    if (error.code === "P0001") throw new SitAndGoTableNotJoinable(error.message);
    throw new Error(`Could not join that Sit & Go table: ${error.message}`);
  }
  const result = data as { seat: number; seated_count: number; host_id: string };
  return { seat: result.seat, seatedCount: result.seated_count, hostId: String(result.host_id) };
}

/**
 * Step 1 of dealing: flips the table to 'active' under an exact-seat-count
 * guard (see the migration's own header on why exact, not >=), with no
 * state payload -- the caller only builds and persists the real GameState
 * once this returns non-null, then calls setSitAndGoGameId. Returns null on
 * a lost race, the same "nothing happened, in particular nothing was paid"
 * contract as cribbage's dealCribbageTable.
 */
export async function dealSitAndGoTable(
  tableId: string,
  expectedSeats: number,
): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table || table.status !== "waiting") return null;
    const seatedCount = (memorySeats.get(tableId) ?? []).length;
    if (seatedCount !== expectedSeats) return null;
    const dealt: StoredSitAndGoTable = {
      ...table,
      status: "active",
      version: table.version + 1,
      startedAt: now,
      prizePool: table.entryFee * seatedCount,
    };
    memoryTables.set(tableId, cloneTable(dealt));
    return cloneTable(dealt);
  }

  const { data, error } = await supabase
    .rpc("deal_sit_and_go_table", { p_table_id: tableId, p_expected_seats: expectedSeats })
    .single();
  if (error) {
    if (error.code === "P0001") return null;
    throw new Error(`Could not start that Sit & Go table: ${error.message}`);
  }
  return data ? fromRow(data as TableRow) : null;
}

/**
 * Step 2 of dealing: records the GameState id the service just built and
 * persisted via the existing createStoredGame path. Guarded on `gameId`
 * still being null, so a retry after a crash between steps can never
 * overwrite an already-recorded game.
 */
export async function setSitAndGoGameId(
  tableId: string,
  gameId: string,
): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table || table.status !== "active" || table.gameId !== null) return null;
    const updated: StoredSitAndGoTable = { ...table, gameId };
    memoryTables.set(tableId, cloneTable(updated));
    return cloneTable(updated);
  }

  const { data, error } = await supabase
    .rpc("set_sit_and_go_game_id", { p_table_id: tableId, p_game_id: gameId })
    .maybeSingle();
  if (error) throw new Error(`Could not record that Sit & Go table's game: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/**
 * Unwinds a table whose host could not be seated right after creation.
 * Guarded (still 'waiting', genuinely zero seats) so it can never touch a
 * table anyone has actually joined.
 */
export async function cancelEmptySitAndGoTable(tableId: string, hostId: string): Promise<boolean> {
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
    .rpc("cancel_empty_sit_and_go_table", { p_table_id: tableId, p_host_id: hostId })
    .maybeSingle();
  if (error) throw new Error(`Could not clean up that Sit & Go table: ${error.message}`);
  return Boolean(data);
}

/** Pre-deal only. Returns the removed seat, or null if there was nothing to leave (already started, not registered). */
export async function leaveSitAndGoTable(
  tableId: string,
  playerId: string,
): Promise<SitAndGoSeatRow | null> {
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
    .rpc("leave_sit_and_go_table", { p_table_id: tableId, p_player_id: playerId })
    .maybeSingle();
  if (error) throw new Error(`Could not leave that Sit & Go table: ${error.message}`);
  if (!data) return null;
  const row = data as { seat: number; player_id: string; token: string; joined_at: string };
  return { seat: row.seat, playerId: String(row.player_id), token: String(row.token), joinedAt: String(row.joined_at) };
}

/**
 * Settles a decided table exactly once: version+status guarded transition
 * from 'active' to 'completed', same contract as cribbage's
 * advanceCribbageTable / pvp-match-store's advancePvpMatch. Returns null on
 * a lost race, and the caller must not pay out on a null return -- this
 * guard is the entire reason a prize pool is credited exactly once.
 */
export async function settleSitAndGoTable(
  current: StoredSitAndGoTable,
  winnerId: string,
): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const now = new Date().toISOString();

  if (!supabase) {
    const stored = memoryTables.get(current.id);
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredSitAndGoTable = {
      ...stored,
      version,
      status: "completed",
      winnerId,
      settledAt: now,
    };
    memoryTables.set(current.id, cloneTable(updated));
    return cloneTable(updated);
  }

  const { data, error } = await supabase
    .from("sit_and_go_tables")
    .update({ version, status: "completed", winner_id: winnerId, settled_at: now })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(TABLE_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not settle that Sit & Go table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}

/**
 * Cancels an abandoned mid-tournament table exactly once: version-guarded
 * transition from 'active' straight to 'cancelled', no winner. Called only
 * from lib/server/game-store.ts's archiveStaleGames tournament branch -- see
 * the migration's own comment on cancel_stale_sit_and_go_table for why an
 * abandoned Sit & Go must never fall through to that function's ordinary
 * per-seat "credit the current stack" refund.
 */
export async function cancelStaleSitAndGoTable(
  tableId: string,
  expectedVersion: number,
): Promise<StoredSitAndGoTable | null> {
  const supabase = adminClient();

  if (!supabase) {
    const table = memoryTables.get(tableId);
    if (!table || table.status !== "active" || table.version !== expectedVersion) return null;
    const updated: StoredSitAndGoTable = { ...table, status: "cancelled", version: table.version + 1 };
    memoryTables.set(tableId, cloneTable(updated));
    return cloneTable(updated);
  }

  const { data, error } = await supabase
    .rpc("cancel_stale_sit_and_go_table", { p_table_id: tableId, p_expected_version: expectedVersion })
    .maybeSingle();
  if (error) throw new Error(`Could not cancel that Sit & Go table: ${error.message}`);
  return data ? fromRow(data as TableRow) : null;
}
