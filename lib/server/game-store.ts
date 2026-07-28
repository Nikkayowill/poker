import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { advanceTimedTurn, normalizeGameState } from "@/lib/game/engine";
import type { GameState, PlayerAction } from "@/lib/game/types";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { readSupabaseRuntimeConfig } from "./runtime-config";

declare global {
  var __riverRoomGames: Map<string, GameState> | undefined;
  var __riverRoomTimedAdvances: Map<string, Promise<GameState>> | undefined;
}

const memoryGames = globalThis.__riverRoomGames ?? new Map<string, GameState>();
globalThis.__riverRoomGames = memoryGames;
const timedAdvances = globalThis.__riverRoomTimedAdvances ?? new Map<string, Promise<GameState>>();
globalThis.__riverRoomTimedAdvances = timedAdvances;

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

/** Every table currently tracked by the store, split by public/private -- there's no separate archival state, so "tracked" is "running." */
export async function countActiveGames(): Promise<{ publicTables: number; privateTables: number }> {
  const supabase = adminClient();
  if (!supabase) {
    let publicTables = 0;
    let privateTables = 0;
    for (const state of memoryGames.values()) {
      if (state.isPrivate) privateTables += 1;
      else publicTables += 1;
    }
    return { publicTables, privateTables };
  }
  const [publicResult, privateResult] = await Promise.all([
    supabase.from("games").select("id").eq("is_private", false),
    supabase.from("games").select("id").eq("is_private", true),
  ]);
  if (publicResult.error) throw new Error(`Could not count public tables: ${publicResult.error.message}`);
  if (privateResult.error) throw new Error(`Could not count private tables: ${privateResult.error.message}`);
  return {
    publicTables: publicResult.data?.length ?? 0,
    privateTables: privateResult.data?.length ?? 0,
  };
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
 * returning it: an expired human clock or one paced bot decision. Mutation
 * routes use this helper; snapshot GETs deliberately call getStoredGame.
 */
export async function loadGameWithTimeouts(id: string): Promise<GameState | null> {
  const state = await getStoredGame(id);
  if (!state) return null;
  return advanceStoredGameWithTimeouts(state);
}

/**
 * Advances one due turn from an already-authorized snapshot. Timed actions use
 * a no-throw optimistic RPC because several seated browsers can wake at the
 * same deadline; a loser simply reads and returns the winner's state.
 */
export async function advanceStoredGameWithTimeouts(state: GameState): Promise<GameState> {
  const key = `${state.id}:${state.version}`;
  const existing = timedAdvances.get(key);
  if (existing) return existing;

  const work = resolveTimedAdvance(state);
  timedAdvances.set(key, work);
  try {
    return await work;
  } finally {
    if (timedAdvances.get(key) === work) timedAdvances.delete(key);
  }
}

/**
 * The most consecutive due turns one request will resolve.
 *
 * A bound, not a target. Each turn the engine resolves writes the next seat a
 * fresh think deadline in the future, so in normal play this loop runs exactly
 * once and stops -- the pacing between bots is preserved. It only iterates
 * when several deadlines are already in the past, which happens when nobody
 * was awake to advance them: a backgrounded tab, a dropped connection, a
 * server that just came up. Catching those up in one request is the whole
 * reason the browser no longer needs to poll.
 */
const MAX_ADVANCE_STEPS = 12;

async function resolveTimedAdvance(state: GameState): Promise<GameState> {
  let current = state;

  for (let step = 0; step < MAX_ADVANCE_STEPS; step += 1) {
    const advanced = advanceTimedTurn(current);
    // Nothing was due: either it is a human's turn and their clock is still
    // running, or the hand is over. Either way this is where we stop, and it
    // is the normal exit.
    if (!advanced.action || !advanced.actorSeatId) {
      logAdvance(current, step, "nothing due");
      return current;
    }

    const persisted = await persistTimedTurn(advanced.state, advanced.actorSeatId, advanced.action);
    if (!persisted) {
      // Another request got there first. Its state is authoritative; ours is
      // stale, so adopt theirs rather than replaying our own decision on top.
      logAdvance(current, step, "lost the optimistic write; adopting stored state");
      return await getStoredGame(state.id) ?? current;
    }

    current = advanced.state;
    logAdvance(current, step, `applied ${advanced.action.type}`);

    // Stop the moment a human is on the clock. Their deadline is minutes of
    // wall time away in machine terms, and resolving it here would be taking
    // their turn for them.
    if (current.currentPlayer !== null && current.seats[current.currentPlayer]?.isHuman) {
      logAdvance(current, step, "human on turn");
      return current;
    }
  }

  logAdvance(current, MAX_ADVANCE_STEPS, "hit the step ceiling");
  return current;
}

/**
 * Development tracing for the turn flow. Off unless RIVER_TRACE_TURNS=1, and
 * never in production or under test. This exists so "why did it advance
 * again" is answerable from a terminal instead of by reasoning about it.
 *
 *   RIVER_TRACE_TURNS=1 npm run dev
 */
export function logTurn(state: GameState, why: string, extra: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === "production" || process.env.VITEST) return;
  if (process.env.RIVER_TRACE_TURNS !== "1") return;
  const seat = state.currentPlayer === null ? null : state.seats[state.currentPlayer];
  // Who still owes a decision this street, by the engine's own rule. If this
  // is empty and the street has not changed, the round should have closed.
  const owed = state.seats
    .filter((s) => s.status === "active" && s.stack > 0 && !(s.acted && s.streetBet === state.currentBet))
    .map((s) => s.name);
  console.info(
    "[turn]",
    JSON.stringify({
      game: state.id.slice(0, 8),
      version: state.version,
      street: state.street,
      currentSeat: state.currentPlayer,
      acting: seat ? `${seat.name}${seat.isHuman ? " (human)" : " (bot)"}` : null,
      currentBet: state.currentBet,
      pot: state.pot,
      owedAction: owed,
      roundClosed: owed.length === 0,
      stopped: why,
      ...extra,
    }),
  );
}

function logAdvance(state: GameState, step: number, why: string): void {
  logTurn(state, why, { step });
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
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryGames.get(state.id);
    if (current && current.version !== state.version - 1) {
      return false;
    }
    memoryGames.set(state.id, clone(state));
    return true;
  }

  const previousVersion = state.version - 1;
  const { data, error } = await supabase.rpc("try_persist_timed_game_action", {
    p_game_id: state.id,
    p_expected_version: previousVersion,
    p_state: state,
    p_action_type: action.type.replaceAll("-", "_"),
    p_amount: action.type === "raise" ? action.amount : null,
    p_actor_seat_id: actorSeatId,
  });
  if (error) {
    throw new Error(`Could not update the table: ${error.message}`);
  }
  return data === true;
}
