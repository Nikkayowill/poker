import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetNotificationsMemory,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications-store";

beforeEach(() => {
  __resetNotificationsMemory();
});

describe("notifications (memory mode)", () => {
  it("lists a created notification, newest first, unread", async () => {
    const profileId = randomUUID();
    await createNotification(profileId, "friend_request_received", { fromProfileId: randomUUID(), fromDisplayName: "Hero" });

    const { notifications, unreadCount } = await listNotifications(profileId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].kind).toBe("friend_request_received");
    expect(notifications[0].readAt).toBeNull();
    expect(unreadCount).toBe(1);
  });

  it("never leaks one profile's notifications into another's list", async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    await createNotification(a, "achievement_unlocked", { code: "hands_played_100", title: "Ante Up", rewardGold: 300, rewardCosmeticId: null });

    expect((await listNotifications(b)).notifications).toEqual([]);
    expect((await listNotifications(a)).notifications).toHaveLength(1);
  });

  it("marks one notification read and drops it from the unread count", async () => {
    const profileId = randomUUID();
    await createNotification(profileId, "mission_completed", { code: "daily_puzzle", title: "Solve a puzzle", rewardGold: 100 });
    const [{ id }] = (await listNotifications(profileId)).notifications;

    const ok = await markNotificationRead(profileId, id);
    expect(ok).toBe(true);

    const { notifications, unreadCount } = await listNotifications(profileId);
    expect(notifications[0].readAt).not.toBeNull();
    expect(unreadCount).toBe(0);
  });

  it("refuses to mark another profile's notification read", async () => {
    const [owner, intruder] = [randomUUID(), randomUUID()];
    await createNotification(owner, "friend_request_accepted", { fromProfileId: randomUUID(), fromDisplayName: "Villain" });
    const [{ id }] = (await listNotifications(owner)).notifications;

    expect(await markNotificationRead(intruder, id)).toBe(false);
    expect((await listNotifications(owner)).unreadCount).toBe(1);
  });

  it("marks every unread notification read at once", async () => {
    const profileId = randomUUID();
    await createNotification(profileId, "achievement_unlocked", { code: "hands_played_100", title: "Ante Up", rewardGold: 300, rewardCosmeticId: null });
    await createNotification(profileId, "mission_completed", { code: "daily_puzzle", title: "Solve a puzzle", rewardGold: 100 });

    await markAllNotificationsRead(profileId);

    const { notifications, unreadCount } = await listNotifications(profileId);
    expect(unreadCount).toBe(0);
    expect(notifications.every((row) => row.readAt !== null)).toBe(true);
  });
});
