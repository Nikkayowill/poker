"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { NOTIFICATION_CREATED, notificationChannelName } from "./notification-channel";
import type { NotificationsPayload, StoredNotification } from "./types";
import { browserSupabase } from "@/lib/supabase/browser-client";
import { startVisiblePoll } from "@/lib/ui/visible-poll";

/** Same cadence as components/achievements/use-achievements.ts's POLL_MS -- the realtime channel below is what makes this feel instant; the poll is just the backstop. */
const POLL_MS = 15_000;

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

interface Poller {
  profileId: string | null | undefined;
  /** One per acquire() -- the poller stops when the last holder lets go. */
  refs: number;
  changed: Set<() => void>;
  arrived: Set<(rows: StoredNotification[]) => void>;
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  stop: () => void;
}

/**
 * One poller for the whole app, not one per component. NotificationBell and
 * poker-app.tsx's toast queue both call this hook, and while each owned a
 * private interval the app fetched /api/notifications twice a tick for the
 * same answer. The hook's shape is unchanged, so neither caller has to know.
 */
let shared: Poller | null = null;

function createPoller(profileId: string | null | undefined): Poller {
  let stopped = false;
  // The first successful load seeds this without announcing anything -- a
  // notification that already existed before the poller started must not
  // toast, the same rule useAchievements applies to an achievement already
  // unlocked before its first poll.
  let seenIds: Set<string> | null = null;

  const poller: Poller = {
    profileId,
    refs: 0,
    changed: new Set(),
    arrived: new Set(),
    snapshot: EMPTY,
    refresh: async () => {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const next = (await response.json()) as NotificationsPayload;

        const fresh = seenIds ? next.notifications.filter((row) => !seenIds!.has(row.id)) : [];
        seenIds = new Set(next.notifications.map((row) => row.id));

        poller.snapshot = { notifications: next.notifications, unreadCount: next.unreadCount };
        for (const listener of [...poller.changed]) listener();
        if (fresh.length > 0) for (const listener of [...poller.arrived]) listener(fresh);
      } catch {
        // Silent, same contract as useAchievements/useMissions: a readout
        // beside working controls should fail quietly, not show an error banner.
      }
    },
    stop: () => {},
  };

  const stopPoll = startVisiblePoll(() => void poller.refresh(), POLL_MS);

  const supabase = browserSupabase();
  let channel: RealtimeChannel | null = null;
  if (supabase && profileId) {
    channel = supabase
      .channel(notificationChannelName(profileId))
      .on("broadcast", { event: NOTIFICATION_CREATED }, () => {
        if (!document.hidden) void poller.refresh();
      })
      .subscribe();
  }

  poller.stop = () => {
    if (stopped) return;
    stopped = true;
    stopPoll();
    if (channel && supabase) void supabase.removeChannel(channel);
  };

  return poller;
}

function acquire(profileId: string | null | undefined): Poller {
  // A different profile is a different feed, so the old poller goes even if
  // something is still holding it -- that holder's own effect is about to
  // re-acquire on the new id.
  if (shared && shared.profileId !== profileId) {
    shared.stop();
    shared = null;
  }
  if (!shared) shared = createPoller(profileId);
  shared.refs += 1;
  return shared;
}

function release(poller: Poller): void {
  poller.refs -= 1;
  if (poller.refs > 0) return;
  poller.stop();
  if (shared === poller) shared = null;
}

/**
 * The bell + toast data source: polls /api/notifications on the same cadence
 * every other readout here uses, and re-fetches immediately on a
 * `notify:<profileId>` broadcast (see notification-channel.ts) so a friend
 * add or an achievement shows up right away rather than up to 15s later --
 * the same pattern components/pvp/duel-shell.tsx already established for its
 * own per-profile channel.
 */
export function useNotifications(profileId: string | null | undefined): NotificationsState {
  const [justArrived, setJustArrived] = useState<StoredNotification[]>([]);
  // The poller this instance holds, so markAllRead re-syncs the shared feed
  // rather than firing a second fetch of its own.
  const pollerRef = useRef<Poller | null>(null);

  const clearArrived = useCallback(() => setJustArrived([]), []);

  const subscribe = useCallback((onChange: () => void) => {
    const poller = acquire(profileId);
    poller.changed.add(onChange);
    return () => {
      poller.changed.delete(onChange);
      release(poller);
    };
  }, [profileId]);

  // Reads the live poller rather than a captured one so a component mounting
  // between ticks renders the numbers already fetched instead of zeroes.
  const getSnapshot = useCallback(
    () => (shared && shared.profileId === profileId ? shared.snapshot : EMPTY),
    [profileId],
  );

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  useEffect(() => {
    const poller = acquire(profileId);
    pollerRef.current = poller;
    const onArrived = (rows: StoredNotification[]) => {
      setJustArrived((current) => [...current, ...rows]);
    };
    poller.arrived.add(onArrived);

    return () => {
      pollerRef.current = null;
      poller.arrived.delete(onArrived);
      release(poller);
    };
  }, [profileId]);

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // Best-effort, same as every other write here; the next poll will
      // just show the same unread rows again if this failed silently.
    }
    await pollerRef.current?.refresh();
  }, []);

  return {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    justArrived,
    clearArrived,
    markAllRead,
  };
}
