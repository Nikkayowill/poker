import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameState, PlayerAction } from "@/lib/game/types";

declare global {
  var __riverRoomGames: Map<string, GameState> | undefined;
}

const memoryGames = globalThis.__riverRoomGames ?? new Map<string, GameState>();
globalThis.__riverRoomGames = memoryGames;

export function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
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

  const human = state.seats.find((seat) => seat.isHuman)!;
  const { error: sessionError } = await supabase.from("player_sessions").upsert({
    token: state.ownerToken,
    display_name: human.name,
    last_seen_at: new Date().toISOString(),
  });
  if (sessionError) throw new Error(`Could not create player session: ${sessionError.message}`);

  const { error: gameError } = await supabase.from("games").insert({
    id: state.id,
    owner_token: state.ownerToken,
    status: state.status,
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
    .eq("session_token", state.ownerToken)
    .maybeSingle();
  if (profileError) throw new Error(`Could not link player profile: ${profileError.message}`);

  const { error: seatsError } = await supabase.from("game_seats").insert(
    state.seats.map((seat) => ({
      id: seat.id,
      game_id: state.id,
      profile_id: seat.isHuman ? profileRecord?.id ?? null : null,
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

export async function getStoredGame(id: string): Promise<GameState | null> {
  const supabase = adminClient();
  if (!supabase) return memoryGames.has(id) ? clone(memoryGames.get(id)!) : null;
  const { data, error } = await supabase
    .from("game_state_private")
    .select("state")
    .eq("game_id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the table: ${error.message}`);
  return data?.state ? (data.state as GameState) : null;
}

export async function updateStoredGame(
  state: GameState,
  action: PlayerAction,
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
  const human = state.seats.find((seat) => seat.isHuman)!;
  const { error } = await supabase.rpc("persist_game_action", {
    p_game_id: state.id,
    p_expected_version: previousVersion,
    p_state: state,
    p_action_type: action.type.replace("-", "_"),
    p_amount: action.type === "raise" ? action.amount : null,
    p_actor_seat_id: action.type === "next-hand" ? null : human.id,
  });
  if (error) {
    if (error.code === "40001") throw new Error("The table changed. Refresh and try again.");
    throw new Error(`Could not update the table: ${error.message}`);
  }
}
