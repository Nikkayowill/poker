/**
 * The shapes shared between lib/server/notifications-store.ts (server-only)
 * and the client hook/components that read its payload -- kept out of the
 * store itself for the same reason lib/achievements/types.ts and
 * lib/missions/types.ts are split from their own stores: a client component
 * needs the type, not the "server-only" module it would otherwise have to
 * import to get it.
 */

export type NotificationKind =
  | "friend_request_received"
  | "friend_request_accepted"
  | "achievement_unlocked"
  | "mission_completed";

export interface NotificationPayloadMap {
  friend_request_received: { fromProfileId: string; fromDisplayName: string };
  friend_request_accepted: { fromProfileId: string; fromDisplayName: string };
  achievement_unlocked: { code: string; title: string; rewardGold: number; rewardCosmeticId: string | null };
  mission_completed: { code: string; title: string; rewardGold: number };
}

/**
 * A genuine discriminated union (kind narrows payload in a switch), not the
 * generic-with-a-default shape that looks equivalent but isn't: `interface
 * Foo<K = X> { kind: K }` used unparameterized resolves K to the whole union
 * up front, so `payload` becomes a flat union of every kind's payload with
 * no correlation back to `kind` left for the compiler to narrow on. The
 * mapped-then-indexed form below is what actually distributes.
 */
export type StoredNotification = {
  [K in NotificationKind]: {
    id: string;
    kind: K;
    payload: NotificationPayloadMap[K];
    createdAt: string;
    readAt: string | null;
  };
}[NotificationKind];

export interface NotificationsPayload {
  notifications: StoredNotification[];
  unreadCount: number;
}
