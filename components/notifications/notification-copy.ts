import type { StoredNotification } from "@/lib/notifications/types";

/**
 * One line of display copy per notification, shared by the toast and the
 * inbox popover so the two can never say something different about the same
 * row.
 */
export function notificationLine(notification: StoredNotification): string {
  switch (notification.kind) {
    case "friend_request_received":
      return `${notification.payload.fromDisplayName} sent you a friend request`;
    case "friend_request_accepted":
      return `${notification.payload.fromDisplayName} is now your friend`;
    case "achievement_unlocked":
      return `Achievement unlocked: ${notification.payload.title} (+${notification.payload.rewardGold.toLocaleString()} Gold)`;
    case "mission_completed":
      return `Mission complete: ${notification.payload.title} (+${notification.payload.rewardGold.toLocaleString()} Gold)`;
  }
}
