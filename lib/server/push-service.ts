import "server-only";
import webpush from "web-push";
import {
  pushSubscriptionsForProfile,
  removePushSubscription,
  type StoredPushSubscription,
} from "./push-subscription-store";

/**
 * Sends a Web Push notification through a player's subscribed devices.
 *
 * Configured entirely by env vars, same pattern as Turnstile/Stripe: unset
 * VAPID keys mean push is silently off (subscribing is a no-op client-side
 * too, see lib/push/client.ts), not a thrown error at import time.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Where notificationclick in public/sw.js should send the tap. Relative to the app's origin. */
  url: string;
}

let configured: boolean | undefined;

function ensureConfigured(): boolean {
  if (configured !== undefined) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    configured = false;
    return configured;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return configured;
}

async function sendToSubscription(subscription: StoredPushSubscription, payload: PushPayload): Promise<void> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
  } catch (error) {
    // 404/410 mean the push service has permanently discarded this
    // endpoint (uninstalled PWA, cleared site data, expired subscription) --
    // the one case worth cleaning up proactively rather than leaving a dead
    // row the next send will just fail on again. Any other error (network
    // blip, a misconfigured VAPID key) is left alone; deleting on those
    // would silently unsubscribe a player over a transient failure.
    const statusCode = (error as { statusCode?: number } | null)?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await removePushSubscription(subscription.endpoint).catch(() => {});
    }
  }
}

/** Fans one payload out to every device a profile is subscribed on. Never throws -- a notification is best-effort, not a game action. */
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const subscriptions = await pushSubscriptionsForProfile(profileId).catch(() => []);
  await Promise.all(subscriptions.map((subscription) => sendToSubscription(subscription, payload)));
}

/** Sends directly to an already-fetched subscription (the cron sender's path -- it already has the candidate list and shouldn't re-fetch it per profile). */
export async function sendPushToSubscription(subscription: StoredPushSubscription, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  await sendToSubscription(subscription, payload);
}

/** Test seam only: forces the configured check to re-read env vars. */
export function __resetPushConfigForTest(): void {
  configured = undefined;
}
