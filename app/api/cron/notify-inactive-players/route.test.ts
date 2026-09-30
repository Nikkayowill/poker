import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPushToSubscription = vi.fn();
const markPushSubscriptionNotified = vi.fn();
const pushSubscriptionsForInactivePlayers = vi.fn();

vi.mock("@/lib/server/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/server/admin-auth", () => ({ isCronAuthorized: () => true }));
vi.mock("@/lib/server/push-service", () => ({
  sendPushToSubscription: (...args: unknown[]) => sendPushToSubscription(...args),
}));
vi.mock("@/lib/server/push-subscription-store", () => ({
  markPushSubscriptionNotified: (...args: unknown[]) => markPushSubscriptionNotified(...args),
  pushSubscriptionsForInactivePlayers: (...args: unknown[]) => pushSubscriptionsForInactivePlayers(...args),
}));

import { GET } from "./route";

const subscription = { id: "sub-1", profileId: "profile-1", lastNotifiedAt: null };

function run() {
  return GET(new NextRequest("http://localhost/api/cron/notify-inactive-players"));
}

beforeEach(() => {
  sendPushToSubscription.mockReset();
  markPushSubscriptionNotified.mockReset();
  pushSubscriptionsForInactivePlayers.mockReset().mockResolvedValue([subscription]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notify-inactive-players cron", () => {
  it("marks a delivered push as notified", async () => {
    sendPushToSubscription.mockResolvedValue("sent");
    const body = await (await run()).json();
    expect(body).toEqual({ sent: 1, failed: 0, candidates: 1 });
    expect(markPushSubscriptionNotified).toHaveBeenCalledWith("sub-1", expect.any(Date));
  });

  it("leaves a failed push eligible for the next run", async () => {
    sendPushToSubscription.mockResolvedValue("failed");
    const body = await (await run()).json();
    expect(body).toEqual({ sent: 0, failed: 1, candidates: 1 });
    expect(markPushSubscriptionNotified).not.toHaveBeenCalled();
  });

  it("returns 503 and marks nothing when VAPID keys are missing", async () => {
    sendPushToSubscription.mockResolvedValue("not-configured");
    const response = await run();
    expect(response.status).toBe(503);
    expect(markPushSubscriptionNotified).not.toHaveBeenCalled();
  });
});
