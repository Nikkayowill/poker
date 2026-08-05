import "server-only";
import { randomUUID } from "crypto";
import type { StakesTier } from "@/lib/game/tiers";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for server-owned arcade rounds, shared across games.
 *
 * This is blackjack-store.ts generalised over a `game` discriminator, written
 * when the second game arrived rather than guessed at when the first did --
 * two examples is the point at which the shape stopped being a hypothesis.
 * Blackjack itself still uses its own table for now, on purpose: it is live,
 * it moves real Gold, and its Supabase path has not yet been exercised by a
 * real hand, so restacking its storage underneath it would pile one unproven
 * thing on another. Folding it in is a follow-up.
 *
 * The stored `round` is the game's whole state INCLUDING its undealt deck.
 * Nothing here is safe to hand to a client; each game's route redacts through
 * its own `to*Snapshot`.
 *
 * Supabase when configured, an in-process Map otherwise. The memory branch is
 * what `npm test` and a no-env dev server run on, so it enforces the same two
 * invariants the table's constraints do: one active round per (profile, game),
 * and a version that only advances from the value the caller last saw.
 */

export type ArcadeRoundStatus = "active" | "settled";

export interface StoredArcadeRound<TRound> {
  id: string;
  profileId: string;
  game: string;
  version: number;
  status: ArcadeRoundStatus;
  tier: StakesTier;
  baseStake: number;
  round: TRound;
}

/** Thrown when a profile already has a live round of this game. The route resumes it rather than dealing another. */
export class ActiveArcadeRoundExists extends Error {
  constructor(game: string) {
    super(`You already have a ${game} round in progress.`);
    this.name = "ActiveArcadeRoundExists";
  }
}

declare global {
  var __riverRoomArcadeRounds: Map<string, StoredArcadeRound<unknown>> | undefined;
}

const memoryRounds =
  globalThis.__riverRoomArcadeRounds ?? new Map<string, StoredArcadeRound<unknown>>();
globalThis.__riverRoomArcadeRounds = memoryRounds;

/** Test seam only: the memory branch is process-global, so suites must not leak rounds into each other. */
export function __resetArcadeRoundsForTest(): void {
  memoryRounds.clear();
}

interface RoundRow {
  id: string;
  profile_id: string;
  game: string;
  version: number | string;
  status: string;
  tier: string;
  base_stake: number | string;
  state: unknown;
}

const ROUND_COLUMNS = "id, profile_id, game, version, status, tier, base_stake, state";

function fromRow<TRound>(row: RoundRow): StoredArcadeRound<TRound> {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    game: String(row.game),
    version: Number(row.version),
    status: String(row.status) as ArcadeRoundStatus,
    tier: String(row.tier) as StakesTier,
    baseStake: Number(row.base_stake),
    round: row.state as TRound,
  };
}

/** A defensive copy, so a caller mutating what it got back cannot reach into the memory store. */
function clone<TRound>(stored: StoredArcadeRound<TRound>): StoredArcadeRound<TRound> {
  return { ...stored, round: structuredClone(stored.round) };
}

export async function getActiveArcadeRound<TRound>(
  profileId: string,
  game: string,
): Promise<StoredArcadeRound<TRound> | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = [...memoryRounds.values()].find(
      (stored) => stored.profileId === profileId && stored.game === game && stored.status === "active",
    );
    return found ? (clone(found) as StoredArcadeRound<TRound>) : null;
  }

  const { data, error } = await supabase
    .from("arcade_rounds")
    .select(ROUND_COLUMNS)
    .eq("profile_id", profileId)
    .eq("game", game)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Could not load the ${game} round: ${error.message}`);
  return data ? fromRow<TRound>(data as RoundRow) : null;
}

/**
 * Opens a round. Throws ActiveArcadeRoundExists when one is already live.
 *
 * The duplicate is caught from the partial unique index (23505) rather than by
 * reading first and then inserting: two concurrent deals both pass a
 * read-first check, and each has already debited a stake by the time it gets
 * here.
 */
export async function createArcadeRound<TRound>(input: {
  profileId: string;
  game: string;
  tier: StakesTier;
  baseStake: number;
  round: TRound;
  /** Whether the round is already over -- a game can settle on the deal. */
  settled: boolean;
}): Promise<StoredArcadeRound<TRound>> {
  const supabase = adminClient();
  const status: ArcadeRoundStatus = input.settled ? "settled" : "active";

  if (!supabase) {
    const live = [...memoryRounds.values()].some(
      (stored) => stored.profileId === input.profileId && stored.game === input.game && stored.status === "active",
    );
    if (live) throw new ActiveArcadeRoundExists(input.game);
    const stored: StoredArcadeRound<TRound> = {
      id: randomUUID(),
      profileId: input.profileId,
      game: input.game,
      version: 1,
      status,
      tier: input.tier,
      baseStake: input.baseStake,
      round: input.round,
    };
    memoryRounds.set(stored.id, clone(stored) as StoredArcadeRound<unknown>);
    return clone(stored);
  }

  const { data, error } = await supabase
    .from("arcade_rounds")
    .insert({
      profile_id: input.profileId,
      game: input.game,
      version: 1,
      status,
      tier: input.tier,
      base_stake: input.baseStake,
      state: input.round,
    })
    .select(ROUND_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new ActiveArcadeRoundExists(input.game);
    throw new Error(`Could not open the ${input.game} round: ${error.message}`);
  }
  return fromRow<TRound>(data as RoundRow);
}

/**
 * Applies the next round state, but only if nobody else already did.
 *
 * Returns null on a lost race -- a stale version, a replayed request, a
 * double-clicked call. The caller must treat null as "this action did not
 * happen" and, critically, must not pay out on it: the guard is what makes a
 * settlement happen exactly once, since only one UPDATE can match a version.
 */
export async function advanceArcadeRound<TRound>(
  current: StoredArcadeRound<TRound>,
  next: TRound,
  settled: boolean,
): Promise<StoredArcadeRound<TRound> | null> {
  const supabase = adminClient();
  const status: ArcadeRoundStatus = settled ? "settled" : "active";
  const version = current.version + 1;

  if (!supabase) {
    const stored = memoryRounds.get(current.id);
    // The same three conditions the WHERE clause below tests, in order: the
    // row exists, it is still live, and it is at the version acted on.
    if (!stored || stored.status !== "active" || stored.version !== current.version) return null;
    const updated: StoredArcadeRound<TRound> = {
      ...(stored as StoredArcadeRound<TRound>),
      version,
      status,
      round: next,
    };
    memoryRounds.set(current.id, clone(updated) as StoredArcadeRound<unknown>);
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("arcade_rounds")
    .update({ version, status, state: next, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "active")
    .select(ROUND_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not save the ${current.game} round: ${error.message}`);
  return data ? fromRow<TRound>(data as RoundRow) : null;
}
