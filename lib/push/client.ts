"use client";

import { VAPID_PUBLIC_KEY } from "./vapid";

/**
 * Browser-side half of Web Push: ask permission, subscribe through the
 * service worker, hand the subscription to the server.
 *
 * Called once, at account creation (see AccountEntryCard), but written to
 * be safe to call more than once:
 * Notification.requestPermission() is a no-op returning the cached answer
 * the moment a player has already granted or denied it, so wiring this into
 * both "Create account" and "Continue with Google" (which also serves
 * returning players, see account-entry-card.tsx) never double-prompts
 * anyone.
 */

function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/**
 * VAPID keys arrive base64url; PushManager wants a raw Uint8Array backed by
 * a real ArrayBuffer. `Uint8Array.from` types its result as
 * `Uint8Array<ArrayBufferLike>`, which also covers SharedArrayBuffer and so
 * doesn't satisfy applicationServerKey's BufferSource; constructing with a
 * known length first avoids that.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function postSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }),
  }).catch(() => {});
}

/**
 * Asks for notification permission and, if granted, subscribes this device
 * and saves it server-side. Silently does nothing when push isn't
 * configured/supported or permission is denied; there is no error path a
 * caller needs to handle, this is a background nicety, never a blocker on
 * the sign-up flow it's called from.
 */
export async function requestPushPermissionAndSubscribe(): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !isPushSupported()) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing
      ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    await postSubscription(subscription);
  } catch {
    // Permission dialogs can be dismissed, subscribe() can reject (e.g. iOS
    // Safari outside an installed PWA), none of it should surface as an
    // error on the form the player just submitted.
  }
}

/** Reverses the above: unsubscribes this device and tells the server to drop it. Used by the player-menu notification toggle. */
export async function disablePushOnThisDevice(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  } catch {
    // Same reasoning as above: a toggle that can't reach the service
    // worker should look like "off" rather than throw.
  }
}

/** Current permission state, for the player-menu row. "default" means never asked/decided. */
export function pushPermissionState(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Whether this device currently holds a live push subscription.
 *
 * Kept separate from pushPermissionState(): a browser never lets JS
 * revoke Notification.permission once granted, so after
 * disablePushOnThisDevice() unsubscribes, permission still reads "granted"
 * forever; checking the subscription itself is the only way the
 * player-menu toggle can show "off" after the player turns it off.
 */
export async function isSubscribedOnThisDevice(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}
