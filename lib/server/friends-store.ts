import "server-only";
import { randomUUID } from "crypto";
import type { FriendSummary, FriendsOverview, PendingRequest } from "@/lib/social/types";
import { getPublicProfilesByIds } from "./profile-store";
import { adminClient } from "./supabase-admin";

// Re-exported so existing server callers keep importing these from the store.
// The definitions live in lib/social/types.ts because the drawer needs them
// and this module is server-only; see that file.
export type { FriendSummary, FriendsOverview, PendingRequest };

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
 * friend_requests are how a duplicate pending request is detected -- checking
 * first and inserting second is a race, and the crossed-pair case (A asks B
 * while B asks A) cannot be checked for at all without a lock. Insert, and
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
  /** Keyed `${blockerId}:${blockedId}` -- directional, both directions may exist. */
  blocks: Set<string>;
  requests: Map<string, MemoryRequest>;
  /** Keyed by canonical `${profileA}:${profileB}`. */
  friendships: Map<string, MemoryFriendship>;
}

declare global {
  var __riverRoomFriends: MemoryFriendsDb | undefined;
}

const memoryDb: MemoryFriendsDb = globalThis.__riverRoomFriends ?? {
  blocks: new Set<string>(),
  requests: new Map<string, MemoryRequest>(),
  friendships: new Map<string, MemoryFriendship>(),
};
globalThis.__riverRoomFriends = memoryDb;

/** Test-only reset. The memory mirror is process-global, so suites must clear it. */
export function __resetFriendsMemory(): void {
  memoryDb.blocks.clear();
  memoryDb.requests.clear();
  memoryDb.friendships.clear();
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
export async function getFriendsOverview(profileId: string): Promise<FriendsOverview> {
  const me = profileId.toLowerCase();
  const supabase = adminClient();

  if (!supabase) {
    const friendRows = [...memoryDb.friendships.values()]
      .filter((row) => row.profileA === me || row.profileB === me)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, FRIENDS_PAGE_SIZE)
      .map((row) => ({
        profileId: row.profileA === me ? row.profileB : row.profileA,
        since: row.createdAt,
      }));

    const pending = [...memoryDb.requests.values()]
      .filter((row) => row.status === "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, FRIENDS_PAGE_SIZE);

    const [friends, incoming, outgoing] = await Promise.all([
      hydrate(friendRows),
      hydrate(pending
        .filter((row) => row.addresseeId === me)
        .map((row) => ({ id: row.id, profileId: row.requesterId, createdAt: row.createdAt }))),
      hydrate(pending
        .filter((row) => row.requesterId === me)
        .map((row) => ({ id: row.id, profileId: row.addresseeId, createdAt: row.createdAt }))),
    ]);
    return { friends, incoming, outgoing };
  }

  // "My friends" matches either column, which is the cost of storing a
  // symmetric fact once. Two queries rather than an or(): each one uses its
  // own index (the primary key for profile_a, friendships_profile_b_idx for
  // profile_b), where a single or() would give the planner the choice of
  // neither.
  const [asA, asB, requests] = await Promise.all([
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
    supabase
      .from("friend_requests")
      .select("id, requester_id, addressee_id, created_at")
      .eq("status", "pending")
      .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
      .order("created_at", { ascending: false })
      .limit(FRIENDS_PAGE_SIZE),
  ]);

  for (const result of [asA, asB, requests]) {
    if (result.error) throw new Error(`Could not load your friends: ${result.error.message}`);
  }

  const friendRows = [
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
    // and re-capped -- otherwise a player with many of both gets a list
    // ordered by which column matched rather than by recency.
    .sort((a, b) => b.since.localeCompare(a.since))
    .slice(0, FRIENDS_PAGE_SIZE);

  const pending = (requests.data ?? []).map((row) => ({
    id: String(row.id),
    requesterId: String(row.requester_id),
    addresseeId: String(row.addressee_id),
    createdAt: String(row.created_at),
  }));

  const [friends, incoming, outgoing] = await Promise.all([
    hydrate(friendRows),
    hydrate(pending
      .filter((row) => row.addresseeId === me)
      .map((row) => ({ id: row.id, profileId: row.requesterId, createdAt: row.createdAt }))),
    hydrate(pending
      .filter((row) => row.requesterId === me)
      .map((row) => ({ id: row.id, profileId: row.addresseeId, createdAt: row.createdAt }))),
  ]);
  return { friends, incoming, outgoing };
}

/** Whether either party has blocked the other. Directionless on purpose: a block stops traffic both ways. */
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
  // rate-limits sends far more tightly than reads.
  const profiles = await getPublicProfilesByIds([addressee]);
  if (!profiles.has(addressee)) return { status: "unknown_profile" };

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
    return { status: "sent", requestId: id };
  }

  const { data, error } = await supabase
    .from("friend_requests")
    .insert({ requester_id: requester, addressee_id: addressee, status: "pending" })
    .select("id")
    .single();

  if (error) {
    // Either partial unique index -- same pair, or the crossed-pair one where
    // they asked us first. Both mean "there is already a live request between
    // you two", which is one state to the player.
    if (error.code === UNIQUE_VIOLATION) return { status: "already_pending" };
    throw new Error(`Could not send the friend request: ${error.message}`);
  }
  return { status: "sent", requestId: String(data.id) };
}

/**
 * Settles a pending request.
 *
 * Direction is authorization: only the addressee may accept or decline, only
 * the requester may cancel. A caller who is neither gets `not_found` rather
 * than a distinct error -- whether a request id exists is not theirs to learn.
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
      return { status: "accepted" };
    }

    // The one mutation that is not a single statement; see the RPC's own
    // comment in 20260804140000_accept_friend_request.sql.
    const { data, error } = await supabase.rpc("accept_friend_request", {
      p_request_id: requestId,
      p_addressee_id: me,
    });
    if (error) throw new Error(`Could not accept the friend request: ${error.message}`);
    return data === true ? { status: "accepted" } : { status: "not_found" };
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

/** Lifts a block. Does not restore the friendship it tore down -- that has to be asked for again. */
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
