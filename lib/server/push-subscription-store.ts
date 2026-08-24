import "server-only";
import { randomUUID } from "crypto";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for Web Push subscriptions -- one row per browser/device a
 * player has granted notification permission on.
 *
 * Same twin-branch shape as every other store here: Supabase when
 * configured, an in-process Map otherwise. `endpoint` is the natural key
 * (see the migration's own comment), so saving is upsert-on-endpoint rather
 * than insert-then-dedupe.
 */

export interface StoredPushSubscription {
  id: string;
  profileId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
  lastNotifiedAt: string | null;
}

/** What the browser's PushSubscription.toJSON() hands back -- the shape POSTed to /api/push/subscribe. */
export interface WebPushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

declare global {
  var __riverRoomPushSubscriptions: Map<string, StoredPushSubscription> | undefined;
}

const memorySubscriptions = globalThis.__riverRoomPushSubscriptions ?? new Map<string, StoredPushSubscription>();
globalThis.__riverRoomPushSubscriptions = memorySubscriptions;

/** Test seam only: the memory branch is process-global. */
export function __resetPushSubscriptionsForTest(): void {
  memorySubscriptions.clear();
}

const SUBSCRIPTION_COLUMNS = "id, profile_id, endpoint, p256dh, auth, user_agent, created_at, last_notified_at";

interface SubscriptionRow {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_notified_at: string | null;
}

function fromRow(row: SubscriptionRow): StoredPushSubscription {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    userAgent: row.user_agent,
    createdAt: String(row.created_at),
    lastNotifiedAt: row.last_notified_at,
  };
}

/** Save (or replace) a device's subscription. Upsert on endpoint -- a re-subscribe on the same device updates the row rather than duplicating it. */
export async function savePushSubscription(
  profileId: string,
  keys: WebPushKeys,
  userAgent: string | null,
): Promise<void> {
  const client = adminClient();
  if (!client) {
    const existing = [...memorySubscriptions.values()].find((row) => row.endpoint === keys.endpoint);
    // One id, reused as both the map key and the row's own id -- computing
    // it twice (once per use) would hand a fresh, mismatched key to the
    // second call, leaving the first call's row stranded under its own key
    // and turning every "resubscribe" into a duplicate instead of an update.
    const id = existing?.id ?? randomUUID();
    memorySubscriptions.set(id, {
      id,
      profileId,
      endpoint: keys.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastNotifiedAt: existing?.lastNotifiedAt ?? null,
    });
    return;
  }
  const { error } = await client
    .from("push_subscriptions")
    .upsert(
      {
        profile_id: profileId,
        endpoint: keys.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent,
      },
      { onConflict: "endpoint" },
    );
  if (error) throw new Error(error.message);
}

/** Drop a subscription by endpoint -- called on unsubscribe, and by the sender when a push service reports the endpoint is gone (410/404). */
export async function removePushSubscription(endpoint: string): Promise<void> {
  const client = adminClient();
  if (!client) {
    const existing = [...memorySubscriptions.entries()].find(([, row]) => row.endpoint === endpoint);
    if (existing) memorySubscriptions.delete(existing[0]);
    return;
  }
  const { error } = await client.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(error.message);
}

/** Every subscription for one profile -- used to fan a single event out to all of a player's devices. */
export async function pushSubscriptionsForProfile(profileId: string): Promise<StoredPushSubscription[]> {
  const client = adminClient();
  if (!client) {
    return [...memorySubscriptions.values()].filter((row) => row.profileId === profileId);
  }
  const { data, error } = await client
    .from("push_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("profile_id", profileId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => fromRow(row as SubscriptionRow));
}

/**
 * Every subscribed, registered profile that has not claimed today's daily
 * Gold yet, joined in one query -- the cron's whole candidate list.
 * "Today" is passed in rather than computed here (the same UTC-midnight
 * boundary isSameUtcDay uses) so the caller's own `now` drives it and a
 * test can pin it. Memory mode has no profiles table to join against here
 * (profile-store.ts's memory map is module-private), so it returns every
 * subscription unfiltered; that's fine, memory mode has no cron runner
 * calling this in practice.
 */
export async function pushSubscriptionsForInactivePlayers(utcDayStart: Date): Promise<StoredPushSubscription[]> {
  const client = adminClient();
  if (!client) return [...memorySubscriptions.values()];
  const { data, error } = await client
    .from("push_subscriptions")
    .select(`${SUBSCRIPTION_COLUMNS}, profiles!inner(user_id, last_daily_claim_at)`)
    .not("profiles.user_id", "is", null)
    .or(`last_daily_claim_at.is.null,last_daily_claim_at.lt.${utcDayStart.toISOString()}`, { foreignTable: "profiles" });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => fromRow(row as SubscriptionRow));
}

/** Marks a subscription notified now -- skips it on a same-day cron re-run. */
export async function markPushSubscriptionNotified(id: string, when: Date): Promise<void> {
  const client = adminClient();
  if (!client) {
    const existing = memorySubscriptions.get(id);
    if (existing) memorySubscriptions.set(id, { ...existing, lastNotifiedAt: when.toISOString() });
    return;
  }
  const { error } = await client
    .from("push_subscriptions")
    .update({ last_notified_at: when.toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
