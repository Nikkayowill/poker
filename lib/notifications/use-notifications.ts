"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { NOTIFICATION_CREATED, notificationChannelName } from "./notification-channel";
import type { NotificationsPayload, StoredNotification } from "./types";
import { browserSupabase } from "@/lib/supabase/browser-client";

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

/**
 * The bell + toast data source: polls /api/notifications on the same cadence
 * every other readout here uses, and re-fetches immediately on a
 * `notify:<profileId>` broadcast (see notification-channel.ts) so a friend
 * add or an achievement shows up right away rather than up to 15s later --
 * the same pattern components/pvp/duel-shell.tsx already established for its
 * own per-profile channel.
 */
export function useNotifications(profileId: string | null | undefined): NotificationsState {
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [justArrived, setJustArrived] = useState<StoredNotification[]>([]);
  const mounted = useRef(true);
  // Bookkeeping for the arrival diff, not itself something that should render.
  const seenIds = useRef<Set<string> | null>(null);

  const clearArrived = useCallback(() => setJustArrived([]), []);

  // Not state -- called from both the poll/channel effect below and from
  // markAllRead's own re-sync, so it's a stable ref rather than a value that
  // would otherwise need to be a dependency of the effect that defines it.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    mounted.current = true;
    seenIds.current = null;

    const load = async () => {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        if (!response.ok || !mounted.current) return;
        const next = (await response.json()) as NotificationsPayload;

        // The first successful load seeds `seenIds` without toasting anything
        // -- a notification that already existed before this session started
        // must not toast on mount, the same rule useAchievements applies to
        // an achievement already unlocked before its first poll.
        if (seenIds.current) {
          const arrived = next.notifications.filter((row) => !seenIds.current!.has(row.id));
          if (arrived.length > 0) setJustArrived((current) => [...current, ...arrived]);
        }
        seenIds.current = new Set(next.notifications.map((row) => row.id));

        setNotifications(next.notifications);
        setUnreadCount(next.unreadCount);
      } catch {
        // Silent, same contract as useAchievements/useMissions: a readout
        // beside working controls should fail quietly, not show an error banner.
      }
    };
    loadRef.current = load;

    const timer = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), POLL_MS);

    const supabase = browserSupabase();
    let channel: RealtimeChannel | null = null;
    if (supabase && profileId) {
      channel = supabase
        .channel(notificationChannelName(profileId))
        .on("broadcast", { event: NOTIFICATION_CREATED }, () => {
          if (!document.hidden) void load();
        })
        .subscribe();
    }

    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [profileId]);

  const markAllRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      // Best-effort, same as every other write here; the next poll will
      // just show the same unread rows again if this failed silently.
    }
    await loadRef.current();
  }, []);

  return { notifications, unreadCount, justArrived, clearArrived, markAllRead };
}
