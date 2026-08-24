import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetPushSubscriptionsForTest,
  markPushSubscriptionNotified,
  pushSubscriptionsForInactivePlayers,
  pushSubscriptionsForProfile,
  removePushSubscription,
  savePushSubscription,
} from "./push-subscription-store";

const keys = (endpoint: string) => ({ endpoint, p256dh: "p256dh-key", auth: "auth-key" });

beforeEach(() => {
  __resetPushSubscriptionsForTest();
});

describe("push subscriptions (memory mode)", () => {
  it("saves a subscription and lists it back for its profile", async () => {
    const profileId = randomUUID();
    await savePushSubscription(profileId, keys("https://push.example/a"), "TestAgent/1.0");

    const rows = await pushSubscriptionsForProfile(profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe("https://push.example/a");
    expect(rows[0].userAgent).toBe("TestAgent/1.0");
    expect(rows[0].lastNotifiedAt).toBeNull();
  });

  it("upserts on endpoint -- resubscribing the same device updates the row instead of duplicating it", async () => {
    const profileId = randomUUID();
    await savePushSubscription(profileId, keys("https://push.example/a"), "Agent/1");
    await savePushSubscription(profileId, { endpoint: "https://push.example/a", p256dh: "new-key", auth: "new-auth" }, "Agent/2");

    const rows = await pushSubscriptionsForProfile(profileId);
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe("new-key");
    expect(rows[0].userAgent).toBe("Agent/2");
  });

  it("only returns subscriptions for the requested profile", async () => {
    const [alice, bob] = [randomUUID(), randomUUID()];
    await savePushSubscription(alice, keys("https://push.example/alice"), null);
    await savePushSubscription(bob, keys("https://push.example/bob"), null);

    expect(await pushSubscriptionsForProfile(alice)).toHaveLength(1);
    expect(await pushSubscriptionsForProfile(bob)).toHaveLength(1);
  });

  it("removes a subscription by endpoint", async () => {
    const profileId = randomUUID();
    await savePushSubscription(profileId, keys("https://push.example/a"), null);
    await removePushSubscription("https://push.example/a");

    expect(await pushSubscriptionsForProfile(profileId)).toHaveLength(0);
  });

  it("records when a subscription was last notified", async () => {
    const profileId = randomUUID();
    await savePushSubscription(profileId, keys("https://push.example/a"), null);
    const [row] = await pushSubscriptionsForProfile(profileId);

    const when = new Date("2026-08-24T22:00:00.000Z");
    await markPushSubscriptionNotified(row.id, when);

    const [updated] = await pushSubscriptionsForProfile(profileId);
    expect(updated.lastNotifiedAt).toBe(when.toISOString());
  });

  // Memory mode has no profiles table to join on daily-claim status against
  // (see the function's own doc comment), so it returns every subscription
  // unfiltered -- this pins that fallback rather than a real filter, since
  // the real filter only exists on the Supabase branch.
  it("memory mode returns every subscription, unfiltered by daily-claim status", async () => {
    await savePushSubscription(randomUUID(), keys("https://push.example/a"), null);
    await savePushSubscription(randomUUID(), keys("https://push.example/b"), null);

    const candidates = await pushSubscriptionsForInactivePlayers(new Date());
    expect(candidates).toHaveLength(2);
  });
});
