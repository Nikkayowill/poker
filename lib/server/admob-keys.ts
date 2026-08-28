import "server-only";

/**
 * Google's rotating public keys for verifying an AdMob SSV callback's
 * signature. There is no shared secret to store for this (unlike Stripe's
 * webhook signing secret) -- Google publishes the current keys at this URL
 * and rotates them occasionally, identified by key_id.
 *
 * https://developers.google.com/admob/android/rewarded-video-ssv#server-side_verification_steps
 */
const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

// Google documents these as changing infrequently; an hour keeps a normal
// process from refetching on every callback while still picking up a
// rotation same-day.
const CACHE_TTL_MS = 60 * 60 * 1000;

interface AdmobVerifierKey {
  keyId: number;
  pem: string;
}

interface VerifierKeysResponse {
  keys: Array<{ keyId: number; pem: string; base64?: string }>;
}

let cache: { keys: AdmobVerifierKey[]; fetchedAt: number } | null = null;

async function fetchKeys(): Promise<AdmobVerifierKey[]> {
  const response = await fetch(KEYS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not fetch AdMob SSV verification keys: ${response.status}`);
  }
  const data = (await response.json()) as VerifierKeysResponse;
  return data.keys.map((key) => ({ keyId: key.keyId, pem: key.pem }));
}

/**
 * The PEM for one key id, or null if Google has never published it (or no
 * longer does). Refetches once on a cache miss before giving up, so a key
 * that rotated since our last fetch is still found within one retry rather
 * than failing every callback for the rest of the cache window.
 */
export async function admobVerifierKey(keyId: number, now = Date.now()): Promise<string | null> {
  if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
    cache = { keys: await fetchKeys(), fetchedAt: now };
  }
  let found = cache.keys.find((key) => key.keyId === keyId);
  if (!found) {
    cache = { keys: await fetchKeys(), fetchedAt: Date.now() };
    found = cache.keys.find((key) => key.keyId === keyId);
  }
  return found?.pem ?? null;
}

/** Test seam only: forces the next call to refetch rather than serve the cache. */
export function __resetAdmobKeyCacheForTest(): void {
  cache = null;
}
