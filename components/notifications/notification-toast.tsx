"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoredNotification } from "@/lib/notifications/types";
import { notificationLine } from "./notification-copy";

/** Same as components/achievements/achievement-toast.tsx's TOAST_MS. */
const TOAST_MS = 3200;

interface ToastItem {
  key: string;
  notification: StoredNotification;
}

/**
 * The global "something just happened" toast -- a friend request, a friend
 * added, an achievement or mission just unlocked. Mounted unconditionally in
 * poker-app.tsx (not gated on `!game`), which is the whole point: this is
 * what makes an achievement earned mid-hand actually visible, where
 * AchievementToast/MissionToast only fire on their own pages.
 *
 * Structurally a third copy of AchievementToast's own pattern, not shared
 * with it -- same reasoning that file already gives for not reusing
 * share-result-button.tsx: crossing the boundary for one shared idiom isn't
 * worth it for a handful of call sites.
 */
export function NotificationToast({
  queue,
  onQueued,
}: {
  queue: StoredNotification[];
  /** Called once `queue` has been absorbed, so the caller can clear its source. */
  onQueued: () => void;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    if (queue.length === 0) return;
    const timer = window.setTimeout(() => {
      setItems((current) => [
        ...current,
        ...queue.map((notification) => ({ key: notification.id, notification })),
      ]);
      onQueued();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queue, onQueued]);

  const removeItem = useCallback((key: string) => {
    setItems((current) => current.filter((existing) => existing.key !== key));
  }, []);

  return (
    <div className="notification-toast-stack" role="status" aria-live="polite">
      {items.map((item) => (
        <ToastLine key={item.key} itemKey={item.key} notification={item.notification} onDone={removeItem} />
      ))}
    </div>
  );
}

function ToastLine({
  itemKey,
  notification,
  onDone,
}: {
  itemKey: string;
  notification: StoredNotification;
  onDone: (key: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(itemKey), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [itemKey, onDone]);

  return <p className="notification-toast">{notificationLine(notification)}</p>;
}
