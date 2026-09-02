import "server-only";
import { randomInt, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FriendSummary, FriendsOverview, PendingRequest, RecentOpponent } from "@/lib/social/types";
import { getHeadToHeadRecords, listRecentOpponentIds } from "./head-to-head-store";
import { createNotification } from "./notifications-store";
import { getPublicProfilesByIds } from "./profile-store";
import { adminClient } from "./supabase-admin";

// Re-exported so existing server callers keep importing these from the store.
// The definitions live in lib/social/types.ts because the drawer needs them
// and this module is server-only; see that file.
export type { FriendSummary, FriendsOverview, PendingRequest, RecentOpponent };

/**
 * How many recently-played opponents the drawer offers as one-tap adds.
 *
 * A shortlist, not a history: the point is "the person you just played",
 * not an exhaustive log of everyone you've ever faced.
 */
export const RECENT_OPPONENTS_LIMIT = 8;

/**
 * How many friends and pending requests a single overview returns.
 *
 * The drawer shows a list, not an address book, and every entry costs a
 * profile hydration. A player who somehow exceeds this sees the most recent
 * ones; there is no pagination yet because there is no UI that could ask for
 * a second page.
 */
export const FRIENDS_PAGE_SIZE = 100;

/**
 * Every ordinary outcome of asking to be someone's friend.
 *
 * A union rather than exceptions because none of these are failures: they are
 * all states the drawer draws. Throwing would make "you already asked them"
 * indistinguishable from a database being down at the route layer, and the
 * two want very different responses.
 */
export type SendRequestResult =
  | { status: "sent"; requestId: string }
  | { status: "already_pending" }
  | { status: "already_friends" }
  | { status: "blocked" }
  | { status: "self" }
  | { status: "unknown_profile" };

export type RespondAction = "accept" | "decline" | "cancel";

export type RespondResult =
  | { status: "accepted" }
  | { status: "declined" }
  | { status: "cancelled" }
  /** No pending request with that id belongs to this caller in that direction. */
  | { status: "not_found" };

/**
 * Postgres' unique_violation. The two partial unique indexes on
 * friend_requests are how a duplicate pending request is detected: checking
 * first and inserting second is a race, and the crossed-pair case (A asks B
 * while B asks A) can't be checked for at all without a lock. Insert, and
 * let the index answer.
 */
const UNIQUE_VIOLATION = "23505";

/**
 * Canonical friendship ordering, matching the RPC's least()/greatest().
 *
 * Safe to compute in JS despite the column being uuid: Postgres orders uuids
 * by their 16 bytes, and the lowercase hyphenated text form sorts
 * lexicographically in that same order (hyphens sit at fixed positions and
 * '0'-'9' precede 'a'-'f' in ASCII). Lowercasing first is what makes that
 * true, so it is not optional.
 */
function canonicalPair(x: string, y: string): [string, string] {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
  return a < b ? [a, b] : [b, a];
}

// ---- memory-mode mirror ----------------------------------------------------
//
// Same twin-branch shape as hand-archive-store.ts: a real deployment writes
// through Supabase, and local/dev/test runs against an in-process
// approximation so neither the app nor its tests need a live project.
// globalThis so it survives Next.js dev-mode module reloads.

interface MemoryRequest {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  respondedAt: string | null;
}

interface MemoryFriendship {
  profileA: string;
  profileB: string;
  createdAt: string;
}

interface MemoryFriendsDb {
  /** Keyed `${blockerId}:${blockedId}`, directional; both directions may exist. */
  blocks: Set<string>;
  requests: Map<string, MemoryRequest>;
  /** Keyed by canonical `${profileA}:${profileB}`. */
  friendships: Map<string, MemoryFriendship>;
  /** One reusable invite code per profile: profileId -> code. */
  inviteCodes: Map<string, string>;
}

declare global {
  var __riverRoomFriends: MemoryFriendsDb | undefined;
}

const memoryDb: MemoryFriendsDb = globalThis.__riverRoomFriends ?? {
  blocks: new Set<string>(),
  requests: new Map<string, MemoryRequest>(),
  friendships: new Map<string, MemoryFriendship>(),
  inviteCodes: new Map<string, string>(),
};
globalThis.__riverRoomFriends = memoryDb;

/** Test-only reset. The memory mirror is process-global, so suites must clear it. */
export function __resetFriendsMemory(): void {
  memoryDb.blocks.clear();
  memoryDb.requests.clear();
  memoryDb.friendships.clear();
  memoryDb.inviteCodes.clear();
}

function memoryBlockExists(x: string, y: string): boolean {
  return memoryDb.blocks.has(`${x}:${y}`) || memoryDb.blocks.has(`${y}:${x}`);
}

function memoryPendingBetween(x: string, y: string): MemoryRequest | null {
  for (const request of memoryDb.requests.values()) {
    if (request.status !== "pending") continue;
    const pair = new Set([request.requesterId, request.addresseeId]);
    if (pair.has(x) && pair.has(y)) return request;
  }
  return null;
}

// ---- hydration -------------------------------------------------------------

/**
 * Turns ids into display data in one batch.
 *
 * Rows whose profile has vanished are dropped rather than rendered blank. The
 * FKs cascade on delete, so this should only happen mid-deletion, and a friend
 * row with no name is worse than one fewer row.
 */
async function hydrate<T extends { profileId: string }>(
  rows: T[],
): Promise<(T & Omit<FriendSummary, "profileId" | "since">)[]> {
  if (rows.length === 0) return [];
  const profiles = await getPublicProfilesByIds(rows.map((row) => row.profileId));
  return rows.flatMap((row) => {
    const profile = profiles.get(row.profileId);
    if (!profile) return [];
    return [{
      ...row,
      displayName: profile.displayName,
      initials: profile.initials,
      avatarUrl: profile.avatarUrl,
      avatarPreset: profile.avatarPreset,
      accent: profile.accent,
      // Filled in for the `friends` list only, by getFriendsOverview after
      // this returns; a pending request is not an opponent yet. Set here
      // just to satisfy the shared shape every hydrate() caller returns.
      duelRecord: null,
    }];
  });
}

// ---- reading ---------------------------------------------------------------

/**
 * The caller's friends and both directions of their pending requests.
 *
 * One call rather than three routes: the drawer opens on all of it at once,
 * and three separate fetches would let it render a friend and their still-
 * pending request to you at the same time.
 */
/**
 * Who counts as the caller's friends, as raw rows.
 *
 * Extracted so getFriendsOverview and listFriendIds cannot disagree about
 * it: the two-column match, the cap and the recency order are one rule, and
 * a friends leaderboard that included someone the drawer didn't would be a
 * bug nobody would think to look for here.
 */
async function friendRowsFor(profileId: string): Promise<{ profileId: string; since: string }[]> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();

  if (!supabase) {
    return [...memoryDb.friendships.values()]
      .filter((row) => row.profileA === me || row.profileB === me)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, FRIENDS_PAGE_SIZE)
      .map((row) => ({
        profileId: row.profileA === me ? row.profileB : row.profileA,
        since: row.createdAt,
      }));
  }

  // "My friends" matches either column, which is the cost of storing a
  // symmetric fact once. Two queries rather than an or(): each one uses its
  // own index (the primary key for profile_a, friendships_profile_b_idx for
  // profile_b), where a single or() would give the planner the choice of
  // neither.
  const [asA, asB] = await Promise.all([
    supabase
      .from("friendships")
      .select("profile_b, created_at")
      .eq("profile_a", me)
      .order("created_at", { ascending: false })
      .limit(FRIENDS_PAGE_SIZE),
    supabase
      .from("friendships")
      .select("profile_a, created_at")
      .eq("profile_b", me)
      .order("created_at", { ascending: false })
      .limit(FRIENDS_PAGE_SIZE),
  ]);

  for (const result of [asA, asB]) {
    if (result.error) throw new Error(`Could not load your friends: ${result.error.message}`);
  }

  return [
    ...(asA.data ?? []).map((row) => ({
      profileId: String(row.profile_b),
      since: String(row.created_at),
    })),
    ...(asB.data ?? []).map((row) => ({
      profileId: String(row.profile_a),
      since: String(row.created_at),
    })),
  ]
    // Each side was limited independently, so the merge has to be re-sorted
    // and re-capped, or a player with many of both gets a list ordered by
    // which column matched rather than by recency.
    .sort((a, b) => b.since.localeCompare(a.since))
    .slice(0, FRIENDS_PAGE_SIZE);
}

/** Just the ids, for callers that hydrate profiles themselves (the friends leaderboard). */
export async function listFriendIds(profileId: string): Promise<string[]> {
  return (await friendRowsFor(profileId)).map((row) => row.profileId);
}

/**
 * People worth offering as a one-tap "Add friend": recently played,
 * excluding anyone already a friend, already pending in either direction,
 * or blocked.
 *
 * `known` is everyone the caller already computed for the friends/pending
 * lists, passed in rather than re-derived so this can never disagree with
 * what the drawer is about to render beside it.
 */
async function recentOpponentsFor(profileId: string, known: ReadonlySet<string>): Promise<RecentOpponent[]> {
  // Over-asks past RECENT_OPPONENTS_LIMIT so there is still a full list left
  // after `known` and blocks are filtered out.
  const candidateIds = (await listRecentOpponentIds(profileId, RECENT_OPPONENTS_LIMIT + known.size))
    .filter((id) => !known.has(id));
  if (candidateIds.length === 0) return [];

  const blocked = await blockedCounterparts(profileId);
  const ids = candidateIds.filter((id) => !blocked.has(id)).slice(0, RECENT_OPPONENTS_LIMIT);
  if (ids.length === 0) return [];

  const order = new Map(ids.map((id, index) => [id, index]));
  const [hydrated, records] = await Promise.all([
    hydrate(ids.map((id) => ({ profileId: id }))),
    getHeadToHeadRecords(profileId, ids),
  ]);

  return hydrated
    // hydrate() drops a profile that has since vanished; getHeadToHeadRecords
    // only carries an entry for an opponent with at least one played game,
    // which every id here already has. But a row can settle between the two
    // calls, so this stays a filter rather than a non-null assertion.
    .flatMap((person) => {
      const duelRecord = records.get(person.profileId);
      return duelRecord ? [{ ...person, duelRecord }] : [];
    })
    .sort((a, b) => (order.get(a.profileId) ?? 0) - (order.get(b.profileId) ?? 0));
}

/** Attaches recentOpponents to an already-built overview, computed from the same `known` set the drawer renders. */
async function withRecentOpponents(
  profileId: string,
  overview: Omit<FriendsOverview, "recentOpponents">,
): Promise<FriendsOverview> {
  const known = new Set([
    ...overview.friends.map((person) => person.profileId),
    ...overview.incoming.map((person) => person.profileId),
    ...overview.outgoing.map((person) => person.profileId),
  ]);
  return { ...overview, recentOpponents: await recentOpponentsFor(profileId, known) };
}

export async function getFriendsOverview(profileId: string): Promise<FriendsOverview> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();

  if (!supabase) {
    const friendRows = await friendRowsFor(me);

    const pending = [...memoryDb.requests.values()]
      .filter((row) => row.status === "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, FRIENDS_PAGE_SIZE);

    const [friends, incoming, outgoing, records] = await Promise.all([
      hydrate(friendRows),
      hydrate(pending
        .filter((row) => row.addresseeId === me)
        .map((row) => ({ id: row.id, profileId: row.requesterId, createdAt: row.createdAt }))),
      hydrate(pending
        .filter((row) => row.requesterId === me)
        .map((row) => ({ id: row.id, profileId: row.addresseeId, createdAt: row.createdAt }))),
      getHeadToHeadRecords(me, friendRows.map((row) => row.profileId)),
    ]);
    for (const friend of friends) friend.duelRecord = records.get(friend.profileId) ?? null;
    return withRecentOpponents(me, { friends, incoming, outgoing });
  }

  // Still one round of parallel queries: the drawer opens on all of this
  // at once.
  const [friendRows, requests] = await Promise.all([
    friendRowsFor(me),
    supabase
      .from("friend_requests")
      .select("id, requester_id, addressee_id, created_at")
      .eq("status", "pending")
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
      .order("created_at", { ascending: false })
      .limit(FRIENDS_PAGE_SIZE),
  ]);

  if (requests.error) throw new Error(`Could not load your friends: ${requests.error.message}`);

  const pending = (requests.data ?? []).map((row) => ({
    id: String(row.id),
    requesterId: String(row.requester_id),
    addresseeId: String(row.addressee_id),
    createdAt: String(row.created_at),
  }));

  const [friends, incoming, outgoing, records] = await Promise.all([
    hydrate(friendRows),
    hydrate(pending
      .filter((row) => row.addresseeId === me)
      .map((row) => ({ id: row.id, profileId: row.requesterId, createdAt: row.createdAt }))),
    hydrate(pending
      .filter((row) => row.requesterId === me)
      .map((row) => ({ id: row.id, profileId: row.addresseeId, createdAt: row.createdAt }))),
    getHeadToHeadRecords(me, friendRows.map((row) => row.profileId)),
  ]);
  for (const friend of friends) friend.duelRecord = records.get(friend.profileId) ?? null;
  return withRecentOpponents(me, { friends, incoming, outgoing });
}

/** Whether either party has blocked the other. Directionless: a block stops traffic both ways. */
export async function isBlockedEitherWay(x: string, y: string): Promise<boolean> {
  const [a, b] = [x.toLowerCase(), y.toLowerCase()];
  const supabase = adminClient();
  if (!supabase) return memoryBlockExists(a, b);

  const { data, error } = await supabase
    .from("profile_blocks")
    .select("blocker_id")
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
    .limit(1);
  if (error) throw new Error(`Could not check block status: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Every profile blocked in either direction against `profileId`, as a flat
 * set of the *other* party's id.
 *
 * A batch counterpart to isBlockedEitherWay, for filtering a list (recent
 * opponents) rather than checking one pair: one query instead of one per
 * candidate.
 */
async function blockedCounterparts(profileId: string): Promise<Set<string>> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();
  if (!supabase) {
    const result = new Set<string>();
    for (const key of memoryDb.blocks) {
      const [blocker, blocked] = key.split(":");
      if (blocker === me) result.add(blocked);
      if (blocked === me) result.add(blocker);
    }
    return result;
  }

  const { data, error } = await supabase
    .from("profile_blocks")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${me},blocked_id.eq.${me}`);
  if (error) throw new Error(`Could not check block status: ${error.message}`);
  const result = new Set<string>();
  for (const row of data ?? []) {
    const blocker = String(row.blocker_id);
    const blocked = String(row.blocked_id);
    result.add(blocker === me ? blocked : blocker);
  }
  return result;
}

async function areFriends(x: string, y: string): Promise<boolean> {
  const [a, b] = canonicalPair(x, y);
  const supabase = adminClient();
  if (!supabase) return memoryDb.friendships.has(`${a}:${b}`);

  const { data, error } = await supabase
    .from("friendships")
    .select("profile_a")
    .eq("profile_a", a)
    .eq("profile_b", b)
    .limit(1);
  if (error) throw new Error(`Could not check friendship: ${error.message}`);
  return (data ?? []).length > 0;
}

// ---- writing ---------------------------------------------------------------

/**
 * Asks someone to be friends.
 *
 * The pre-checks here are for good error messages, not for correctness: every
 * one of them can be raced, and the database is what actually decides. A
 * duplicate that slips past them comes back as a unique violation and is
 * reported as `already_pending`, which is the same answer the check would
 * have given.
 */
export async function sendFriendRequest(
  requesterId: string,
  addresseeId: string,
): Promise<SendRequestResult> {
  const requester = requesterId.toLowerCase();
  const addressee = addresseeId.toLowerCase();
  if (requester === addressee) return { status: "self" };

  // Confirms the target exists *and* is the gate on enumeration: an unknown
  // id and a real one differ only in this one lookup, which is why the route
  // rate-limits sends far more tightly than reads. Fetched alongside the
  // requester's own profile so a successful send has the display name it
  // needs for the addressee's notification without a second round trip.
  const profiles = await getPublicProfilesByIds([addressee, requester]);
  if (!profiles.has(addressee)) return { status: "unknown_profile" };
  const requesterName = profiles.get(requester)?.displayName ?? "Someone";

  if (await isBlockedEitherWay(requester, addressee)) return { status: "blocked" };
  if (await areFriends(requester, addressee)) return { status: "already_friends" };

  const supabase = adminClient();
  if (!supabase) {
    if (memoryPendingBetween(requester, addressee)) return { status: "already_pending" };
    const id = randomUUID();
    memoryDb.requests.set(id, {
      id,
      requesterId: requester,
      addresseeId: addressee,
      status: "pending",
      createdAt: new Date().toISOString(),
      respondedAt: null,
    });
    await createNotification(addressee, "friend_request_received", { fromProfileId: requester, fromDisplayName: requesterName });
    return { status: "sent", requestId: id };
  }

  const { data, error } = await supabase
    .from("friend_requests")
    .insert({ requester_id: requester, addressee_id: addressee, status: "pending" })
    .select("id")
    .single();

  if (error) {
    // Either partial unique index: same pair, or the crossed-pair one where
    // they asked us first. Both mean "there is already a live request between
    // you two", which is one state to the player.
    if (error.code === UNIQUE_VIOLATION) return { status: "already_pending" };
    throw new Error(`Could not send the friend request: ${error.message}`);
  }
  await createNotification(addressee, "friend_request_received", { fromProfileId: requester, fromDisplayName: requesterName });
  return { status: "sent", requestId: String(data.id) };
}

/**
 * Settles a pending request.
 *
 * Direction is authorization: only the addressee may accept or decline, only
 * the requester may cancel. A caller who is neither gets `not_found` rather
 * than a distinct error; whether a request id exists is not theirs to learn.
 */
export async function respondToFriendRequest(
  profileId: string,
  requestId: string,
  action: RespondAction,
): Promise<RespondResult> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();

  if (action === "accept") {
    if (!supabase) {
      const request = memoryDb.requests.get(requestId);
      if (!request || request.status !== "pending" || request.addresseeId !== me) {
        return { status: "not_found" };
      }
      if (memoryBlockExists(request.requesterId, me)) {
        request.status = "declined";
        request.respondedAt = new Date().toISOString();
        return { status: "not_found" };
      }
      const now = new Date().toISOString();
      request.status = "accepted";
      request.respondedAt = now;
      const [a, b] = canonicalPair(request.requesterId, me);
      if (!memoryDb.friendships.has(`${a}:${b}`)) {
        memoryDb.friendships.set(`${a}:${b}`, { profileA: a, profileB: b, createdAt: now });
      }
      const myName = (await getPublicProfilesByIds([me])).get(me)?.displayName ?? "Someone";
      await createNotification(request.requesterId, "friend_request_accepted", { fromProfileId: me, fromDisplayName: myName });
      return { status: "accepted" };
    }

    // The one mutation that is not a single statement; see the RPC's own
    // comment in 20260804140000_accept_friend_request.sql.
    const { data, error } = await supabase.rpc("accept_friend_request", {
      p_request_id: requestId,
      p_addressee_id: me,
    });
    if (error) throw new Error(`Could not accept the friend request: ${error.message}`);
    if (data !== true) return { status: "not_found" };

    // The RPC returns only a boolean, so the requester to notify is looked
    // up after the fact rather than threaded through it -- one extra read on
    // the success path only, against a row that has already settled.
    const { data: settledRow } = await supabase
      .from("friend_requests")
      .select("requester_id")
      .eq("id", requestId)
      .maybeSingle();
    if (settledRow) {
      const myName = (await getPublicProfilesByIds([me])).get(me)?.displayName ?? "Someone";
      await createNotification(String(settledRow.requester_id), "friend_request_accepted", { fromProfileId: me, fromDisplayName: myName });
    }
    return { status: "accepted" };
  }

  const settledStatus = action === "decline" ? "declined" : "cancelled";
  // Decline is the addressee's to make; cancel is the requester's.
  const ownerColumn = action === "decline" ? "addressee_id" : "requester_id";

  if (!supabase) {
    const request = memoryDb.requests.get(requestId);
    const owner = action === "decline" ? request?.addresseeId : request?.requesterId;
    if (!request || request.status !== "pending" || owner !== me) return { status: "not_found" };
    request.status = settledStatus;
    request.respondedAt = new Date().toISOString();
    return { status: settledStatus };
  }

  // The status predicate makes this idempotent under concurrency: a second
  // decline updates zero rows and reports not_found rather than overwriting
  // responded_at on an already-settled row.
  const { data, error } = await supabase
    .from("friend_requests")
    .update({ status: settledStatus, responded_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq(ownerColumn, me)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`Could not update the friend request: ${error.message}`);
  return (data ?? []).length > 0 ? { status: settledStatus } : { status: "not_found" };
}

/** Ends a friendship from either side. Returns false when they were not friends. */
export async function removeFriend(profileId: string, otherId: string): Promise<boolean> {
  const [a, b] = canonicalPair(profileId, otherId);
  if (a === b) return false;

  const supabase = adminClient();
  if (!supabase) return memoryDb.friendships.delete(`${a}:${b}`);

  const { data, error } = await supabase
    .from("friendships")
    .delete()
    .eq("profile_a", a)
    .eq("profile_b", b)
    .select("profile_a");
  if (error) throw new Error(`Could not remove the friend: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Blocks someone, and tears down whatever relationship existed.
 *
 * Blocking is the strongest thing this feature does, so it is not just an
 * insert: it drops the friendship and cancels any live request in either
 * direction. Leaving a pending request behind would keep showing the blocked
 * player in the blocker's drawer, which is precisely what blocking is for.
 */
export async function blockProfile(blockerId: string, blockedId: string): Promise<boolean> {
  const blocker = blockerId.toLowerCase();
  const blocked = blockedId.toLowerCase();
  if (blocker === blocked) return false;

  const supabase = adminClient();
  if (!supabase) {
    memoryDb.blocks.add(`${blocker}:${blocked}`);
    const [a, b] = canonicalPair(blocker, blocked);
    memoryDb.friendships.delete(`${a}:${b}`);
    for (const request of memoryDb.requests.values()) {
      if (request.status !== "pending") continue;
      const pair = new Set([request.requesterId, request.addresseeId]);
      if (!pair.has(blocker) || !pair.has(blocked)) continue;
      request.status = "cancelled";
      request.respondedAt = new Date().toISOString();
    }
    return true;
  }

  const { error } = await supabase
    .from("profile_blocks")
    .upsert({ blocker_id: blocker, blocked_id: blocked }, { onConflict: "blocker_id,blocked_id" });
  if (error) throw new Error(`Could not block that player: ${error.message}`);

  // Teardown after the block lands, so a failure here leaves the block in
  // place rather than the other way round. Re-blocking repairs it.
  await removeFriend(blocker, blocked);

  const { error: requestError } = await supabase
    .from("friend_requests")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("status", "pending")
    .or(
      `and(requester_id.eq.${blocker},addressee_id.eq.${blocked}),`
      + `and(requester_id.eq.${blocked},addressee_id.eq.${blocker})`,
    );
  if (requestError) {
    throw new Error(`Could not clear pending requests: ${requestError.message}`);
  }
  return true;
}

/** Lifts a block. Does not restore the friendship it tore down; that has to be asked for again. */
export async function unblockProfile(blockerId: string, blockedId: string): Promise<boolean> {
  const blocker = blockerId.toLowerCase();
  const blocked = blockedId.toLowerCase();

  const supabase = adminClient();
  if (!supabase) return memoryDb.blocks.delete(`${blocker}:${blocked}`);

  const { data, error } = await supabase
    .from("profile_blocks")
    .delete()
    .eq("blocker_id", blocker)
    .eq("blocked_id", blocked)
    .select("blocker_id");
  if (error) throw new Error(`Could not unblock that player: ${error.message}`);
  return (data ?? []).length > 0;
}

// ---- invite codes -----------------------------------------------------
//
// A reusable "add me" code, for the person you just played who is no longer
// at the same table; see the migration's own comment for why this skips the
// request/accept step entirely.

/**
 * The alphabet generateRoomCode() (lib/game/engine.ts) already uses for
 * shareable codes. Excludes 0/O/1/I/L, which get misread aloud or
 * mistyped. Duplicated rather than imported: that module is the poker
 * engine, and pulling it into the social layer for one constant is a worse
 * coupling than repeating six characters here.
 */
const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Longer than a room code (6): this one is handed out repeatedly rather than spent once. */
const INVITE_CODE_LENGTH = 10;

function generateInviteCode(): string {
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

export interface FriendInviteCode {
  code: string;
  createdAt: string;
}

/**
 * Generates and stores a fresh code for `profileId`, retrying on the
 * astronomically unlikely chance it collides with someone else's. Used for
 * both first creation and regeneration: `onConflict: "profile_id"` makes
 * the upsert replace whatever code the caller already had, so there is
 * nothing left for a "does one already exist" branch to do.
 */
async function insertFreshInviteCode(supabase: SupabaseClient, profileId: string): Promise<FriendInviteCode> {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateInviteCode();
    const { data, error } = await supabase
      .from("friend_invite_codes")
      .upsert(
        { profile_id: profileId, code, created_at: new Date().toISOString() },
        { onConflict: "profile_id" },
      )
      .select("code, created_at")
      .single();
    if (!error) return { code: String(data.code), createdAt: String(data.created_at) };
    // profile_id is the upsert's conflict target, so the only constraint
    // left to fail is the code column's own unique index. Try again with
    // a new random code; anything else is a real error.
    if (error.code !== UNIQUE_VIOLATION) {
      throw new Error(`Could not create your invite code: ${error.message}`);
    }
  }
  throw new Error("Could not create your invite code: ran out of attempts.");
}

/** The caller's reusable invite code, creating one on first call. */
export async function getOrCreateFriendInviteCode(profileId: string): Promise<FriendInviteCode> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();

  if (!supabase) {
    let code = memoryDb.inviteCodes.get(me);
    if (!code) {
      code = generateInviteCode();
      memoryDb.inviteCodes.set(me, code);
    }
    return { code, createdAt: new Date().toISOString() };
  }

  const { data, error } = await supabase
    .from("friend_invite_codes")
    .select("code, created_at")
    .eq("profile_id", me)
    .maybeSingle();
  if (error) throw new Error(`Could not load your invite code: ${error.message}`);
  if (data) return { code: String(data.code), createdAt: String(data.created_at) };
  return insertFreshInviteCode(supabase, me);
}

/**
 * Replaces the caller's invite code with a new one. Whoever still has the
 * old one is left holding a dead code; there is no history of retired
 * codes, matching the table's own comment.
 */
export async function regenerateFriendInviteCode(profileId: string): Promise<FriendInviteCode> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();

  if (!supabase) {
    const code = generateInviteCode();
    memoryDb.inviteCodes.set(me, code);
    return { code, createdAt: new Date().toISOString() };
  }

  return insertFreshInviteCode(supabase, me);
}

export type RedeemInviteCodeResult =
  | { status: "friended"; profileId: string }
  | { status: "already_friends"; profileId: string }
  | { status: "blocked" }
  | { status: "self" }
  | { status: "invalid_code" };

/**
 * Turns someone else's invite code into a friendship, directly: no
 * request, no accept step. Possessing the code already means its owner
 * chose to share it, which is the consent an accept step would otherwise be
 * collecting; see the migration's own comment.
 */
export async function redeemFriendInviteCode(
  profileId: string,
  rawCode: string,
): Promise<RedeemInviteCodeResult> {
  const me = profileId.toLowerCase();
  const code = rawCode.trim().toUpperCase();
  const supabase = adminClient();

  if (!supabase) {
    const owner = [...memoryDb.inviteCodes.entries()].find(([, owned]) => owned === code)?.[0];
    if (!owner) return { status: "invalid_code" };
    if (owner === me) return { status: "self" };
    if (memoryBlockExists(me, owner)) return { status: "blocked" };
    const [a, b] = canonicalPair(me, owner);
    if (memoryDb.friendships.has(`${a}:${b}`)) return { status: "already_friends", profileId: owner };
    memoryDb.friendships.set(`${a}:${b}`, { profileA: a, profileB: b, createdAt: new Date().toISOString() });
    const myName = (await getPublicProfilesByIds([me])).get(me)?.displayName ?? "Someone";
    await createNotification(owner, "friend_request_accepted", { fromProfileId: me, fromDisplayName: myName });
    return { status: "friended", profileId: owner };
  }

  const { data: row, error } = await supabase
    .from("friend_invite_codes")
    .select("profile_id")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`Could not look up that code: ${error.message}`);
  if (!row) return { status: "invalid_code" };
  const owner = String(row.profile_id);

  if (owner === me) return { status: "self" };
  if (await isBlockedEitherWay(me, owner)) return { status: "blocked" };
  if (await areFriends(me, owner)) return { status: "already_friends", profileId: owner };

  const [a, b] = canonicalPair(me, owner);
  const { error: insertError } = await supabase.from("friendships").insert({ profile_a: a, profile_b: b });
  // A unique violation here means a race (a second redeem, or a friend
  // request accepted in the gap between the check above and this insert)
  // landed the same pair first. Either way the friendship now exists, which
  // is exactly what this call promises, so it is not reported as a failure.
  if (insertError && insertError.code !== UNIQUE_VIOLATION) {
    throw new Error(`Could not add that friend: ${insertError.message}`);
  }
  const myName = (await getPublicProfilesByIds([me])).get(me)?.displayName ?? "Someone";
  await createNotification(owner, "friend_request_accepted", { fromProfileId: me, fromDisplayName: myName });
  return { status: "friended", profileId: owner };
}
