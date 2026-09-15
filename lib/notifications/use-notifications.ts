"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { NOTIFICATION_CREATED, notificationChannelName } from "./notification-channel";
import type { StoredNotification } from "./types";
import { browserSupabase } from "@/lib/supabase/browser-client";
import { refreshHub, subscribeHub } from "@/lib/hub/hub-poller";

interface NotificationsState {
  notifications: StoredNotification[];
  unreadCount: number;
  /** Notifications that arrived since this hook mounted, for the toast stack. */
  justArrived: StoredNotification[];
  /** Call once justArrived has been absorbed, so the next arrival starts clean. */
  clearArrived: () => void;
  /** Marks every notification read (fired when the bell popover opens), then re-syncs. */
  markAllRead: () => Promise<void>;
}

interface Snapshot {
  notifications: StoredNotification[];
  unreadCount: number;
}

/** Shared identity on purpose: useSyncExternalStore compares snapshots by reference. */
const EMPTY: Snapshot = { notifications: [], unreadCount: 0 };

interface Feed {
  profileId: string | null | undefined;
  /** One per acquire() -- the feed closes when the last holder lets go. */
  refs: number;
  changed: Set<() => void>;
  arrived: Set<(rows: StoredNotification[]) => void>;
  snapshot: Snapshot;
  stop: () => void;
}

/**
 * One feed for the whole app, not one per component. NotificationBell and
 * poker-app.tsx's toast queue both call this hook, and while each owned a
 * private interval the app fetched the same answer twice a tick.
 *
 * The polling itself now belongs to lib/hub/hub-poller.ts, shared with
 * missions and achievements -- what stays here is the realtime channel (which
 * is per-profile and has no business in a generic poller) and the seen-id
 * bookkeeping the toast stack reads.
 */
let shared: Feed | null = null;

function createFeed(profileId: string | null | undefined): Feed {
  let stopped = false;
  // The first successful load seeds this without announcing anything -- a
  // notification that already existed before the feed opened must not toast,
  // the same rule useAchievements applies to an achievement already unlocked
  // before its first poll.
  let seenIds: Set<string> | null = null;

  const feed: Feed = {
    profileId,
    refs: 0,
    changed: new Set(),
    arrived: new Set(),
    snapshot: EMPTY,
    stop: () => {},
  };

  const unsubscribe = subscribeHub(["notifications"], (payload) => {
    const next = payload.notifications;
    if (!next || stopped) return;

    const fresh = seenIds ? next.notifications.filter((row) => !seenIds!.has(row.id)) : [];
    seenIds = new Set(next.notifications.map((row) => row.id));

    feed.snapshot = { notifications: next.notifications, unreadCount: next.unreadCount };
    for (const listener of [...feed.changed]) listener();
    if (fresh.length > 0) for (const listener of [...feed.arrived]) listener(fresh);
  });

  const supabase = browserSupabase();
  let channel: RealtimeChannel | null = null;
  if (supabase && profileId) {
    channel = supabase
      .channel(notificationChannelName(profileId))
      .on("broadcast", { event: NOTIFICATION_CREATED }, () => {
        // Off-cadence on purpose: the poll is the backstop, this is what makes
        // a friend add or an achievement show up right away.
        if (!document.hidden) void refreshHub(["notifications"]);
      })
      .subscribe();
  }

  feed.stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    if (channel && supabase) void supabase.removeChannel(channel);
  };

  return feed;
}

function acquire(profileId: string | null | undefined): Feed {
  // A different profile is a different feed, so the old one goes even if
  // something is still holding it -- that holder's own effect is about to
  // re-acquire on the new id.
  if (shared && shared.profileId !== profileId) {
    shared.stop();
    shared = null;
  }
  if (!shared) shared = createFeed(profileId);
  shared.refs += 1;
  return shared;
}

function release(feed: Feed): void {
  feed.refs -= 1;
  if (feed.refs > 0) return;
  feed.stop();
  if (shared === feed) shared = null;
}

/**
 * The bell + toast data source. Reads the shared hub poll, and re-fetches
 * immediately on a `notify:<profileId>` broadcast (see notification-channel.ts)
 * so an arrival is not up to a minute late.
 */
export function useNotifications(profileId: string | null | undefined): NotificationsState {
  const [justArrived, setJustArrived] = useState<StoredNotification[]>([]);

  const clearArrived = useCallback(() => setJustArrived([]), []);

  const subscribe = useCallback((onChange: () => void) => {
    const feed = acquire(profileId);
    feed.changed.add(onChange);
    return () => {
      feed.changed.delete(onChange);
      release(feed);
    };
  }, [profileId]);

  // Reads the live feed rather than a captured one so a component mounting
  // between ticks renders the numbers already fetched instead of zeroes.
  const getSnapshot = useCallback(
    () => (shared && shared.profileId === profileId ? shared.snapshot : EMPTY),
    [profileId],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  useEffect(() => {
    const feed = acquire(profileId);
    const onArrived = (rows: StoredNotification[]) => {
      setJustArrived((current) => [...current, ...rows]);
    };
    feed.arrived.add(onArrived);

    return () => {
      feed.arrived.delete(onArrived);
      release(feed);
    };
  }, [profileId]);

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // Best-effort, same as every other write here; the next poll will
      // just show the same unread rows again if this failed silently.
    }
    await refreshHub(["notifications"]);
  }, []);

  return {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    justArrived,
    clearArrived,
    markAllRead,
  };
}
