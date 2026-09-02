import "server-only";
import { randomUUID } from "crypto";
import type { NotificationKind, NotificationPayloadMap, NotificationsPayload, StoredNotification } from "@/lib/notifications/types";
import { sendPushToProfile } from "./push-service";
import { adminClient } from "./supabase-admin";

/**
 * In-app notifications: a friend request landing or being accepted, an
 * achievement unlocking, a mission completing. Everything a player would
 * otherwise only notice by happening to open the Friends drawer or the
 * achievements/challenges pages -- this is the bell + inbox that surfaces it
 * everywhere, including mid-hand at the table.
 *
 * Same twin-branch shape every store here uses: a real deployment writes
 * through Supabase, memory mode approximates it in-process. globalThis so the
 * map survives Next.js dev-mode module reloads.
 *
 * The wire types (NotificationKind etc.) live in lib/notifications/types.ts,
 * not here -- see that file's own comment for why.
 */

// Re-exported so existing server callers keep importing these from the store,
// the same convention friends-store.ts follows for its own social types.
export type { NotificationKind, NotificationPayloadMap, NotificationsPayload, StoredNotification };

/** How many notifications a single fetch returns. The inbox is a recent list, not a full history. */
const NOTIFICATIONS_PAGE_SIZE = 30;

// ---- memory-mode mirror ----------------------------------------------------

// A wrapper, not an intersection (StoredNotification & { profileId }): a
// discriminated union's kind/payload correlation only survives an update
// that spreads an existing member (see markNotificationRead below), never a
// property-by-property rebuild -- keeping `notification` as one opaque field
// means every read/update here copies it whole instead of reconstructing it.
interface MemoryRow {
  profileId: string;
  notification: StoredNotification;
}

declare global {
  var __riverRoomNotifications: Map<string, MemoryRow> | undefined;
}

const memoryNotifications = globalThis.__riverRoomNotifications ?? new Map<string, MemoryRow>();
globalThis.__riverRoomNotifications = memoryNotifications;

/** Test-only reset. The memory mirror is process-global, so suites must clear it. */
export function __resetNotificationsMemory(): void {
  memoryNotifications.clear();
}

// ---- push copy --------------------------------------------------------

/**
 * Where a tapped push lands.
 *
 * The lobby with the inbox already open, not the lobby in general: a push is
 * only worth tapping if it reaches the thing it was about, and for a friend
 * request that thing is the row with the Accept button on it.
 * NotificationBell reads this param once on mount and then strips it. It is
 * the cold-start path only -- with a tab already open the service worker
 * messages it instead of navigating, see public/sw.js.
 */
const INBOX_URL = "/?notifications=1";

/** One line of push copy per kind, or null for a kind that shouldn't push (none today, but keeps the door open). */
function pushPayloadFor<K extends NotificationKind>(
  kind: K,
  payload: NotificationPayloadMap[K],
): { title: string; body: string; url: string } | null {
  switch (kind) {
    case "friend_request_received": {
      const p = payload as NotificationPayloadMap["friend_request_received"];
      return { title: "New friend request", body: `${p.fromDisplayName} wants to be friends.`, url: INBOX_URL };
    }
    case "friend_request_accepted": {
      const p = payload as NotificationPayloadMap["friend_request_accepted"];
      return { title: "Friend added", body: `${p.fromDisplayName} is now your friend.`, url: INBOX_URL };
    }
    case "achievement_unlocked": {
      const p = payload as NotificationPayloadMap["achievement_unlocked"];
      return { title: "Achievement unlocked", body: `${p.title} (+${p.rewardGold.toLocaleString()} Gold)`, url: INBOX_URL };
    }
    case "mission_completed": {
      const p = payload as NotificationPayloadMap["mission_completed"];
      return { title: "Mission complete", body: `${p.title} (+${p.rewardGold.toLocaleString()} Gold)`, url: INBOX_URL };
    }
    default:
      return null;
  }
}

// ---- writes -------------------------------------------------------------

/**
 * Records a notification and fires its push, in one call so every caller
 * below is a single `await createNotification(...)` with nothing else to
 * remember -- the same "one funnel" shape achievement-store.ts and
 * mission-store.ts keep for their own RPCs.
 *
 * Never throws: a notification is best-effort, the same contract
 * applyAchievementEvent/applyMissionEvent keep. Whatever just happened (a
 * friend request sent, an achievement granted) has already succeeded by the
 * time this is called, and a notification bug must not turn that into a
 * failed request.
 */
export async function createNotification<K extends NotificationKind>(
  profileId: string,
  kind: K,
  payload: NotificationPayloadMap[K],
  now: Date = new Date(),
): Promise<void> {
  try {
    const supabase = adminClient();
    if (!supabase) {
      const id = randomUUID();
      // The cast is safe, not a type-hole: kind and payload are correlated by
      // createNotification's own generic <K>, which is exactly what
      // StoredNotification's distributed union requires -- TS just can't see
      // through a generic parameter to confirm that itself.
      const notification = { id, kind, payload, createdAt: now.toISOString(), readAt: null } as StoredNotification;
      memoryNotifications.set(id, { profileId, notification });
    } else {
      const { error } = await supabase
        .from("notifications")
        .insert({ profile_id: profileId, kind, payload });
      if (error) throw new Error(`Could not create notification: ${error.message}`);
    }

    const push = pushPayloadFor(kind, payload);
    if (push) await sendPushToProfile(profileId, push);
  } catch (error) {
    console.error("notifications.create_failed", { profileId, kind, error });
  }
}

// ---- reads ----------------------------------------------------------------

export async function listNotifications(profileId: string): Promise<NotificationsPayload> {
  const supabase = adminClient();
  if (!supabase) {
    const rows = [...memoryNotifications.values()]
      .filter((row) => row.profileId === profileId)
      .sort((a, b) => b.notification.createdAt.localeCompare(a.notification.createdAt))
      .slice(0, NOTIFICATIONS_PAGE_SIZE);
    return {
      notifications: rows.map((row) => row.notification),
      unreadCount: [...memoryNotifications.values()].filter((row) => row.profileId === profileId && !row.notification.readAt).length,
    };
  }

  const [listResult, unreadResult] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, kind, payload, created_at, read_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATIONS_PAGE_SIZE),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .is("read_at", null),
  ]);
  if (listResult.error) throw new Error(`Could not load your notifications: ${listResult.error.message}`);
  if (unreadResult.error) throw new Error(`Could not load your notifications: ${unreadResult.error.message}`);

  return {
    // The cast is the DB read's equivalent of createNotification's own: kind
    // and payload are correlated by what the app itself wrote, not something
    // a jsonb column lets TS verify on the way back out.
    notifications: (listResult.data ?? []).map((row) => ({
      id: String(row.id),
      kind: row.kind as NotificationKind,
      payload: row.payload as NotificationPayloadMap[NotificationKind],
      createdAt: String(row.created_at),
      readAt: row.read_at ? String(row.read_at) : null,
    } as StoredNotification)),
    unreadCount: unreadResult.count ?? 0,
  };
}

// ---- marking read -----------------------------------------------------

/** Marks one notification read. Returns false when it didn't exist or wasn't this profile's. */
export async function markNotificationRead(profileId: string, id: string): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const row = memoryNotifications.get(id);
    if (!row || row.profileId !== profileId) return false;
    // Spreads the existing member rather than rebuilding kind/payload --
    // this is what keeps the discriminated union correlated without a cast;
    // see MemoryRow's own comment.
    row.notification = { ...row.notification, readAt: row.notification.readAt ?? new Date().toISOString() };
    return true;
  }

  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("profile_id", profileId)
    .is("read_at", null)
    .select("id");
  if (error) throw new Error(`Could not update that notification: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Marks every unread notification for this profile read. */
export async function markAllNotificationsRead(profileId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    const now = new Date().toISOString();
    for (const row of memoryNotifications.values()) {
      if (row.profileId === profileId && !row.notification.readAt) {
        row.notification = { ...row.notification, readAt: now };
      }
    }
    return;
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("read_at", null);
  if (error) throw new Error(`Could not update your notifications: ${error.message}`);
}
