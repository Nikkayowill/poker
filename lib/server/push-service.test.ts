import { randomUUID } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

import { __resetPushConfigForTest, sendPushToProfile, sendPushToSubscription } from "./push-service";
import { __resetPushSubscriptionsForTest, pushSubscriptionsForProfile, savePushSubscription } from "./push-subscription-store";

const ORIGINAL_ENV = { ...process.env };
const payload = { title: "StackChips", body: "Come back and play.", url: "/" };

function setVapidEnv() {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
  process.env.VAPID_SUBJECT = "mailto:support@stackchips.app";
}

function clearVapidEnv() {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
}

beforeEach(() => {
  __resetPushSubscriptionsForTest();
  __resetPushConfigForTest();
  sendNotification.mockReset();
  setVapidDetails.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  __resetPushConfigForTest();
});

describe("sendPushToProfile", () => {
  it("does nothing when VAPID keys are unconfigured", async () => {
    clearVapidEnv();
    const profileId = randomUUID();
    await savePushSubscription(profileId, { endpoint: "https://push.example/a", p256dh: "p", auth: "a" }, null);

    await sendPushToProfile(profileId, payload);

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends to every subscribed device once configured", async () => {
    setVapidEnv();
    sendNotification.mockResolvedValue(undefined);
    const profileId = randomUUID();
    await savePushSubscription(profileId, { endpoint: "https://push.example/a", p256dh: "p", auth: "a" }, null);
    await savePushSubscription(profileId, { endpoint: "https://push.example/b", p256dh: "p", auth: "a" }, null);

    await sendPushToProfile(profileId, payload);

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [subscription, body] = sendNotification.mock.calls[0];
    expect(subscription.endpoint).toBeDefined();
    expect(JSON.parse(body)).toEqual(payload);
  });

  it("drops a subscription whose push service reports it gone (410)", async () => {
    setVapidEnv();
    const profileId = randomUUID();
    await savePushSubscription(profileId, { endpoint: "https://push.example/gone", p256dh: "p", auth: "a" }, null);
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));

    await sendPushToProfile(profileId, payload);

    expect(await pushSubscriptionsForProfile(profileId)).toHaveLength(0);
  });

  it("keeps a subscription after a transient failure (not 404/410)", async () => {
    setVapidEnv();
    const profileId = randomUUID();
    await savePushSubscription(profileId, { endpoint: "https://push.example/flaky", p256dh: "p", auth: "a" }, null);
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("network blip"), { statusCode: 500 }));

    await sendPushToProfile(profileId, payload);

    expect(await pushSubscriptionsForProfile(profileId)).toHaveLength(1);
  });
});

describe("sendPushToSubscription", () => {
  it("no-ops when unconfigured, same as sendPushToProfile", async () => {
    clearVapidEnv();
    const profileId = randomUUID();
    await savePushSubscription(profileId, { endpoint: "https://push.example/a", p256dh: "p", auth: "a" }, null);
    const [subscription] = await pushSubscriptionsForProfile(profileId);

    await sendPushToSubscription(subscription, payload);

    expect(sendNotification).not.toHaveBeenCalled();
  });
});
