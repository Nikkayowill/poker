import "server-only";
import { randomUUID } from "crypto";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for live and finished Ante Up attempts, across all four brain
 * games (Sudoku, Word Stack, Connections, Memory Match).
 *
 * Generic over `TState` the same way lib/server/daily-puzzle-store.ts is
 * generic over `TRound` -- one table, one store, many games, each service
 * casting `state` back to its own attempt type. `game` is metadata alongside
 * the polymorphic state, not folded into it, so this file never needs to know
 * what any game's state actually looks like beyond carrying a `status` field.
 *
 * Same twin-branch shape as pvp-match-store.ts -- Supabase when configured,
 * an in-process Map otherwise -- and the same invariants: one active attempt
 * per player PER GAME (a global "one attempt, period" rule was correct when
 * Sudoku was the only game here; four games sharing this mechanism concurrently
 * must not collide on that), and a version that only ever advances from the
 * value the caller last saw.
 *
 * The stored `state` is the whole attempt, including whatever answer/solution
 * the game holds. Nothing here is safe to hand to a browser; each service
 * redacts through its own toXSnapshot.
 */

export interface StoredAnteUpAttempt<TState = unknown> {
  id: string;
  profileId: string;
  game: string;
  version: number;
  state: TState;
  createdAt: string;
  settledAt: string | null;
}

declare global {
  var __riverRoomAnteUpAttempts: Map<string, StoredAnteUpAttempt> | undefined;
}

const memoryAttempts = globalThis.__riverRoomAnteUpAttempts ?? new Map<string, StoredAnteUpAttempt>();
globalThis.__riverRoomAnteUpAttempts = memoryAttempts;

/** Test seam only: the memory branch is process-global. */
export function __resetAnteUpAttemptsForTest(): void {
  memoryAttempts.clear();
}

/** Thrown when the player already has a live Ante Up attempt at this game. */
export class ActiveAnteUpAttemptExists extends Error {
  constructor() {
    super("You already have an Ante Up attempt in progress.");
    this.name = "ActiveAnteUpAttemptExists";
  }
}

const ATTEMPT_COLUMNS =
  "id, profile_id, game, tier, wager, multiplier, status, version, state, created_at, settled_at";

interface AttemptRow {
  id: string;
  profile_id: string;
  game: string;
  version: number | string;
  state: unknown;
  created_at: string;
  settled_at: string | null;
}

function fromRow<TState>(row: AttemptRow): StoredAnteUpAttempt<TState> {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    game: String(row.game),
    version: Number(row.version),
    state: row.state as TState,
    createdAt: String(row.created_at),
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

/** A defensive copy, so a caller mutating what it got back cannot reach into the memory store. */
function clone<TState>(attempt: StoredAnteUpAttempt<TState>): StoredAnteUpAttempt<TState> {
  return { ...attempt, state: structuredClone(attempt.state) };
}

interface HasStatus {
  status: string;
}

function memoryActiveFor<TState extends HasStatus>(
  profileId: string,
  game: string,
): StoredAnteUpAttempt<TState> | undefined {
  return [...memoryAttempts.values()].find(
    (attempt) =>
      attempt.profileId === profileId && attempt.game === game && (attempt.state as HasStatus).status === "active",
  ) as StoredAnteUpAttempt<TState> | undefined;
}

/** The caller's live attempt at this game, or null. What restores the board after a refresh. */
export async function getActiveAnteUpAttempt<TState extends HasStatus>(
  profileId: string,
  game: string,
): Promise<StoredAnteUpAttempt<TState> | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryActiveFor<TState>(profileId, game);
    return found ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("profile_id", profileId)
    .eq("game", game)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Could not load your Ante Up attempt: ${error.message}`);
  return data ? fromRow<TState>(data as AttemptRow) : null;
}

/** An attempt by id, whoever it belongs to. The service checks ownership before redacting. */
export async function getAnteUpAttemptById<TState>(id: string): Promise<StoredAnteUpAttempt<TState> | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryAttempts.get(id);
    return found ? (clone(found as StoredAnteUpAttempt<TState>)) : null;
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load that attempt: ${error.message}`);
  return data ? fromRow<TState>(data as AttemptRow) : null;
}

/**
 * Opens an attempt. Throws ActiveAnteUpAttemptExists when the player already
 * has one live at this game -- caught from the partial unique index (23505)
 * rather than a read-first check, for the same race reason pvp-match-store.ts
 * gives.
 *
 * `tier`/`wager`/`multiplier` are passed explicitly rather than read off
 * `state` -- this store does not know the shape of any game's state, only
 * that it carries a `status`.
 */
export async function createAnteUpAttempt<TState extends HasStatus>(input: {
  profileId: string;
  game: string;
  /** Sudoku's difficulty. Null for games with no difficulty axis. */
  tier: string | null;
  wager: number;
  multiplier: number;
  state: TState;
}): Promise<StoredAnteUpAttempt<TState>> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    if (memoryActiveFor<TState>(input.profileId, input.game)) throw new ActiveAnteUpAttemptExists();
    const attempt: StoredAnteUpAttempt<TState> = {
      id: randomUUID(),
      profileId: input.profileId,
      game: input.game,
      version: 1,
      state: input.state,
      createdAt: now,
      settledAt: null,
    };
    memoryAttempts.set(attempt.id, clone(attempt) as StoredAnteUpAttempt);
    return clone(attempt);
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .insert({
      profile_id: input.profileId,
      game: input.game,
      tier: input.tier,
      wager: input.wager,
      multiplier: input.multiplier,
      status: "active",
      version: 1,
      state: input.state,
    })
    .select(ATTEMPT_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new ActiveAnteUpAttemptExists();
    throw new Error(`Could not open that attempt: ${error.message}`);
  }
  return fromRow<TState>(data as AttemptRow);
}

/**
 * Writes the next state, but only if nobody else already did. Returns null on
 * a lost race -- a stale version, a replayed request -- and the caller must
 * not pay out on null. Same contract as pvp-match-store.ts's advancePvpMatch.
 */
export async function advanceAnteUpAttempt<TState extends HasStatus>(
  current: StoredAnteUpAttempt<TState>,
  next: TState,
): Promise<StoredAnteUpAttempt<TState> | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const now = new Date().toISOString();
  const settled = next.status !== "active";

  if (!supabase) {
    const stored = memoryAttempts.get(current.id) as StoredAnteUpAttempt<TState> | undefined;
    if (!stored || stored.state.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredAnteUpAttempt<TState> = {
      ...stored,
      version,
      state: next,
      settledAt: settled ? now : null,
    };
    memoryAttempts.set(current.id, clone(updated) as StoredAnteUpAttempt);
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .update({
      version,
      status: next.status,
      state: next,
      settled_at: settled ? now : null,
      updated_at: now,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(ATTEMPT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not save that attempt: ${error.message}`);
  return data ? fromRow<TState>(data as AttemptRow) : null;
}

/**
 * How many wagered attempts (wager > 0) this player opened at this game since
 * `since`. Free practice attempts do not count -- see each game's own daily
 * wager-limit constant for why the cap exists at all. Per-game, not a pool
 * shared across all four -- confirmed with the product owner when this store
 * was generalized (2026-08-21): preserves what Sudoku Ante Up players already
 * had rather than quietly cutting their ceiling the day three more games
 * start sharing the same counter.
 */
export async function countWageredAttemptsSince(profileId: string, game: string, since: Date): Promise<number> {
  const supabase = adminClient();
  const sinceIso = since.toISOString();

  if (!supabase) {
    return [...memoryAttempts.values()].filter(
      (attempt) =>
        attempt.profileId === profileId &&
        attempt.game === game &&
        Number((attempt.state as { wager?: number }).wager ?? 0) > 0 &&
        attempt.createdAt >= sinceIso,
    ).length;
  }

  const { count, error } = await supabase
    .from("ante_up_attempts")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("game", game)
    .gt("wager", 0)
    .gte("created_at", sinceIso);
  if (error) throw new Error(`Could not check today's Ante Up attempts: ${error.message}`);
  return count ?? 0;
}
