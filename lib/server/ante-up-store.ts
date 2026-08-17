import "server-only";
import { randomUUID } from "crypto";
import type { AnteUpAttempt } from "@/lib/arcade/ante-up";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for live and finished Ante Up: Sudoku attempts.
 *
 * Same twin-branch shape as pvp-match-store.ts -- Supabase when configured,
 * an in-process Map otherwise -- and the same invariants: one active attempt
 * per player, and a version that only ever advances from the value the
 * caller last saw.
 *
 * The stored `state` is the whole AnteUpAttempt, including the grid's
 * solution. Nothing here is safe to hand to a browser; the service redacts
 * through toAnteUpSnapshot.
 */

export type AnteUpAttemptStatus = AnteUpAttempt["status"];

export interface StoredAnteUpAttempt {
  id: string;
  profileId: string;
  version: number;
  state: AnteUpAttempt;
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

/** Thrown when the player already has a live Ante Up attempt. */
export class ActiveAnteUpAttemptExists extends Error {
  constructor() {
    super("You already have an Ante Up attempt in progress.");
    this.name = "ActiveAnteUpAttemptExists";
  }
}

const ATTEMPT_COLUMNS =
  "id, profile_id, wager, status, version, state, created_at, settled_at";

interface AttemptRow {
  id: string;
  profile_id: string;
  version: number | string;
  state: unknown;
  created_at: string;
  settled_at: string | null;
}

function fromRow(row: AttemptRow): StoredAnteUpAttempt {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    version: Number(row.version),
    state: row.state as AnteUpAttempt,
    createdAt: String(row.created_at),
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

/** A defensive copy, so a caller mutating what it got back cannot reach into the memory store. */
function clone(attempt: StoredAnteUpAttempt): StoredAnteUpAttempt {
  return { ...attempt, state: structuredClone(attempt.state) };
}

function memoryActiveFor(profileId: string): StoredAnteUpAttempt | undefined {
  return [...memoryAttempts.values()].find(
    (attempt) => attempt.state.status === "active" && attempt.profileId === profileId,
  );
}

/** The caller's live attempt, or null. What restores the board after a refresh. */
export async function getActiveAnteUpAttempt(profileId: string): Promise<StoredAnteUpAttempt | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryActiveFor(profileId);
    return found ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Could not load your Ante Up attempt: ${error.message}`);
  return data ? fromRow(data as AttemptRow) : null;
}

/** An attempt by id, whoever it belongs to. The service checks ownership before redacting. */
export async function getAnteUpAttemptById(id: string): Promise<StoredAnteUpAttempt | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryAttempts.get(id);
    return found ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load that attempt: ${error.message}`);
  return data ? fromRow(data as AttemptRow) : null;
}

/**
 * Opens an attempt. Throws ActiveAnteUpAttemptExists when the player already
 * has one live -- caught from the partial unique index (23505) rather than a
 * read-first check, for the same race reason pvp-match-store.ts gives.
 */
export async function createAnteUpAttempt(input: {
  profileId: string;
  state: AnteUpAttempt;
}): Promise<StoredAnteUpAttempt> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    if (memoryActiveFor(input.profileId)) throw new ActiveAnteUpAttemptExists();
    const attempt: StoredAnteUpAttempt = {
      id: randomUUID(),
      profileId: input.profileId,
      version: 1,
      state: input.state,
      createdAt: now,
      settledAt: null,
    };
    memoryAttempts.set(attempt.id, clone(attempt));
    return clone(attempt);
  }

  const { data, error } = await supabase
    .from("ante_up_attempts")
    .insert({
      profile_id: input.profileId,
      wager: input.state.wager,
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
  return fromRow(data as AttemptRow);
}

/**
 * Writes the next state, but only if nobody else already did. Returns null on
 * a lost race -- a stale version, a replayed request -- and the caller must
 * not pay out on null. Same contract as pvp-match-store.ts's advancePvpMatch.
 */
export async function advanceAnteUpAttempt(
  current: StoredAnteUpAttempt,
  next: AnteUpAttempt,
): Promise<StoredAnteUpAttempt | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const now = new Date().toISOString();
  const settled = next.status !== "active";

  if (!supabase) {
    const stored = memoryAttempts.get(current.id);
    if (!stored || stored.state.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredAnteUpAttempt = {
      ...stored,
      version,
      state: next,
      settledAt: settled ? now : null,
    };
    memoryAttempts.set(current.id, clone(updated));
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
  return data ? fromRow(data as AttemptRow) : null;
}

/**
 * How many wagered attempts (wager > 0) this player opened since `since`.
 * Free practice attempts do not count -- see ANTE_UP_DAILY_WAGERED_LIMIT's
 * doc comment for why the cap exists at all.
 */
export async function countWageredAttemptsSince(profileId: string, since: Date): Promise<number> {
  const supabase = adminClient();
  const sinceIso = since.toISOString();

  if (!supabase) {
    return [...memoryAttempts.values()].filter(
      (attempt) => attempt.profileId === profileId && attempt.state.wager > 0 && attempt.createdAt >= sinceIso,
    ).length;
  }

  const { count, error } = await supabase
    .from("ante_up_attempts")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gt("wager", 0)
    .gte("created_at", sinceIso);
  if (error) throw new Error(`Could not check today's Ante Up attempts: ${error.message}`);
  return count ?? 0;
}
