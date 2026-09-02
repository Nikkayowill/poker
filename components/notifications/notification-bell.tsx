"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, UserPlus, Trophy, Target, X } from "lucide-react";
import { tapSound, selectSound } from "@/lib/audio/ui-sounds";
import type { NotificationKind, StoredNotification } from "@/lib/notifications/types";
import { useNotifications } from "@/lib/notifications/use-notifications";
import type { FriendsOverview } from "@/lib/social/types";
import { notificationLine } from "./notification-copy";

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  friend_request_received: <UserPlus size={14} aria-hidden="true" />,
  friend_request_accepted: <UserPlus size={14} aria-hidden="true" />,
  achievement_unlocked: <Trophy size={14} aria-hidden="true" />,
  mission_completed: <Target size={14} aria-hidden="true" />,
};

/**
 * What the service worker posts to an already-open tab when a push is
 * tapped, so the inbox opens without a navigation. See public/sw.js: the
 * app is a single route with the table rendered in place, so client.navigate()
 * would reload and yank a player out of the hand they're in.
 */
const OPEN_INBOX_MESSAGE = "stackchips:open-notifications";

/** The same intent for a cold start, where there is no open tab to message and the notification's own URL is all that carries it. */
const OPEN_INBOX_PARAM = "notifications";

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
 * Which incoming friend requests are still open, and who is already a friend.
 *
 * A notification's payload carries the requester, not the friend_requests row
 * id, and the row id is what /api/friends/requests/[id] settles -- so the
 * pending list is what turns "X sent you a friend request" into something
 * answerable. Resolving it live rather than snapshotting the id into the
 * payload also means a request answered somewhere else (the Friends drawer,
 * another device) stops offering its buttons here, and that notifications
 * written before this existed still work.
 */
interface FriendRequestLookup {
  /** Requester profile id -> open friend_requests row id. */
  openRequests: Map<string, string>;
  friendIds: Set<string>;
}

const EMPTY_LOOKUP: FriendRequestLookup = { openRequests: new Map(), friendIds: new Set() };

/** What happened to one friend-request row since the popover opened, so it can stop offering buttons it already spent. */
type RowOutcome = "accepted" | "declined" | "stale";

/**
 * The lobby-header bell: unread badge, opens a popover of recent
 * notifications. Same portal + overlay technique
 * components/table/challenge-seat-control.tsx already uses, rather than the
 * generic Menu component -- Menu's MenuItem shape (link/action/separator)
 * doesn't fit a timestamped read/unread list.
 *
 * A friend-request row answers itself here (Accept/Decline) instead of
 * deep-linking into the Friends drawer, whose open state is owned locally by
 * Lobby and PokerTable rather than anywhere a global component could reach.
 * Everything else in the list is informational. Opening the popover marks
 * everything in it read.
 */
export function NotificationBell({ profileId }: { profileId: string | null | undefined }) {
  const { notifications, unreadCount, markAllRead } = useNotifications(profileId);
  const [open, setOpen] = useState(false);
  const [lookup, setLookup] = useState<FriendRequestLookup | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Stable across renders on purpose: the service-worker message listener
  // below subscribes on it, and an identity that changed with unreadCount
  // would tear that listener down and rebuild it on every poll. Marking read
  // unconditionally is the cost of that, and it is one POST on a path that
  // only runs when a player deliberately opens the inbox.
  const openPanel = useCallback(() => {
    setOpen(true);
    void markAllRead();
  }, [markAllRead]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Tapping a push with the app already running: the service worker focuses
  // this tab and posts the message this listens for.
  useEffect(() => {
    if (!profileId || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === OPEN_INBOX_MESSAGE) openPanel();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [profileId, openPanel]);

  // Tapping a push with no tab open: the notification's URL carries the
  // intent instead. Stripped from the address bar once read so a reload or a
  // shared link doesn't reopen the inbox forever -- which is exactly why the
  // answer is parked in a ref rather than re-read from the URL on every run.
  // The open itself is deferred (opening is a setState, and
  // react-hooks/set-state-in-effect rejects that inline), so a re-run --
  // StrictMode's own double-invoke is enough -- cancels the pending timer,
  // and a second read of a URL this effect already cleaned would find
  // nothing and silently drop the request.
  const deepLinkPending = useRef<boolean | null>(null);
  useEffect(() => {
    if (deepLinkPending.current === null) {
      const params = new URLSearchParams(window.location.search);
      deepLinkPending.current = params.get(OPEN_INBOX_PARAM) === "1";
      if (deepLinkPending.current) {
        params.delete(OPEN_INBOX_PARAM);
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      }
    }
    if (!profileId || !deepLinkPending.current) return;
    const timer = window.setTimeout(() => {
      deepLinkPending.current = false;
      openPanel();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profileId, openPanel]);

  // Only while the popover is open: the header shouldn't carry a second
  // background poll of the friends overview just to keep a badge honest.
  const loadLookup = useCallback(async () => {
    try {
      const response = await fetch("/api/friends", { cache: "no-store" });
      if (!response.ok) return;
      const overview = (await response.json()) as FriendsOverview;
      setLookup({
        openRequests: new Map(overview.incoming.map((row) => [row.profileId.toLowerCase(), row.id])),
        friendIds: new Set(overview.friends.map((row) => row.profileId.toLowerCase())),
      });
    } catch {
      // Silent, same contract as useNotifications' own load: the rows still
      // render, they just don't offer buttons this time round.
    }
  }, []);

  useEffect(() => {
    if (!open || !profileId) return;
    const timer = window.setTimeout(() => void loadLookup(), 0);
    return () => window.clearTimeout(timer);
  }, [open, profileId, loadLookup]);

  const onSettled = useCallback((notificationId: string, outcome: RowOutcome) => {
    setOutcomes((current) => ({ ...current, [notificationId]: outcome }));
    void loadLookup();
  }, [loadLookup]);

  if (!profileId) return null;

  const resolved = lookup ?? EMPTY_LOOKUP;

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
          if (open) close();
          else openPanel();
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
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  lookup={resolved}
                  outcome={outcomes[notification.id] ?? null}
                  onSettled={onSettled}
                />
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function NotificationRow({
  notification,
  lookup,
  outcome,
  onSettled,
}: {
  notification: StoredNotification;
  lookup: FriendRequestLookup;
  outcome: RowOutcome | null;
  onSettled: (notificationId: string, outcome: RowOutcome) => void;
}) {
  const [now] = useState(() => Date.now());
  return (
    <div className={notification.readAt ? "notification-row" : "notification-row is-unread"}>
      <span className="notification-row-icon">{KIND_ICON[notification.kind]}</span>
      <div className="notification-row-body">
        <p>{notificationLine(notification)}</p>
        <small>{relativeTime(notification.createdAt, now)}</small>
        {notification.kind === "friend_request_received" && (
          <FriendRequestActions
            notificationId={notification.id}
            fromProfileId={notification.payload.fromProfileId}
            fromDisplayName={notification.payload.fromDisplayName}
            lookup={lookup}
            outcome={outcome}
            onSettled={onSettled}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Accept/Decline for one friend-request row.
 *
 * Renders nothing at all when there is no open request behind it and nothing
 * to report -- an old row for a request answered long ago is just history,
 * and a stale pair of buttons on it would be worse than none. `stale` is the
 * one status the pending list can't predict: the route answers 404 when the
 * request was settled between the popover opening and the tap.
 */
function FriendRequestActions({
  notificationId,
  fromProfileId,
  fromDisplayName,
  lookup,
  outcome,
  onSettled,
}: {
  notificationId: string;
  fromProfileId: string;
  fromDisplayName: string;
  lookup: FriendRequestLookup;
  outcome: RowOutcome | null;
  onSettled: (notificationId: string, outcome: RowOutcome) => void;
}) {
  const [busy, setBusy] = useState(false);
  const id = fromProfileId.toLowerCase();
  const requestId = lookup.openRequests.get(id) ?? null;

  const respond = async (action: "accept" | "decline") => {
    if (!requestId || busy) return;
    selectSound();
    setBusy(true);
    try {
      const response = await fetch(`/api/friends/requests/${encodeURIComponent(requestId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // 404 is the route's "that request is no longer open" -- someone
      // answered it elsewhere first. Reported as stale rather than as a
      // failure, since nothing actually went wrong.
      onSettled(notificationId, response.ok ? (action === "accept" ? "accepted" : "declined") : "stale");
    } catch {
      setBusy(false);
    }
  };

  if (outcome === "accepted" || (!outcome && !requestId && lookup.friendIds.has(id))) {
    return <p className="notification-row-status">You&rsquo;re now friends.</p>;
  }
  if (outcome === "declined") return <p className="notification-row-status">Request declined.</p>;
  if (outcome === "stale") return <p className="notification-row-status">That request is no longer open.</p>;
  if (!requestId) return null;

  return (
    <div className="notification-row-actions">
      <button
        type="button"
        className="notification-row-accept"
        disabled={busy}
        onClick={() => void respond("accept")}
        aria-label={`Accept ${fromDisplayName}`}
      >
        Accept
      </button>
      <button
        type="button"
        className="notification-row-decline"
        disabled={busy}
        onClick={() => void respond("decline")}
        aria-label={`Decline ${fromDisplayName}`}
      >
        Decline
      </button>
    </div>
  );
}
