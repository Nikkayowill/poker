import "server-only";
import { randomUUID } from "crypto";
import type { BlackjackRound } from "@/lib/arcade/blackjack";
import type { StakesTier } from "@/lib/game/tiers";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for server-owned Blackjack rounds.
 *
 * The stored `round` is the full BlackjackRound including the undealt deck,
 * which is the whole reason the server holds it rather than the browser. What
 * reaches a client is toBlackjackSnapshot()'s redacted view, built in the
 * route; nothing in this file is safe to hand over as-is.
 *
 * Supabase when configured, an in-process Map otherwise, the same split every
 * other store here uses. The memory branch is not a lesser implementation to
 * be tolerated: it is what `npm test` and a no-env dev server run on, so it
 * has to enforce the same two invariants the table's constraints do: one
 * active round per profile, and a version that only advances from the value
 * the caller last saw.
 */

export type BlackjackRoundStatus = "active" | "settled";

/**
 * "practice" is Blackjack's own free mode (lib/server/blackjack-service.ts),
 * not a rung on the shared stakes ladder. It's layered on here rather than
 * added to lib/game/tiers.ts, which the real-money poker lobby also reads.
 */
export type BlackjackRoundTier = StakesTier | "practice";

export interface StoredBlackjackRound {
  id: string;
  profileId: string;
  version: number;
  status: BlackjackRoundStatus;
  tier: BlackjackRoundTier;
  baseStake: number;
  round: BlackjackRound;
  /** When this row last changed. What the staleness sweep in blackjack-service.ts measures against. */
  updatedAt: string;
}

/** Thrown when a profile already has a live round. The route resumes it rather than dealing a second one. */
export class ActiveBlackjackRoundExists extends Error {
  constructor() {
    super("You already have a Blackjack round in progress.");
    this.name = "ActiveBlackjackRoundExists";
  }
}

declare global {
  var __riverRoomBlackjackRounds: Map<string, StoredBlackjackRound> | undefined;
}

const memoryRounds = globalThis.__riverRoomBlackjackRounds ?? new Map<string, StoredBlackjackRound>();
globalThis.__riverRoomBlackjackRounds = memoryRounds;

/** Test seam only: the memory branch is process-global, so suites must not leak rounds into each other. */
export function __resetBlackjackRoundsForTest(): void {
  memoryRounds.clear();
}

interface RoundRow {
  id: string;
  profile_id: string;
  version: number | string;
  status: string;
  tier: string;
  base_stake: number | string;
  state: unknown;
  updated_at: string;
}

function fromRow(row: RoundRow): StoredBlackjackRound {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    version: Number(row.version),
    status: String(row.status) as BlackjackRoundStatus,
    tier: String(row.tier) as BlackjackRoundTier,
    baseStake: Number(row.base_stake),
    round: row.state as BlackjackRound,
    updatedAt: String(row.updated_at),
  };
}

const ROUND_COLUMNS = "id, profile_id, version, status, tier, base_stake, state, updated_at";

/** A defensive copy, so a caller mutating what it got back cannot reach into the memory store. */
function clone(stored: StoredBlackjackRound): StoredBlackjackRound {
  return { ...stored, round: structuredClone(stored.round) };
}

export async function getActiveBlackjackRound(profileId: string): Promise<StoredBlackjackRound | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = [...memoryRounds.values()].find(
      (stored) => stored.profileId === profileId && stored.status === "active",
    );
    return found ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("blackjack_rounds")
    .select(ROUND_COLUMNS)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Could not load the Blackjack round: ${error.message}`);
  return data ? fromRow(data as RoundRow) : null;
}

/**
 * Opens a round. Throws ActiveBlackjackRoundExists when one is already live.
 *
 * The duplicate is caught from the partial unique index (23505), not by
 * reading first and then inserting: two concurrent deals both pass a
 * read-first check, and each one has already debited a stake by the time it
 * gets here. Same reasoning as the crossed-friend-request case in
 * friends-store.ts.
 */
export async function createBlackjackRound(input: {
  profileId: string;
  tier: BlackjackRoundTier;
  baseStake: number;
  round: BlackjackRound;
}): Promise<StoredBlackjackRound> {
  const supabase = adminClient();
  const status: BlackjackRoundStatus = input.round.phase === "settled" ? "settled" : "active";

  if (!supabase) {
    const live = [...memoryRounds.values()].some(
      (stored) => stored.profileId === input.profileId && stored.status === "active",
    );
    if (live) throw new ActiveBlackjackRoundExists();
    const stored: StoredBlackjackRound = {
      id: randomUUID(),
      profileId: input.profileId,
      version: 1,
      status,
      tier: input.tier,
      baseStake: input.baseStake,
      round: input.round,
      updatedAt: new Date().toISOString(),
    };
    memoryRounds.set(stored.id, clone(stored));
    return clone(stored);
  }

  const { data, error } = await supabase
    .from("blackjack_rounds")
    .insert({
      profile_id: input.profileId,
      version: 1,
      status,
      tier: input.tier,
      base_stake: input.baseStake,
      state: input.round,
    })
    .select(ROUND_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new ActiveBlackjackRoundExists();
    throw new Error(`Could not open the Blackjack round: ${error.message}`);
  }
  return fromRow(data as RoundRow);
}

/**
 * Applies the next round state, but only if nobody else already did.
 *
 * Returns null on a lost race: a stale version, a replayed request, or a
 * double-clicked Stand. The caller must treat null as "this action did not
 * happen" and must not pay out on it: the guard is what makes a settlement
 * happen exactly once, since only one UPDATE can match a given version.
 */
export async function advanceBlackjackRound(
  current: StoredBlackjackRound,
  next: BlackjackRound,
): Promise<StoredBlackjackRound | null> {
  const supabase = adminClient();
  const status: BlackjackRoundStatus = next.phase === "settled" ? "settled" : "active";
  const version = current.version + 1;

  if (!supabase) {
    const stored = memoryRounds.get(current.id);
    // The same three conditions the WHERE clause below tests, in the same
    // order: the row exists, it is still live, and it is at the version the
    // caller acted on.
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredBlackjackRound = {
      ...stored,
      version,
      status,
      round: next,
      updatedAt: new Date().toISOString(),
    };
    memoryRounds.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("blackjack_rounds")
    .update({ version, status, state: next, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(ROUND_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not save the Blackjack round: ${error.message}`);
  return data ? fromRow(data as RoundRow) : null;
}
