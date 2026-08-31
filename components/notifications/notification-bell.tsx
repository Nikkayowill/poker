"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, UserPlus, Trophy, Target, X } from "lucide-react";
import { tapSound } from "@/lib/audio/ui-sounds";
import type { NotificationKind, StoredNotification } from "@/lib/notifications/types";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { notificationLine } from "./notification-copy";

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  friend_request_received: <UserPlus size={14} aria-hidden="true" />,
  friend_request_accepted: <UserPlus size={14} aria-hidden="true" />,
  achievement_unlocked: <Trophy size={14} aria-hidden="true" />,
  mission_completed: <Target size={14} aria-hidden="true" />,
};

/** "3m ago" / "2h ago" / "5d ago", falling back to a plain date past a week. Deliberately local rather than a shared util -- this is the only place in the app formatting a relative timestamp. */
function relativeTime(iso: string, now: number): string {
  const deltaMs = now - new Date(iso).getTime();
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The lobby-header bell: unread badge, opens a read-only popover of recent
 * notifications. Same portal + overlay technique
 * components/table/challenge-seat-control.tsx already uses, rather than the
 * generic Menu component -- Menu's MenuItem shape (link/action/separator)
 * doesn't fit a timestamped read/unread list.
 *
 * Rows are informational only for v1: a friend-request row doesn't deep-link
 * into the Friends drawer's own accept flow, since that drawer's open state
 * is owned locally by Lobby and PokerTable rather than lifted anywhere a
 * global component could reach. Opening the popover marks everything in it
 * read.
 */
export function NotificationBell({ profileId }: { profileId: string | null | undefined }) {
  const { notifications, unreadCount, markAllRead } = useNotifications(profileId);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!profileId) return null;

  return (
    <>
      <button
        type="button"
        className="notification-bell-trigger"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          tapSound();
          const opening = !open;
          setOpen(opening);
          if (opening && unreadCount > 0) void markAllRead();
        }}
      >
        <Bell size={16} aria-hidden="true" />
        {unreadCount > 0 && <span className="notification-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && createPortal(
        <div
          className="notification-bell-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) close();
          }}
        >
          <div
            className="notification-bell-panel"
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Notifications"
          >
            <div className="notification-bell-heading">
              <span>Notifications</span>
              <button
                type="button"
                className="notification-bell-close"
                onClick={() => { tapSound(); close(); }}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="notification-bell-list">
              {notifications.length === 0 && (
                <p className="notification-bell-empty">Nothing yet.</p>
              )}
              {notifications.map((notification) => (
                <NotificationRow key={notification.id} notification={notification} />
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function NotificationRow({ notification }: { notification: StoredNotification }) {
  const [now] = useState(() => Date.now());
  return (
    <div className={notification.readAt ? "notification-row" : "notification-row is-unread"}>
      <span className="notification-row-icon">{KIND_ICON[notification.kind]}</span>
      <div className="notification-row-body">
        <p>{notificationLine(notification)}</p>
        <small>{relativeTime(notification.createdAt, now)}</small>
      </div>
    </div>
  );
}
