import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { advanceTimedTurn, normalizeGameState } from "@/lib/game/engine";
import type { GameState, PlayerAction } from "@/lib/game/types";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { readSupabaseRuntimeConfig } from "./runtime-config";

declare global {
  var __riverRoomGames: Map<string, GameState> | undefined;
}

const memoryGames = globalThis.__riverRoomGames ?? new Map<string, GameState>();
globalThis.__riverRoomGames = memoryGames;

export function adminClient(): SupabaseClient | null {
  const config = readSupabaseRuntimeConfig();
  if (!config) return null;
  return createClient(config.url, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

export function persistenceMode() {
  return adminClient() ? "supabase" : "memory";
}

export async function createStoredGame(state: GameState): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryGames.set(state.id, clone(state));
    return;
  }

  const host = state.seats.find((seat) => seat.ownerToken === state.hostToken)!;
  const { error: sessionError } = await supabase.from("player_sessions").upsert({
    token: state.hostToken,
    display_name: host.name,
    last_seen_at: new Date().toISOString(),
  });
  if (sessionError) throw new Error(`Could not create player session: ${sessionError.message}`);

  const { error: gameError } = await supabase.from("games").insert({
    id: state.id,
    owner_token: state.hostToken,
    status: state.status,
    is_private: state.isPrivate,
    room_code: state.roomCode,
    small_blind: state.smallBlind,
    big_blind: state.bigBlind,
    current_hand_number: state.handNumber,
  });
  if (gameError) throw new Error(`Could not create table: ${gameError.message}`);

  const { error: stateError } = await supabase.from("game_state_private").insert({
    game_id: state.id,
    version: state.version,
    state,
  });
  if (stateError) throw new Error(`Could not save game state: ${stateError.message}`);

  const { data: profileRecord, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("session_token", state.hostToken)
    .maybeSingle();
  if (profileError) throw new Error(`Could not link player profile: ${profileError.message}`);

  const { error: seatsError } = await supabase.from("game_seats").insert(
    state.seats.map((seat) => ({
      id: seat.id,
      game_id: state.id,
      profile_id: seat.isHuman ? profileRecord?.id ?? null : null,
      owner_token: seat.ownerToken,
      personality: seat.personality,
      seat_number: seat.position,
      display_name: seat.name,
      initials: seat.initials,
      avatar_preset: seat.avatarPreset,
      avatar_url: seat.avatarUrl,
      accent: seat.accent,
      is_bot: !seat.isHuman,
      stack: seat.stack,
      status: seat.status,
    })),
  );
  if (seatsError) throw new Error(`Could not seat players: ${seatsError.message}`);

  await supabase.from("game_signals").insert({
    game_id: state.id,
    version: state.version,
  });
}

/** Finds the oldest public, still-playable table with an open (bot) seat. */
/**
 * Finds an open public table at a specific stakes tier. Filters by the
 * tier's blinds (small_blind/big_blind are already dedicated, indexed
 * columns on `games`) rather than adding a new `tier` column -- blinds
 * uniquely determine tier in this app's fixed 3-tier config.
 */
export async function findOpenPublicGame(tier: StakesTier): Promise<string | null> {
  const config = TIER_CONFIG[tier];
  const supabase = adminClient();
  if (!supabase) {
    let best: GameState | null = null;
    for (const state of memoryGames.values()) {
      if (state.isPrivate || state.status !== "playing") continue;
      if (state.tier !== tier) continue;
      if (!state.seats.some((seat) => seat.ownerToken === null)) continue;
      if (!best || state.createdAt < best.createdAt) best = state;
    }
    return best?.id ?? null;
  }

  const { data, error } = await supabase
    .from("game_seats")
    .select("game_id, games!inner(created_at, is_private, status, small_blind, big_blind)")
    .is("owner_token", null)
    .eq("is_bot", true)
    .eq("games.is_private", false)
    .eq("games.status", "playing")
    .eq("games.small_blind", config.smallBlind)
    .eq("games.big_blind", config.bigBlind)
    .order("created_at", { referencedTable: "games", ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not search for an open table: ${error.message}`);
  return data?.[0]?.game_id ?? null;
}

/** Resolves a shareable private-room code to its table id. */
export async function findGameByRoomCode(code: string): Promise<string | null> {
  const supabase = adminClient();
  if (!supabase) {
    for (const state of memoryGames.values()) {
      if (state.roomCode === code) return state.id;
    }
    return null;
  }
  const { data, error } = await supabase.from("games").select("id").eq("room_code", code).maybeSingle();
  if (error) throw new Error(`Could not look up that room code: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Loads a table and advances one due server-authoritative turn before
 * returning it: an expired human clock or one paced bot decision.
 * Any route that reads a table (a poll, an action, a spectator view) should
 * go through this rather than getStoredGame directly.
 */
export async function loadGameWithTimeouts(id: string): Promise<GameState | null> {
  const state = await getStoredGame(id);
  if (!state) return null;
  const advanced = advanceTimedTurn(state);
  if (!advanced.action || !advanced.actorSeatId) return state;
  try {
    await persistTimedTurn(advanced.state, advanced.actorSeatId, advanced.action);
    return advanced.state;
  } catch {
    // Another request already changed the table between our read and this
    // write; serve its latest state instead of failing an otherwise-passive read.
    return getStoredGame(id);
  }
}

export async function getStoredGame(id: string): Promise<GameState | null> {
  const supabase = adminClient();
  if (!supabase) return memoryGames.has(id) ? normalizeGameState(clone(memoryGames.get(id)!)) : null;
  const { data, error } = await supabase
    .from("game_state_private")
    .select("state")
    .eq("game_id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the table: ${error.message}`);
  return data?.state ? normalizeGameState(data.state as GameState) : null;
}

export async function updateStoredGame(
  state: GameState,
  action: PlayerAction,
  callerToken: string,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryGames.get(state.id);
    if (current && current.version !== state.version - 1) {
      throw new Error("The table changed. Refresh and try again.");
    }
    memoryGames.set(state.id, clone(state));
    return;
  }

  const previousVersion = state.version - 1;
  const actorSeat = state.seats.find((seat) => seat.ownerToken === callerToken);
  const { error } = await supabase.rpc("persist_game_action", {
    p_game_id: state.id,
    p_expected_version: previousVersion,
    p_state: state,
    p_action_type: action.type.replaceAll("-", "_"),
    p_amount: action.type === "raise" ? action.amount : null,
    p_actor_seat_id: action.type === "next-hand" ? null : actorSeat?.id ?? null,
  });
  if (error) {
    if (error.code === "40001") throw new Error("The table changed. Refresh and try again.");
    throw new Error(`Could not update the table: ${error.message}`);
  }
}

/**
 * Persists a seat claim (a bot seat becoming human-controlled via quick play
 * or a room code). This isn't a PlayerAction, so it reuses the same
 * optimistic-concurrency RPC with the 'deal' audit action rather than
 * widening the action_type enum for one rare event.
 */
export async function persistSeatClaim(state: GameState, seatId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryGames.get(state.id);
    if (current && current.version !== state.version - 1) {
      throw new Error("The table changed. Refresh and try again.");
    }
    memoryGames.set(state.id, clone(state));
    return;
  }

  const previousVersion = state.version - 1;
  const { error } = await supabase.rpc("persist_game_action", {
    p_game_id: state.id,
    p_expected_version: previousVersion,
    p_state: state,
    p_action_type: "deal",
    p_amount: null,
    p_actor_seat_id: seatId,
  });
  if (error) {
    if (error.code === "40001") throw new Error("The table changed. Refresh and try again.");
    throw new Error(`Could not join the table: ${error.message}`);
  }
}

/** Persists one due bot action or human timeout produced by advanceTimedTurn. */
async function persistTimedTurn(
  state: GameState,
  actorSeatId: string,
  action: Exclude<PlayerAction, { type: "next-hand" | "leave-seat" | "use-time-card" }>,
): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryGames.get(state.id);
    if (current && current.version !== state.version - 1) {
      throw new Error("The table changed. Refresh and try again.");
    }
    memoryGames.set(state.id, clone(state));
    return;
  }

  const previousVersion = state.version - 1;
  const { error } = await supabase.rpc("persist_game_action", {
    p_game_id: state.id,
    p_expected_version: previousVersion,
    p_state: state,
    p_action_type: action.type.replaceAll("-", "_"),
    p_amount: action.type === "raise" ? action.amount : null,
    p_actor_seat_id: actorSeatId,
  });
  if (error) {
    if (error.code === "40001") throw new Error("The table changed. Refresh and try again.");
    throw new Error(`Could not update the table: ${error.message}`);
  }
}
