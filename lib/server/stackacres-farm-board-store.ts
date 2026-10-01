import "server-only";
import type { FarmBoardPeriodKind, StoredFarmBoard } from "@/lib/stackacres/farm-board";
import { creditGoldByProfileLedgered } from "./profile-store";
import { adjustStackAcresInfluence } from "./stackacres-store";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the Daily Farm Board (lib/stackacres/farm-board.ts).
 *
 * Its own module rather than another thousand lines in
 * stackacres-store.ts, and deliberately outside stackacres-service.ts: that
 * file's "currency wall" tests pin every Gold credit in it to one refund
 * helper and one keyed payout helper, and a board reward is neither. The
 * board's faucet lives here, keyed on its own ledger
 * (`grant_homestead_farm_board_reward`), which is the property that wall
 * exists to protect -- a reward that cannot pay twice and cannot half-pay.
 *
 * Twin branches like every other store here: a live Supabase, or the
 * in-memory mirror that runs when the env vars are absent. globalThis so
 * the maps survive Next.js' dev-mode module reloads.
 */

export interface FarmBoardRow {
  readonly board: StoredFarmBoard;
  /** 0 means "no row yet", the same convention `StoredStoryRow` uses. */
  readonly version: number;
}

declare global {
  var __riverRoomStackAcresFarmBoard: Map<string, FarmBoardRow> | undefined;
  var __riverRoomStackAcresFarmBoardGrants: Set<string> | undefined;
}

const memoryBoards = globalThis.__riverRoomStackAcresFarmBoard ?? new Map<string, FarmBoardRow>();
globalThis.__riverRoomStackAcresFarmBoard = memoryBoards;
const memoryGrants = globalThis.__riverRoomStackAcresFarmBoardGrants ?? new Set<string>();
globalThis.__riverRoomStackAcresFarmBoardGrants = memoryGrants;

/** Test-only reset. */
export function __resetStackAcresFarmBoardMemory(): void {
  memoryBoards.clear();
  memoryGrants.clear();
}

function key(profileId: string, periodKind: FarmBoardPeriodKind, periodStart: string): string {
  return `${profileId}:${periodKind}:${periodStart}`;
}

/** Same parsing both paths run, colocated with the reader the way every
 *  other `*FromBatchRow` helper here is. Null means no row for that period,
 *  which reads as "not drawn yet". */
export function farmBoardFromBatchRow(
  row: { board: StoredFarmBoard; version: number | string } | null,
): FarmBoardRow | null {
  if (!row) return null;
  return { board: row.board, version: Number(row.version) };
}

export async function readStackAcresFarmBoard(
  profileId: string,
  periodKind: FarmBoardPeriodKind,
  periodStart: string,
): Promise<FarmBoardRow | null> {
  const supabase = adminClient();
  if (!supabase) return memoryBoards.get(key(profileId, periodKind, periodStart)) ?? null;

  const { data, error } = await supabase
    .from("homestead_farm_board")
    .select("board, version")
    .eq("profile_id", profileId)
    .eq("period_kind", periodKind)
    .eq("period_start", periodStart)
    .maybeSingle();
  if (error) throw new Error(`Could not read your farm board: ${error.message}`);
  return farmBoardFromBatchRow(data as { board: StoredFarmBoard; version: number | string } | null);
}

/**
 * Claims one period's board, or hands back the one already drawn for it.
 *
 * Never overwrites, which is what makes the draw stable for the whole
 * period even though the pool it came from is filtered by a farm that keeps
 * changing -- see the migration's own header.
 */
export async function drawStackAcresFarmBoard(
  profileId: string,
  periodKind: FarmBoardPeriodKind,
  periodStart: string,
  board: StoredFarmBoard,
): Promise<FarmBoardRow> {
  const supabase = adminClient();
  if (!supabase) {
    const id = key(profileId, periodKind, periodStart);
    const existing = memoryBoards.get(id);
    if (existing) return existing;
    const fresh: FarmBoardRow = { board, version: 1 };
    memoryBoards.set(id, fresh);
    return fresh;
  }

  const { data, error } = await supabase.rpc("draw_homestead_farm_board", {
    p_profile_id: profileId,
    p_period_kind: periodKind,
    p_period_start: periodStart,
    p_board: board,
  });
  if (error) throw new Error(`Could not open your farm board: ${error.message}`);
  // `out_board`/`out_version`, not `board`/`version`: the RPC's OUT
  // parameters are named apart from the table's own columns so an
  // unqualified reference inside its body cannot be ambiguous (see the
  // migration's own note), and PostgREST answers with the OUT names.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { out_board: StoredFarmBoard; out_version: number | string }
    | null;
  const parsed = row ? farmBoardFromBatchRow({ board: row.out_board, version: row.out_version }) : null;
  // The insert either landed or collided, so a row exists either way; a null
  // here would mean the RPC answered nothing, which is a real error rather
  // than "not drawn".
  if (!parsed) throw new Error("Could not open your farm board.");
  return parsed;
}

/** Writes the whole document if and only if it is still at
 *  `expectedVersion`. Returns the new version, or null on a lost race --
 *  the caller re-reads and retries, same contract as
 *  `writeStackAcresStory`. */
export async function writeStackAcresFarmBoard(
  profileId: string,
  periodKind: FarmBoardPeriodKind,
  periodStart: string,
  board: StoredFarmBoard,
  expectedVersion: number,
): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const id = key(profileId, periodKind, periodStart);
    const current = memoryBoards.get(id);
    if (!current || current.version !== expectedVersion) return null;
    const next: FarmBoardRow = { board, version: current.version + 1 };
    memoryBoards.set(id, next);
    return next.version;
  }

  const { data, error } = await supabase.rpc("write_homestead_farm_board", {
    p_profile_id: profileId,
    p_period_kind: periodKind,
    p_period_start: periodStart,
    p_board: board,
    p_expected_version: expectedVersion,
  });
  if (error) throw new Error(`Could not save your farm board: ${error.message}`);
  return data === null ? null : Number(data);
}

export interface FarmBoardGrant {
  /** True only for the call that claimed the key. False means an earlier
   *  claim already took this line and nothing was owed this time. */
  readonly granted: boolean;
  /** The balance after the Gold landed, or null when none was due or the
   *  credit found itself already applied. */
  readonly goldBalance: number | null;
}

/** The correlation id the ledgered credit is keyed on. Deterministic, so a
 *  retried claim is the SAME credit rather than a second one -- the money's
 *  second guard, on top of the ledger key below. */
function goldCorrelationId(profileId: string, code: string, periodStart: string): string {
  return `stackacres-farm-board:${code}:${profileId}:${periodStart}`;
}

/**
 * Claims one finished line and pays it.
 *
 * TWO STEPS, AND THE ORDER IS THE POINT. `claim_homestead_farm_board_reward`
 * inserts the keyed ledger row and adds Town Influence in one transaction,
 * and answers whether THIS call is the one that claimed the key. Only a true
 * answer goes on to credit Gold, and that credit happens here in TypeScript
 * rather than inside the SQL, because lib/server/stackacres-gold-boundary.test.ts
 * holds the rule that new farm Gold must: farm SQL that moves Gold in its own
 * transaction cannot follow the farm into a separate database.
 *
 * A crash between the two steps leaves a claimed key and no Gold. That is the
 * safe direction and it is recoverable rather than lost: the correlation id
 * is deterministic, so a later claim of the same line answers granted=false
 * and pays nothing, while the ledger row records exactly what was owed.
 *
 * The memory branch mirrors the key in a Set, because there is no ledger
 * table to collide on there -- the Set is what makes a retried claim free in
 * tests, exactly as the primary key does in Postgres.
 */
export async function grantStackAcresFarmBoardReward(
  profileId: string,
  code: string,
  periodStart: string,
  gold: number,
  influence: number,
): Promise<FarmBoardGrant> {
  const supabase = adminClient();
  let claimed: boolean;

  if (!supabase) {
    const id = `farm_board:${code}:${profileId}:${periodStart}`;
    claimed = !memoryGrants.has(id);
    if (claimed) {
      memoryGrants.add(id);
      if (influence > 0) await adjustStackAcresInfluence(profileId, influence);
    }
  } else {
    const { data, error } = await supabase.rpc("claim_homestead_farm_board_reward", {
      p_profile_id: profileId,
      p_code: code,
      p_period_start: periodStart,
      p_gold: gold,
      p_influence: influence,
    });
    if (error) throw new Error(`Could not claim your farm board reward: ${error.message}`);
    claimed = data === true;
  }

  if (!claimed) return { granted: false, goldBalance: null };
  if (gold <= 0) return { granted: true, goldBalance: null };

  const credited = await creditGoldByProfileLedgered(
    profileId,
    gold,
    goldCorrelationId(profileId, code, periodStart),
    "stackacres_farm_board",
  );
  return { granted: true, goldBalance: credited.success ? credited.goldBalance ?? null : null };
}
