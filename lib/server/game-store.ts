import "server-only";
import { SEAT_COUNT, advanceTimedTurn, dealNextHandIfDue, normalizeGameState } from "@/lib/game/engine";
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
 * How long a table's most recently active human seat can go quiet before it
 * stops counting as "populated" for matchmaking, and becomes eligible to be
 * archived outright.
 *
 * The two jobs deliberately share one threshold. `/api/games/[id]/advance`
 * -- the only thing that ever forces a stalled turn along -- can only be
 * called by a seat still at the table (see that route's own check), so once
 * every human seat has been this quiet, nobody can ever advance the table
 * again either: the same fact that should stop matchmaking from preferring
 * it is the fact that makes it worth retiring.
 *
 * Not the 15s turn clock: that fires only when *another* seated human's
 * client is still around to notice the deadline passed. This is the much
 * longer "is anyone plausibly still at this table at all" signal, read off
 * `player_sessions.last_seen_at`, which is bumped by ordinary app traffic
 * app-wide, not by this table specifically.
 *
 * A function, not a frozen constant, and read fresh on every call rather
 * than once at import -- the same reason `botVoluntaryLeaveChance` in
 * engine.ts is one: a test that sets the override after this module has
 * already loaded needs it to take effect, not the value that was live at
 * import time.
 */
function staleTableMs(): number {
  const override = Number(process.env.RIVER_STALE_TABLE_MS);
  return Number.isFinite(override) && override > 0 ? override : 30 * 60 * 1000;
}

/**
 * Bound on one archive sweep. `archiveStaleGames` runs as a side effect of
 * ordinary matchmaking traffic rather than off its own schedule (there is no
 * cron here), so it stays a small, cheap pass -- the oldest-touched
 * candidates first -- and drains the backlog over many calls rather than
 * scanning every `playing` row on each one.
 */
const STALE_SWEEP_LIMIT = 25;

/**
 * Retires tables that no human can ever unstick.
 *
 * A table every human has abandoned has no path back to life: nothing
 * server-side runs on a schedule, and the one route that can force a stalled
 * turn along requires a caller who is themselves seated there. A table with
 * no human seat at all (every occupant a bot) is included for the identical
 * reason -- it is exactly as stuck, and seats nobody.
 *
 * Sets `status: "archived"`, never `"complete"`. `"complete"` is this
 * engine's *between-hands* rest state -- `dealNextHandIfDue` deals the next
 * hand the moment it sees one -- so writing it here would just relaunch the
 * same dead table into another hand nobody will ever finish either.
 * `"archived"` is the status nothing in the engine treats as anything but
 * terminal, because every actionable guard checks `=== "playing"`
 * positively (see `GameStatus`'s own comment) rather than `!== "complete"`.
 *
 * Refunds each abandoned human seat's stack before the table closes,
 * best-effort and logged per seat rather than all-or-nothing -- the same
 * shape `resolveTimedAdvance`'s inactive-release credit already uses above,
 * and for the same reason: a missing profile (most often a deleted guest
 * account) must not block the sweep, but a real balance must not simply
 * vanish because the table that held it got cleaned up.
 *
 * Guarded on `status = "playing"` in the same write that sets `"archived"`,
 * so a table someone genuinely returns to mid-sweep is left alone rather
 * than yanked out from under them.
 */
export async function archiveStaleGames(limit = STALE_SWEEP_LIMIT): Promise<number> {
  const supabase = adminClient();
  const cutoffIso = new Date(Date.now() - staleTableMs()).toISOString();

  if (!supabase) {
    let archived = 0;
    for (const state of memoryGames.values()) {
      if (state.status !== "playing") continue;
      if (state.updatedAt >= cutoffIso) continue;
      for (const seat of state.seats) {
        if (!seat.ownerToken || seat.stack <= 0) continue;
        try {
          await creditGold(seat.ownerToken, seat.stack);
        } catch (error) {
          console.error("table.stale_archive_credit_failed", { gameId: state.id, token: seat.ownerToken, error });
        }
      }
      state.status = "archived";
      state.updatedAt = new Date().toISOString();
      archived += 1;
      if (archived >= limit) break;
    }
    return archived;
  }

  // Oldest-touched first and bounded, not filtered on updated_at here: a
  // table can be nudged (e.g. by a poll that finds nothing due) without any
  // human genuinely being present, so updated_at alone would under-count
  // staleness. The real check below, against player_sessions, is what
  // decides -- this first query only picks which candidates to check.
  const { data: candidates, error: candidateError } = await supabase
    .from("games")
    .select("id")
    .eq("status", "playing")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (candidateError || !candidates || candidates.length === 0) return 0;
  const candidateIds = candidates.map((row) => row.id as string);

  const { data: seatRows, error: seatError } = await supabase
    .from("game_seats")
    .select("game_id, owner_token, stack")
    .in("game_id", candidateIds)
    .not("owner_token", "is", null);
  if (seatError) return 0;

  const humanSeatsByGame = new Map<string, { token: string; stack: number }[]>();
  for (const row of seatRows ?? []) {
    const list = humanSeatsByGame.get(row.game_id as string) ?? [];
    list.push({ token: row.owner_token as string, stack: Number(row.stack) });
    humanSeatsByGame.set(row.game_id as string, list);
  }

  const allTokens = [...new Set([...humanSeatsByGame.values()].flat().map((seat) => seat.token))];
  let recentTokens = new Set<string>();
  if (allTokens.length > 0) {
    const { data: sessions } = await supabase
      .from("player_sessions")
      .select("token")
      .in("token", allTokens)
      .gt("last_seen_at", cutoffIso);
    recentTokens = new Set((sessions ?? []).map((row) => row.token as string));
  }

  const toArchive = candidateIds.filter((id) => {
    const humans = humanSeatsByGame.get(id) ?? [];
    return humans.every((seat) => !recentTokens.has(seat.token));
  });
  if (toArchive.length === 0) return 0;

  const { data: archived, error: archiveError } = await supabase
    .from("games")
    .update({ status: "archived" })
    .in("id", toArchive)
    .eq("status", "playing")
    .select("id");
  if (archiveError || !archived) return 0;

  for (const row of archived) {
    const gameId = row.id as string;
    for (const seat of humanSeatsByGame.get(gameId) ?? []) {
      if (seat.stack <= 0) continue;
      try {
        await creditGold(seat.token, seat.stack);
      } catch (error) {
        console.error("table.stale_archive_credit_failed", { gameId, token: seat.token, error });
      }
    }
  }
  return archived.length;
}

/**
 * An open seat at a public table of this tier, preferring one that already has
 * a person at it who is plausibly still around.
 *
 * The preference is the point. Quick-play has always joined an existing table
 * before creating one, but it took the *oldest* open table, and every table is
 * created full of bots -- so two players arriving a minute apart were reliably
 * sent to two different tables, each to sit with six bots, and the game looked
 * unplayed even when it was not. Ranking a populated table first is what makes
 * two people who press Play at the same time end up in the same hand.
 *
 * "Populated" alone was not enough, and staying with it silently routed new
 * players into tables three abandoned sessions had left mid-hand hours or
 * days earlier -- occupied on paper, unplayable in fact (see
 * `archiveStaleGames`'s comment for why nothing rescues those on its own).
 * A seat only counts toward this preference if `staleTableMs()` has not
 * passed since its owner's session was last seen anywhere in the app.
 *
 * Falls back to the oldest open table, and then to nothing, which the caller
 * reads as "create one". A table with only bots -- or only quiet humans --
 * is still a perfectly good answer, just the second-best one.
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
      // A recently-active human beats any empty or gone-quiet table; between
      // two of the same kind, the older one still wins, so tables fill up
      // rather than all filling one seat each. Memory mode has no separate
      // session-recency signal, so the table's own updatedAt stands in for
      // it -- reasonable for a single-process dev/test store where "quiet"
      // and "abandoned" are the same fact, unlike the persisted Supabase case.
      const staleCutoff = new Date(Date.now() - staleTableMs()).toISOString();
      const hasHuman = state.seats.some((seat) => seat.ownerToken !== null) && state.updatedAt >= staleCutoff;
      if (!best || (hasHuman && !bestHasHuman) || (hasHuman === bestHasHuman && state.createdAt < best.createdAt)) {
        best = state;
        bestHasHuman = hasHuman;
      }
    }
    return best?.id ?? null;
  }

  try {
    await archiveStaleGames();
  } catch (error) {
    // A failed sweep is not a failed match -- see the ranking fallback below
    // for the same principle applied one step further down.
    console.error("table.stale_sweep_failed", { error });
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
    // Rows, not tables. Every open seat is its own row, so a freshly created
    // table contributes up to SEAT_COUNT of them -- limiting to
    // MATCHMAKING_CANDIDATES here would have capped the field at four or five
    // distinct games, not twenty, and silently dropped every eligible table
    // after them. The de-duplication below is what applies the real cap.
    .limit(MATCHMAKING_CANDIDATES * SEAT_COUNT);
  if (error) throw new Error(`Could not search for an open table: ${error.message}`);
  const candidates = data ?? [];
  if (candidates.length === 0) return null;

  // Ordered oldest-first by the query above, and de-duplicated here because a
  // table with three open seats comes back three times. This is where
  // MATCHMAKING_CANDIDATES is actually enforced: it is a budget of distinct
  // tables to rank, which is what the second query below is sized against.
  const candidateIds: string[] = [];
  for (const row of candidates) {
    if (!candidateIds.includes(row.game_id)) candidateIds.push(row.game_id);
    if (candidateIds.length === MATCHMAKING_CANDIDATES) break;
  }

  const { data: occupied, error: occupiedError } = await supabase
    .from("game_seats")
    .select("game_id, owner_token")
    .in("game_id", candidateIds)
    .not("owner_token", "is", null);
  // A failure to rank is not a failure to match: the oldest open table is
  // still a table, and sending someone to it beats refusing to seat them.
  if (occupiedError) return candidateIds[0];
  const occupiedRows = occupied ?? [];

  // "Occupied" alone is not "populated" -- see this function's own comment.
  // A seat only counts if its owner's session has been seen anywhere in the
  // app within staleTableMs(); a failure here degrades to the old, coarser
  // "any owner_token" behaviour rather than failing the match entirely, for
  // the same reason as the fallback just above.
  const ownerTokens = [...new Set(occupiedRows.map((row) => row.owner_token as string))];
  let recentTokens: Set<string> | null = null;
  if (ownerTokens.length > 0) {
    const staleCutoff = new Date(Date.now() - staleTableMs()).toISOString();
    const { data: sessions, error: sessionError } = await supabase
      .from("player_sessions")
      .select("token")
      .in("token", ownerTokens)
      .gt("last_seen_at", staleCutoff);
    if (!sessionError) recentTokens = new Set((sessions ?? []).map((row) => row.token as string));
  }

  const populated = new Set(
    occupiedRows
      .filter((row) => (recentTokens ? recentTokens.has(row.owner_token as string) : true))
      .map((row) => row.game_id),
  );
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
