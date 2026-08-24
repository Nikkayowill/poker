/**
 * Public VAPID key for Web Push, exposed to the browser so it can call
 * pushManager.subscribe({ applicationServerKey }). See .env.example for
 * generating the pair -- the private half never leaves the server (see
 * lib/server/push-service.ts).
 *
 * Empty until configured, which is what turns the whole feature off:
 * requestPushPermissionAndSubscribe (lib/push/client.ts) checks this before
 * ever prompting, same "no key set, form/feature works unmodified" pattern
 * as TURNSTILE_SITE_KEY.
 */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || undefined;
