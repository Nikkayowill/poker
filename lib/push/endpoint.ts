/**
 * Which Web Push endpoints the server will ever POST to.
 *
 * The endpoint is a URL the browser hands us, and sending a notification is a
 * server-side POST to it. Without this check any player could register an
 * arbitrary URL and make the server hit it on demand. Real subscriptions only
 * ever point at the browser vendors' push services, so anything else is
 * refused on save and skipped on send.
 */

const EXACT_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

const HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

export const MAX_PUSH_ENDPOINT_LENGTH = 1024;
export const MAX_PUSH_KEY_LENGTH = 256;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** p256dh and auth are base64url keys; anything else is not a real subscription. */
export function isValidPushKey(value: string): boolean {
  return value.length > 0 && value.length <= MAX_PUSH_KEY_LENGTH && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}
