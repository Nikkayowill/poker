import "server-only";
import { advanceTimedTurn, dealNextHandIfDue, normalizeGameState } from "@/lib/game/engine";
import type { GameState, PlayerAction } from "@/lib/game/types";
import { TIER_CONFIG, type StakesTier } from "@/lib/game/tiers";
import { adminClient } from "./supabase-admin";
import { onHandCompleted } from "./hand-completion";
import { creditGold } from "./profile-store";

// Re-exported for the many existing callers that import it from here.
export { adminClient };

declare global {
  var __riverRoomGames: Map<string, GameState> | undefined;
  var __riverRoomTimedAdvances: Map<string, Promise<GameState>> | undefined;
}

const memoryGames = globalThis.__riverRoomGames ?? new Map<string, GameState>();
globalThis.__riverRoomGames = memoryGames;
const timedAdvances = globalThis.__riverRoomTimedAdvances ?? new Map<string, Promise<GameState>>();
globalThis.__riverRoomTimedAdvances = timedAdvances;

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
/**
 * How many open public tables to weigh against each other before picking one.
 *
 * Bounded because the choice below needs a second query over the candidates,
 * and an unbounded first query would make that second one grow with the number
 * of live tables. Twenty is far more than a tier ever has open at once, so in
 * practice this ranks the whole field.
 */
const MATCHMAKING_CANDIDATES = 20;

/**
 * An open seat at a public table of this tier, preferring one that already has
 * a person at it.
 *
 * The preference is the point. Quick-play has always joined an existing table
 * before creating one, but it took the *oldest* open table, and every table is
 * created full of bots -- so two players arriving a minute apart were reliably
 * sent to two different tables, each to sit with six bots, and the game looked
 * unplayed even when it was not. Ranking a populated table first is what makes
 * two people who press Play at the same time end up in the same hand.
 *
 * Falls back to the oldest open table, and then to nothing, which the caller
 * reads as "create one". A table with only bots is still a perfectly good
 * answer -- it is just the second-best one.
 */
export async function findOpenPublicGame(tier: StakesTier): Promise<string | null> {
  const config = TIER_CONFIG[tier];
  const supabase = adminClient();
  if (!supabase) {
    let best: GameState | null = null;
    let bestHasHuman = false;
    for (const state of memoryGames.values()) {
      if (state.isPrivate || state.status !== "playing") continue;
      if (state.tier !== tier) continue;
      if (!state.seats.some((seat) => seat.ownerToken === null)) continue;
      const hasHuman = state.seats.some((seat) => seat.ownerToken !== null);
      // A populated table beats any empty one; between two of the same kind,
      // the older one still wins, so tables fill up rather than all filling
      // one seat each.
      if (!best || (hasHuman && !bestHasHuman) || (hasHuman === bestHasHuman && state.createdAt < best.createdAt)) {
        best = state;
        bestHasHuman = hasHuman;
      }
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
    .limit(MATCHMAKING_CANDIDATES);
  if (error) throw new Error(`Could not search for an open table: ${error.message}`);
  const candidates = data ?? [];
  if (candidates.length === 0) return null;

  // Ordered oldest-first by the query above, and de-duplicated here because a
  // table with three open seats comes back three times.
  const candidateIds: string[] = [];
  for (const row of candidates) {
    if (!candidateIds.includes(row.game_id)) candidateIds.push(row.game_id);
  }

  const { data: occupied, error: occupiedError } = await supabase
    .from("game_seats")
    .select("game_id")
    .in("game_id", candidateIds)
    .not("owner_token", "is", null);
  // A failure to rank is not a failure to match: the oldest open table is
  // still a table, and sending someone to it beats refusing to seat them.
  if (occupiedError) return candidateIds[0];

  const populated = new Set((occupied ?? []).map((row) => row.game_id));
  return candidateIds.find((id) => populated.has(id)) ?? candidateIds[0];
}

/**
 * Tables actually still live, split by public/private -- a completed or
 * archived game is history, not a running table, so those statuses are
 * deliberately excluded rather than counting every row the store has ever
 * seen.
 */
export async function countActiveGames(): Promise<{ publicTables: number; privateTables: number }> {
  const supabase = adminClient();
  if (!supabase) {
    let publicTables = 0;
    let privateTables = 0;
    for (const state of memoryGames.values()) {
      if (state.status !== "playing") continue;
      if (state.isPrivate) privateTables += 1;
      else publicTables += 1;
    }
    return { publicTables, privateTables };
  }
  const [publicResult, privateResult] = await Promise.all([
    supabase.from("games").select("id").eq("is_private", false).in("status", ["waiting", "playing"]),
    supabase.from("games").select("id").eq("is_private", true).in("status", ["waiting", "playing"]),
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

  // A finished hand whose time is up becomes the next one, before the turn
  // loop below runs -- so a single request both deals and gets the first bot
  // thinking, the same way one request already resolves a run of overdue
  // turns. Persisted through the same optimistic write as every other
  // deadline, so several browsers waking together still produce one deal:
  // the losers read back the winner's state instead of dealing again.
  const opening = dealNextHandIfDue(current);
  if (opening.dealt) {
    const persisted = await persistTimedTurn(opening.state, null, { type: "next-hand" });
    if (!persisted) {
      logAdvance(current, 0, "lost the next-hand race; adopting stored state");
      return await getStoredGame(state.id) ?? current;
    }
    current = opening.state;
    logAdvance(current, 0, "dealt the next hand");

    // Only after the release is durably stored. Crediting first would pay a
    // player whose seat had not actually been given up if the write then lost
    // its race -- the same ordering the actions route uses for a deliberate
    // departure, and for the same reason.
    //
    // Awaited rather than fired and forgotten: this is somebody's balance,
    // and the request is already returning a state that says they left the
    // table with it. A failure here is logged loudly because it is the one
    // way this feature can cost a player chips.
    for (const seat of opening.released) {
      try {
        await creditGold(seat.ownerToken, seat.cashedOut);
        logAdvance(current, 0, `released ${seat.name} and returned ${seat.cashedOut}`);
      } catch (error) {
        console.error("table.inactive_release_credit_failed", {
          gameId: current.id,
          player: seat.name,
          cashedOut: seat.cashedOut,
          error,
        });
      }
    }
  }

  for (let step = 0; step < MAX_ADVANCE_STEPS; step += 1) {
    // Captured as a primitive, before the call below -- not `current.status`
    // read afterward. advanceTimedTurn mutates its input in place (it calls
    // applyTurnAction(state, action), which sets fields directly on the same
    // object), so `current` and `advanced.state` are the same reference by
    // the time both are readable. A comparison written as
    // `current.status !== "complete" && advanced.state.status === "complete"`
    // is really comparing that object's status to itself: once a hand
    // actually completes, both sides read the post-mutation value and the
    // condition is false forever. This is why a bot action closing a hand
    // never recorded a stat, while a human's own action did -- the /actions
    // route captures its "was it already complete" flag as a boolean before
    // calling applyPlayerAction, which is immune to this exact trap. Found by
    // running an end-to-end test repeatedly: it worked whenever *my* action
    // closed the hand and silently failed whenever a bot's did, which is
    // exactly the signature of comparing a mutated object to itself.
    const wasPlaying = current.status === "playing";
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

    // A bot's action or a human's expired clock (auto-check/auto-fold) just
    // closed the hand. This is the other place that can happen -- the direct
    // human-action path is hooked in the /actions route -- and it is the one
    // this function exists to reach on its own, without anyone polling for
    // it. Best-effort: a stats failure must never surface as a broken table.
    if (wasPlaying && advanced.state.status === "complete") {
      void onHandCompleted(advanced.state).catch((error) => {
        console.error("Could not record hand stats", error);
      });
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
/**
 * `actorSeatId` is nullable because one deadline has no actor: the one that
 * replaces a finished hand. game_actions.actor_seat_id has always been
 * nullable and `next_hand` has always been in the action_type enum -- the
 * human-driven Deal button writes exactly this row -- so nothing about the
 * schema changes to let the clock write it too.
 */
async function persistTimedTurn(
  state: GameState,
  actorSeatId: string | null,
  action: Exclude<PlayerAction, { type: "leave-seat" | "use-time-card" }>,
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
