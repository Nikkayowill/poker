import "server-only";
import { randomUUID } from "crypto";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for rewarded-ad grants.
 *
 * A grant is a server-issued ticket: created when a player starts watching,
 * redeemed once when they finish. It exists at all because the alternative --
 * the browser saying "I watched it, pay me" -- has nothing in it the server
 * can check. What the server *can* own is when the offer was issued and
 * whether it has already been paid, and both of those live here.
 *
 * Supabase when configured, an in-process Map otherwise, the same split every
 * other store in this directory uses. The memory branch is not a lesser
 * implementation: `npm test` and a no-env dev server both run on it, so it
 * enforces the same two invariants the table's constraints do -- one pending
 * grant per profile, and a redemption that can only succeed once.
 */

export type RewardedAdGrantStatus = "pending" | "claimed";

export interface RewardedAdGrant {
  id: string;
  profileId: string;
  status: RewardedAdGrantStatus;
  rewardGold: number;
  /** When the server issued it. The elapsed-time rule is measured from here, never from a client timestamp. */
  issuedAt: string;
  claimedAt: string | null;
}

/** Thrown when a profile already has a grant in flight. One ad at a time is the point of it. */
export class PendingRewardedAdGrantExists extends Error {
  constructor() {
    super("You already have an ad in progress.");
    this.name = "PendingRewardedAdGrantExists";
  }
}

declare global {
  var __riverRoomRewardedAdGrants: Map<string, RewardedAdGrant> | undefined;
}

const memoryGrants = globalThis.__riverRoomRewardedAdGrants ?? new Map<string, RewardedAdGrant>();
globalThis.__riverRoomRewardedAdGrants = memoryGrants;

/** Test seam only: the memory branch is process-global, so suites must not leak grants into each other. */
export function __resetRewardedAdGrantsForTest(): void {
  memoryGrants.clear();
}

interface GrantRow {
  id: string;
  profile_id: string;
  status: string;
  reward_gold: number | string;
  issued_at: string;
  claimed_at: string | null;
}

function fromRow(row: GrantRow): RewardedAdGrant {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    status: String(row.status) as RewardedAdGrantStatus,
    rewardGold: Number(row.reward_gold),
    issuedAt: String(row.issued_at),
    claimedAt: row.claimed_at === null ? null : String(row.claimed_at),
  };
}

/**
 * Issues a grant, or refuses because one is already in flight.
 *
 * `issuedAt` is passed in rather than defaulted to the database's now() on
 * purpose: the elapsed-time check is a comparison against Node's clock, and
 * mixing two clocks in one inequality is how a REWARDED_AD_DURATION_MS rule
 * quietly becomes a shorter one on a server whose Postgres is a moment ahead.
 *
 * The one-at-a-time rule is enforced by the partial unique index, caught from
 * the 23505, rather than by a read-then-insert -- two concurrent starts both
 * pass a read-first check, and each grant is worth REWARDED_AD_GOLD.
 */
export async function createRewardedAdGrant(
  profileId: string,
  rewardGold: number,
  issuedAt: string,
): Promise<RewardedAdGrant> {
  const supabase = adminClient();
  if (!supabase) {
    for (const grant of memoryGrants.values()) {
      if (grant.profileId === profileId && grant.status === "pending") {
        throw new PendingRewardedAdGrantExists();
      }
    }
    const grant: RewardedAdGrant = {
      id: randomUUID(),
      profileId,
      status: "pending",
      rewardGold,
      issuedAt,
      claimedAt: null,
    };
    memoryGrants.set(grant.id, grant);
    return grant;
  }

  const { data, error } = await supabase
    .from("rewarded_ad_grants")
    .insert({
      profile_id: profileId,
      status: "pending",
      reward_gold: rewardGold,
      issued_at: issuedAt,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new PendingRewardedAdGrantExists();
    throw new Error(`Could not start the ad: ${error.message}`);
  }
  return fromRow(data as GrantRow);
}

/**
 * The window of issue times a grant may be redeemed in.
 *
 * Both ends, because both are rules: `notBefore` is the expiry (a grant left
 * open all afternoon is not a view), `notAfter` is the wait (issued too
 * recently to have finished). Expressed as a window rather than as two checks
 * so they can travel into the one statement below together -- a rule checked
 * outside the guarded UPDATE is a rule two concurrent callers can both pass.
 */
export interface RedemptionWindow {
  /** Earliest issuedAt still alive: now - REWARDED_AD_GRANT_TTL_MS. */
  notBefore: string;
  /** Latest issuedAt old enough to claim: now - REWARDED_AD_DURATION_MS. */
  notAfter: string;
}

/**
 * Redeems a grant, atomically, or returns null.
 *
 * This is the whole idempotency argument, and it is the same shape as
 * blackjack_rounds' version guard: a single conditional UPDATE whose WHERE
 * clause carries *every* rule -- right owner, still pending, old enough, not
 * yet expired. Only one caller's UPDATE can match, so a double-clicked Claim,
 * a retried request and two open tabs settle exactly once, and no rule can be
 * satisfied by a check that happened a moment before somebody else's write.
 *
 * Null means the update matched nothing. Null must never pay out. Note that
 * null does not distinguish "already claimed" from "too early" from "expired"
 * from "not yours"; the service re-reads to tell the player which, and that
 * re-read is for the message only -- never for the decision.
 */
export async function redeemRewardedAdGrant(
  grantId: string,
  profileId: string,
  window: RedemptionWindow,
  claimedAt: string,
): Promise<RewardedAdGrant | null> {
  const supabase = adminClient();
  if (!supabase) {
    const grant = memoryGrants.get(grantId);
    if (!grant) return null;
    if (grant.profileId !== profileId) return null;
    if (grant.status !== "pending") return null;
    const issued = Date.parse(grant.issuedAt);
    if (issued > Date.parse(window.notAfter)) return null;
    if (issued < Date.parse(window.notBefore)) return null;
    const next: RewardedAdGrant = { ...grant, status: "claimed", claimedAt };
    memoryGrants.set(grantId, next);
    return next;
  }

  const { data, error } = await supabase
    .from("rewarded_ad_grants")
    .update({ status: "claimed", claimed_at: claimedAt })
    .eq("id", grantId)
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .lte("issued_at", window.notAfter)
    .gte("issued_at", window.notBefore)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Could not claim the reward: ${error.message}`);
  if (!data) return null;
  return fromRow(data as GrantRow);
}

/**
 * Puts a redeemed grant back, after a credit that did not land.
 *
 * Best-effort compensation, not a transaction: the redemption above and the
 * wallet credit are two writes and this app has no way to make them one. If
 * this itself fails the player has lost a grant, which costs them a slot in
 * the daily cap and nothing from their balance -- the failure this ordering
 * refuses to allow is the opposite one, paying without a redemption.
 */
export async function releaseRewardedAdGrant(grantId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const grant = memoryGrants.get(grantId);
    if (grant) memoryGrants.set(grantId, { ...grant, status: "pending", claimedAt: null });
    return;
  }
  await supabase
    .from("rewarded_ad_grants")
    .update({ status: "pending", claimed_at: null })
    .eq("id", grantId)
    .eq("status", "claimed");
}

/** The grant currently in flight for a profile, if any. Used to resume, and to word a refusal. */
export async function getPendingRewardedAdGrant(profileId: string): Promise<RewardedAdGrant | null> {
  const supabase = adminClient();
  if (!supabase) {
    for (const grant of memoryGrants.values()) {
      if (grant.profileId === profileId && grant.status === "pending") return grant;
    }
    return null;
  }
  const { data, error } = await supabase
    .from("rewarded_ad_grants")
    .select("*")
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw new Error(`Could not read your ad status: ${error.message}`);
  return data ? fromRow(data as GrantRow) : null;
}

/** Discards a grant the player abandoned, so closing the modal does not block the next offer. */
export async function discardRewardedAdGrant(grantId: string, profileId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const grant = memoryGrants.get(grantId);
    if (grant && grant.profileId === profileId && grant.status === "pending") memoryGrants.delete(grantId);
    return;
  }
  await supabase
    .from("rewarded_ad_grants")
    .delete()
    .eq("id", grantId)
    .eq("profile_id", profileId)
    .eq("status", "pending");
}

/**
 * How many grants this profile has redeemed since `since`.
 *
 * The cap this feeds is the real bound on the faucet, so it counts *claimed*
 * rows rather than issued ones: a grant the player started and abandoned cost
 * the house nothing and should not cost them a slot.
 */
export async function countClaimedRewardedAdGrants(profileId: string, since: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    let count = 0;
    for (const grant of memoryGrants.values()) {
      if (grant.profileId !== profileId) continue;
      if (grant.status !== "claimed" || !grant.claimedAt) continue;
      if (Date.parse(grant.claimedAt) >= Date.parse(since)) count += 1;
    }
    return count;
  }
  const { count, error } = await supabase
    .from("rewarded_ad_grants")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "claimed")
    .gte("claimed_at", since);
  if (error) throw new Error(`Could not read your reward history: ${error.message}`);
  return count ?? 0;
}
