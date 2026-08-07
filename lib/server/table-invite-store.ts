import "server-only";
import { randomUUID } from "crypto";
import type { PendingTableInvite } from "@/lib/social/types";
import { isBlockedEitherWay } from "./friends-store";
import { getStoredGame } from "./game-store";
import { getPublicProfilesByIds } from "./profile-store";
import { adminClient } from "./supabase-admin";

// Re-exported so server callers keep importing the shape from the store; the
// definition lives in lib/social/types.ts because the client needs it and this
// module is server-only. Same reasoning as friends-store.ts.
export type { PendingTableInvite };

/**
 * How long an invite is worth acting on.
 *
 * Five minutes because an invite is an offer to sit down at a table that is
 * running *right now*: past that the seat is gone, the hand you were invited
 * into is over, and tapping it produces a worse experience than never having
 * seen it. This is the only definition of the window -- `expires_at` is
 * written from it at creation, and the read filters on that column, so
 * changing this number changes newly created invites and nothing else.
 */
export const TABLE_INVITE_TTL_MS = 5 * 60 * 1000;

/** How many invites one poll returns. A notification stack, not an inbox. */
export const PENDING_INVITE_LIMIT = 20;

/**
 * How often one process will bother marking timed-out rows `expired`.
 *
 * The sweep is housekeeping, not correctness: the read below filters on
 * `expires_at` regardless, so a sweep that never runs changes nothing a player
 * can see. Without this throttle a polling endpoint would issue one UPDATE per
 * client per poll to reclaim the same handful of rows.
 */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** Postgres' unique_violation -- here, table_invites_one_pending_per_target. */
const UNIQUE_VIOLATION = "23505";

/** The expiry stamp for an invite created now. Mirrors the not-null `expires_at` column. */
export function tableInviteExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + TABLE_INVITE_TTL_MS).toISOString();
}

export type RespondInviteAction = "accept" | "decline";

/**
 * The outcome of settling an invite.
 *
 * `accepted` is the only branch carrying the room code, and it goes to the
 * route rather than to the client: the route redeems it into a seat and
 * serialises the snapshot, never the code. Everything the caller may not act
 * on -- a lapsed invite, someone else's, one already settled -- collapses into
 * `not_found`, the same way respondToFriendRequest refuses to distinguish
 * "does not exist" from "not yours".
 */
export type RespondInviteResult =
  | { status: "accepted"; gameId: string; roomCode: string }
  | { status: "declined" }
  | { status: "not_found" };

export type CreateInviteResult =
  | { status: "sent"; inviteId: string; expiresAt: string }
  | { status: "already_pending" }
  | { status: "blocked" }
  | { status: "self" }
  | { status: "unknown_profile" }
  /** The table finished, or never existed. */
  | { status: "table_gone" }
  /** A public table has no room code to carry, and the column is not null. */
  | { status: "table_not_private" };

// ---- memory-mode mirror ----------------------------------------------------
//
// Twin branches, same as friends-store.ts and hand-archive-store.ts: a real
// deployment writes through Supabase, and local/dev/test runs against an
// in-process approximation. globalThis so it survives dev-mode module reloads.

interface MemoryInvite {
  id: string;
  gameId: string;
  inviterId: string;
  inviteeId: string;
  roomCode: string;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

declare global {
  var __riverRoomTableInvites: Map<string, MemoryInvite> | undefined;
  var __riverRoomInviteSweepAt: number | undefined;
}

const memoryInvites = globalThis.__riverRoomTableInvites ?? new Map<string, MemoryInvite>();
globalThis.__riverRoomTableInvites = memoryInvites;

/** Test-only reset. Both the rows and the sweep throttle are process-global. */
export function __resetTableInvitesMemory(): void {
  memoryInvites.clear();
  globalThis.__riverRoomInviteSweepAt = undefined;
}

// ---- table lookup ----------------------------------------------------------

interface InviteTable {
  smallBlind: number;
  bigBlind: number;
}

/**
 * Stakes for the tables behind a set of invites, keyed by game id.
 *
 * Absent from the map means "not a table anyone can still join" -- finished or
 * reaped -- and the caller drops those invites rather than offering a seat
 * that is not there. table_invites has no FK to games on purpose (the schema
 * comment explains why), so this is the only thing standing between a reaped
 * table and a notification that goes nowhere.
 */
async function loadInviteTables(gameIds: string[]): Promise<Map<string, InviteTable>> {
  const unique = [...new Set(gameIds)];
  if (unique.length === 0) return new Map();

  const supabase = adminClient();
  if (!supabase) {
    const states = await Promise.all(unique.map((id) => getStoredGame(id)));
    return new Map(
      states.flatMap((state) =>
        state && state.status === "playing"
          ? [[state.id, { smallBlind: state.smallBlind, bigBlind: state.bigBlind }] as const]
          : [],
      ),
    );
  }

  // The `games` row, not the state blob: this needs three scalars per table
  // and game_state_private holds the whole hand.
  const { data, error } = await supabase
    .from("games")
    .select("id, small_blind, big_blind")
    .in("id", unique)
    .eq("status", "playing");
  if (error) throw new Error(`Could not load the invited tables: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [
      String(row.id),
      { smallBlind: Number(row.small_blind), bigBlind: Number(row.big_blind) },
    ]),
  );
}

// ---- expiry ----------------------------------------------------------------

/**
 * Settles every pending invite whose window has closed.
 *
 * Exported so a cron route can call it directly, and returns the count so that
 * route has something to log. Nothing depends on it having run: this exists so
 * the table does not accumulate rows that are pending forever and so
 * `table_invites_one_pending_per_target` stops blocking a re-invite the moment
 * the old one lapses -- that index is partial on `status = 'pending'`, so a
 * timed-out row that is still *marked* pending would keep holding the slot.
 */
export async function expireStaleTableInvites(now: Date = new Date()): Promise<number> {
  const stamp = now.toISOString();
  const supabase = adminClient();

  if (!supabase) {
    let swept = 0;
    for (const invite of memoryInvites.values()) {
      if (invite.status !== "pending" || invite.expiresAt > stamp) continue;
      invite.status = "expired";
      invite.respondedAt = stamp;
      swept += 1;
    }
    return swept;
  }

  const { data, error } = await supabase
    .from("table_invites")
    .update({ status: "expired", responded_at: stamp })
    .eq("status", "pending")
    .lte("expires_at", stamp)
    .select("id");
  if (error) throw new Error(`Could not expire stale invites: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Runs the sweep at most once per SWEEP_INTERVAL_MS in this process, and never
 * lets its failure become the caller's.
 *
 * A poll that returns the right invites but could not tidy the table has still
 * answered the question it was asked. The timestamp is claimed before the
 * await so concurrent polls do not all decide to sweep at once.
 */
async function maybeSweepStaleInvites(): Promise<void> {
  const now = Date.now();
  const last = globalThis.__riverRoomInviteSweepAt ?? 0;
  if (now - last < SWEEP_INTERVAL_MS) return;
  globalThis.__riverRoomInviteSweepAt = now;

  try {
    await expireStaleTableInvites(new Date(now));
  } catch {
    // Housekeeping only; see expireStaleTableInvites' comment.
  }
}

// ---- reading ---------------------------------------------------------------

/**
 * The invites this player could still act on.
 *
 * Freshness is a predicate on the row's own `expires_at`, not a consequence of
 * the sweep having run: a client polling one second after an invite lapses
 * must not see it even if nothing has marked it `expired` yet. The sweep is
 * fired alongside, throttled, for the sake of the table rather than the answer.
 */
export async function getPendingTableInvites(profileId: string): Promise<PendingTableInvite[]> {
  const me = profileId.toLowerCase();
  const nowIso = new Date().toISOString();

  await maybeSweepStaleInvites();

  const supabase = adminClient();
  let rows: { id: string; gameId: string; inviterId: string; createdAt: string; expiresAt: string }[];

  if (!supabase) {
    rows = [...memoryInvites.values()]
      .filter((invite) =>
        invite.inviteeId === me && invite.status === "pending" && invite.expiresAt > nowIso)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, PENDING_INVITE_LIMIT)
      .map((invite) => ({
        id: invite.id,
        gameId: invite.gameId,
        inviterId: invite.inviterId,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
      }));
  } else {
    // room_code is not selected. It lives in this row so the accept route can
    // use it without either party seeing it; a read path that pulls it into
    // memory is one refactor away from serialising it.
    const { data, error } = await supabase
      .from("table_invites")
      .select("id, game_id, inviter_id, created_at, expires_at")
      .eq("invitee_id", me)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(PENDING_INVITE_LIMIT);
    if (error) throw new Error(`Could not load your invites: ${error.message}`);

    rows = (data ?? []).map((row) => ({
      id: String(row.id),
      gameId: String(row.game_id),
      inviterId: String(row.inviter_id),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
    }));
  }

  if (rows.length === 0) return [];

  const inviterIds = [...new Set(rows.map((row) => row.inviterId))];
  const [profiles, tables, blocked] = await Promise.all([
    getPublicProfilesByIds(inviterIds),
    loadInviteTables(rows.map((row) => row.gameId)),
    // Blocking after an invite was sent has to silence it, and the sender is
    // not the one who has to notice. One call per distinct inviter rather than
    // a bulk query: PENDING_INVITE_LIMIT caps this at twenty and reusing the
    // tested predicate beats a second hand-rolled block query.
    Promise.all(inviterIds.map(async (id) => ((await isBlockedEitherWay(me, id)) ? id : null))),
  ]);
  const blockedIds = new Set(blocked.filter((id): id is string => id !== null));

  return rows.flatMap((row) => {
    if (blockedIds.has(row.inviterId)) return [];
    // A vanished inviter or a finished table drops the row rather than
    // rendering a blank name or a dead "Join" button.
    const inviter = profiles.get(row.inviterId);
    const table = tables.get(row.gameId);
    if (!inviter || !table) return [];
    return [{
      id: row.id,
      profileId: row.inviterId,
      displayName: inviter.displayName,
      initials: inviter.initials,
      avatarUrl: inviter.avatarUrl,
      avatarPreset: inviter.avatarPreset,
      accent: inviter.accent,
      gameId: row.gameId,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }];
  });
}

// ---- writing ---------------------------------------------------------------

/**
 * Invites someone to a private table.
 *
 * The checks here are the store's own: the target exists, neither has blocked
 * the other, the table is live and private. Whether the *inviter* has any
 * business inviting to this table -- that they are seated at it -- is the
 * route's to enforce, and that route is the next slice; nothing calls this yet
 * but the tests.
 *
 * Private-only is a schema fact, not a policy choice: `room_code` is not null
 * and a public table's code is null, so there is no such thing as an invite to
 * a public table in this design.
 */
export async function createTableInvite(
  inviterId: string,
  inviteeId: string,
  gameId: string,
): Promise<CreateInviteResult> {
  const inviter = inviterId.toLowerCase();
  const invitee = inviteeId.toLowerCase();
  if (inviter === invitee) return { status: "self" };

  const profiles = await getPublicProfilesByIds([invitee]);
  if (!profiles.has(invitee)) return { status: "unknown_profile" };
  if (await isBlockedEitherWay(inviter, invitee)) return { status: "blocked" };

  const game = await getStoredGame(gameId);
  if (!game || game.status !== "playing") return { status: "table_gone" };
  if (!game.isPrivate || !game.roomCode) return { status: "table_not_private" };

  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = tableInviteExpiry(now);

  const supabase = adminClient();
  if (!supabase) {
    const live = [...memoryInvites.values()].some((invite) =>
      invite.status === "pending"
      && invite.expiresAt > createdAt
      && invite.gameId === gameId
      && invite.inviterId === inviter
      && invite.inviteeId === invitee);
    if (live) return { status: "already_pending" };

    const id = randomUUID();
    memoryInvites.set(id, {
      id,
      gameId,
      inviterId: inviter,
      inviteeId: invitee,
      roomCode: game.roomCode,
      status: "pending",
      createdAt,
      expiresAt,
      respondedAt: null,
    });
    return { status: "sent", inviteId: id, expiresAt };
  }

  // A lapsed row still marked pending would hold the partial unique index's
  // slot and turn a legitimate re-invite into `already_pending`, so clear the
  // stale ones first. Unconditional rather than throttled: this is the one
  // path whose correctness depends on the sweep having run.
  await expireStaleTableInvites(now);

  const { data, error } = await supabase
    .from("table_invites")
    .insert({
      game_id: gameId,
      inviter_id: inviter,
      invitee_id: invitee,
      room_code: game.roomCode,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    // table_invites_one_pending_per_target. Checking first and inserting
    // second is a race; the index is what actually decides.
    if (error.code === UNIQUE_VIOLATION) return { status: "already_pending" };
    throw new Error(`Could not send that invite: ${error.message}`);
  }
  return { status: "sent", inviteId: String(data.id), expiresAt };
}

/**
 * The table a live invite points at, without settling it.
 *
 * Exists so the accept route can tell a player "that table filled up" or "you
 * need more Gold" *before* it consumes their one-shot invite -- see the
 * ordering note on that route. Returns the game id only: `room_code` is not
 * selected here for the same reason getPendingTableInvites does not select it,
 * and a caller that wants to redeem the invite has respondToTableInvite.
 *
 * This is a peek, never a guard. Whatever it reports is re-decided under the
 * status predicate in respondToTableInvite, which is the only thing standing
 * between two tabs and two buy-ins.
 */
export async function findPendingTableInvite(
  profileId: string,
  inviteId: string,
): Promise<{ gameId: string; expiresAt: string } | null> {
  const me = profileId.toLowerCase();
  const nowIso = new Date().toISOString();

  const supabase = adminClient();
  if (!supabase) {
    const invite = memoryInvites.get(inviteId);
    if (
      !invite
      || invite.status !== "pending"
      || invite.inviteeId !== me
      || invite.expiresAt <= nowIso
    ) {
      return null;
    }
    return { gameId: invite.gameId, expiresAt: invite.expiresAt };
  }

  const { data, error } = await supabase
    .from("table_invites")
    .select("game_id, expires_at")
    .eq("id", inviteId)
    .eq("invitee_id", me)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (error) throw new Error(`Could not read that invite: ${error.message}`);
  if (!data) return null;
  return { gameId: String(data.game_id), expiresAt: String(data.expires_at) };
}

/**
 * Settles an invite the caller was sent.
 *
 * The status predicate on the write is what makes accepting exactly-once, and
 * that matters more here than it does for friend requests: the route redeems
 * an accepted invite into a *seat*, which costs a buy-in. A double-tapped
 * Accept, a retried request or two tabs must update one row between them, so
 * the compare-and-set and the read of `room_code` are one statement rather
 * than a check followed by a select. Same shape as blackjack_rounds' version
 * guard, and the same rule applies: a lost race must not pay out -- here,
 * must not seat twice.
 *
 * Expiry is a predicate on the row, not a consequence of the sweep, exactly as
 * in getPendingTableInvites -- accepting one second after the window closes has
 * to fail even when nothing has marked the row `expired` yet.
 */
export async function respondToTableInvite(
  profileId: string,
  inviteId: string,
  action: RespondInviteAction,
): Promise<RespondInviteResult> {
  const me = profileId.toLowerCase();
  const now = new Date();
  const stamp = now.toISOString();
  const settled = action === "accept" ? "accepted" : "declined";

  const supabase = adminClient();
  if (!supabase) {
    const invite = memoryInvites.get(inviteId);
    if (
      !invite
      || invite.status !== "pending"
      || invite.inviteeId !== me
      || invite.expiresAt <= stamp
    ) {
      return { status: "not_found" };
    }
    // Checked before the row is consumed: blocking someone after they invited
    // you has to stop the invite working, and burning it on the way to saying
    // so would leave the inviter unable to re-send once the block lifts.
    if (action === "accept" && (await isBlockedEitherWay(me, invite.inviterId))) {
      return { status: "not_found" };
    }

    invite.status = settled;
    invite.respondedAt = stamp;
    return action === "accept"
      ? { status: "accepted", gameId: invite.gameId, roomCode: invite.roomCode }
      : { status: "declined" };
  }

  if (action === "accept") {
    // One read before the write, for the block only. Everything else the
    // caller could lie about is decided by the predicates on the update.
    const { data: owner, error: ownerError } = await supabase
      .from("table_invites")
      .select("inviter_id")
      .eq("id", inviteId)
      .eq("invitee_id", me)
      .eq("status", "pending")
      .maybeSingle();
    if (ownerError) throw new Error(`Could not read that invite: ${ownerError.message}`);
    if (!owner) return { status: "not_found" };
    if (await isBlockedEitherWay(me, String(owner.inviter_id))) return { status: "not_found" };
  }

  const { data, error } = await supabase
    .from("table_invites")
    .update({ status: settled, responded_at: stamp })
    .eq("id", inviteId)
    .eq("invitee_id", me)
    .eq("status", "pending")
    .gt("expires_at", stamp)
    .select("game_id, room_code");
  if (error) throw new Error(`Could not update that invite: ${error.message}`);

  const row = (data ?? [])[0];
  if (!row) return { status: "not_found" };
  return action === "accept"
    ? { status: "accepted", gameId: String(row.game_id), roomCode: String(row.room_code) }
    : { status: "declined" };
}
