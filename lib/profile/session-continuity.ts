/**
 * The two pieces of per-tab state that make in-app navigation seamless.
 *
 * The arcade, Collection and the leaderboard are their own routes, so tapping
 * "Back to the lobby" **unmounts `PokerApp` entirely** and mounts a fresh one.
 * Every piece of component state and every `useRef` in that tree starts over,
 * and two of them were carrying answers this browser had already earned:
 *
 *  1. **Whether the player is through the entry gate.** `entryComplete` starts
 *     `false`, so the signed-out card painted on every single arrival at `/`
 *     until `GET /api/profile` came back -- a login screen flashed at a player
 *     who had been playing for an hour, once per navigation.
 *  2. **Whether this account has already been greeted.** `linkedAccountIdRef`
 *     is a ref, so the idempotent safety-net `POST /api/auth/link` re-ran on
 *     every mount and re-announced "Welcome back -- your Gold, profile, and
 *     collection are ready." The link itself is harmless and worth keeping;
 *     saying it out loud for the fourth time in a minute is not.
 *
 * Both are answered here from `sessionStorage`, and `sessionStorage` rather
 * than `localStorage` is the load-bearing choice. This is a *continuity* hint,
 * not a preference: it is only ever allowed to claim something that is still
 * true, and its correctness rests on being scoped to exactly one tab's
 * lifetime -- the same lifetime a guest's session cookie has. Persist any of
 * this to `localStorage` and a browser restart, a cleared cookie or an expired
 * session would leave the app asserting an entry that no longer exists, which
 * silently skips the gate and can mint a *new* guest profile over somebody who
 * had chosen an account. The failure mode of being wrong here is losing a
 * player's identity, so the hint expires with the tab.
 *
 * Nothing here is authoritative. The cached profile is overwritten by the real
 * `GET /api/profile` the moment it lands, every render; it exists only so the
 * hub can paint the balance the player was already looking at instead of
 * "Preparing your seat..." for a round trip. If a value is stale for the ~200ms
 * before the fetch resolves, that is the entire cost.
 *
 * Pure, and takes its storage as an argument, for the reason
 * `stored-preference.ts` gives: `vitest.config.ts` collects only `lib/` and
 * `app/`, so logic left inside a component is unreachable by `npm test`.
 * Nothing in this file touches `window` except `browserSessionStorage`.
 */

import type { PlayerProfile } from "@/lib/profile/types";
import type { PreferenceStorage } from "@/lib/profile/stored-preference";

/** The profile this tab last saw, so a remount can paint the hub immediately. */
export const SESSION_PROFILE_KEY = "stackchips:session-profile";

/** The account id this tab has already greeted, so a remount stays quiet. */
export const SESSION_GREETED_KEY = "stackchips:session-greeted";

/**
 * A friend invite code clicked while signed out, waiting for a real account
 * to redeem it against.
 *
 * Same sessionStorage-not-localStorage reasoning as the rest of this file,
 * for the same reason: a code left over from a *previous* tab's session
 * would silently friend whoever happens to sign in next on this browser,
 * which is exactly the identity-confusion failure mode this file exists to
 * avoid. clearSessionContinuity drops it on sign-out for the same reason.
 */
export const PENDING_FRIEND_INVITE_KEY = "stackchips:pending-friend-invite";

/** `window.sessionStorage`, or null wherever it is unavailable or blocked. */
export function browserSessionStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Narrows unknown JSON to a profile, checking only the fields the hub renders
 * before its own fetch lands.
 *
 * Deliberately a shape check and not a cast. The value comes back from storage
 * a build or two after it was written, so a field that has since been renamed
 * arrives as `undefined` and would render "NaN Gold" or crash `toLocaleString`
 * on the home screen. Anything that fails this is discarded and the app falls
 * back to the ordinary "no cached profile" path, which is always correct --
 * just slower by one round trip.
 */
function isCachedProfile(value: unknown): value is PlayerProfile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PlayerProfile>;
  return typeof candidate.id === "string"
    && typeof candidate.displayName === "string"
    && typeof candidate.goldBalance === "number"
    && Number.isFinite(candidate.goldBalance)
    && typeof candidate.isRegistered === "boolean"
    && typeof candidate.equipped === "object"
    && candidate.equipped !== null;
}

/**
 * The profile this tab last saw, or null.
 *
 * Null is the ordinary case -- a first visit, a browser refusing storage, a
 * payload written by an older build -- and never an error: every caller's
 * fallback is the fetch it was going to make anyway.
 */
export function readCachedProfile(storage: PreferenceStorage | null): PlayerProfile | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_PROFILE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCachedProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Records the profile for this tab. A storage that is absent or throwing is not an error. */
export function writeCachedProfile(
  storage: PreferenceStorage | null,
  profile: PlayerProfile | null,
): void {
  if (!storage) return;
  try {
    if (profile === null) storage.removeItem(SESSION_PROFILE_KEY);
    else storage.setItem(SESSION_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Private-mode Safari and a full quota both throw. A continuity hint that
    // fails to persist costs one round trip, which is not worth an exception
    // escaping a click handler.
  } finally {
    emitSessionCacheChange();
  }
}

/*
 * THE `useSyncExternalStore` SIDE
 *
 * The cached profile has to reach the first client render *synchronously* --
 * that is the entire point, since a value delivered by an effect arrives one
 * paint too late and the wrong screen has already flashed. `useStoredPreference`
 * deliberately defers instead, which is right for a mute and wrong here, and
 * `first-run-strip.tsx` records the same reasoning for the same trade.
 *
 * Two things `useSyncExternalStore` requires that a bare `readCachedProfile`
 * cannot give it:
 *
 *  - **A stable snapshot.** `readCachedProfile` parses JSON, so it hands back a
 *    fresh object every call; React compares snapshots by identity and would
 *    re-render forever. `sessionProfileSnapshot` memoizes on the raw *string*,
 *    so the reference only changes when the stored text does.
 *  - **A subscription.** Unlike the first-run flag -- which nothing mutates
 *    once read, so that file can pass a no-op subscribe -- this key is written
 *    on every profile update and cleared on sign-out. Without a notification a
 *    signed-out tab would keep rendering the departed player's balance from a
 *    snapshot React had no reason to re-read.
 */

const sessionCacheListeners = new Set<() => void>();

let memoizedRaw: string | null = null;
let memoizedProfile: PlayerProfile | null = null;

function emitSessionCacheChange(): void {
  for (const listener of sessionCacheListeners) listener();
}

/** Subscribes to writes made through this module. Same-tab only, which is the scope of the hint. */
export function subscribeSessionCache(listener: () => void): () => void {
  sessionCacheListeners.add(listener);
  return () => void sessionCacheListeners.delete(listener);
}

/**
 * The cached profile as a snapshot stable across calls, for `useSyncExternalStore`.
 *
 * Returns the identical object reference until the stored text changes, so
 * React can compare it by identity without re-rendering on every read.
 */
export function sessionProfileSnapshot(storage: PreferenceStorage | null): PlayerProfile | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SESSION_PROFILE_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === memoizedRaw) return memoizedProfile;
  memoizedRaw = raw;
  memoizedProfile = readCachedProfile(storage);
  return memoizedProfile;
}

/** The server has no storage, so it renders the signed-out shape and the client fills it in. */
export function serverProfileSnapshot(): PlayerProfile | null {
  return null;
}

/**
 * Whether this tab still has to greet `accountId`.
 *
 * True for a genuine sign-in (including the reload that follows the Google
 * redirect, since nothing has greeted this account in this tab yet) and for
 * switching to a different account. False for the safety-net re-link that
 * `PokerApp` runs on every mount, which is the repeat the player was seeing.
 *
 * Keyed on the account id rather than a bare boolean so signing out and into a
 * *different* account in the same tab is still announced -- that one is a real
 * identity change and staying silent about it would be the opposite bug.
 */
export function shouldAnnounceAccountLink(
  storage: PreferenceStorage | null,
  accountId: string,
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(SESSION_GREETED_KEY) !== accountId;
  } catch {
    return true;
  }
}

/** Records that `accountId` has been greeted in this tab. */
export function markAccountLinkAnnounced(
  storage: PreferenceStorage | null,
  accountId: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(SESSION_GREETED_KEY, accountId);
  } catch {
    // See writeCachedProfile: at worst the greeting repeats once.
  }
}

/** The pending invite code, or null. Never validated here -- redeeming it is the server's job. */
export function readPendingFriendInvite(storage: PreferenceStorage | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(PENDING_FRIEND_INVITE_KEY);
  } catch {
    return null;
  }
}

/** Records a code to redeem once the tab has a registered profile. */
export function writePendingFriendInvite(storage: PreferenceStorage | null, code: string): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_FRIEND_INVITE_KEY, code);
  } catch {
    // A code that fails to persist just means the drawer's own "enter a
    // code" field is the fallback -- not worth throwing out of a click.
  }
}

/** Clears the pending code once it has been redeemed (or given up on). */
export function clearPendingFriendInvite(storage: PreferenceStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_FRIEND_INVITE_KEY);
  } catch {
    // See writePendingFriendInvite.
  }
}

/**
 * Forgets everything this tab knows, on sign-out.
 *
 * All three keys, together, always. Clearing the greeting but keeping the
 * cached profile would paint the departing player's name and balance over
 * the entry card of whoever signs in next on this tab; keeping a pending
 * invite code would hand it to that next person's account instead of the
 * one who actually clicked the link.
 */
export function clearSessionContinuity(storage: PreferenceStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_PROFILE_KEY);
    storage.removeItem(SESSION_GREETED_KEY);
    storage.removeItem(PENDING_FRIEND_INVITE_KEY);
  } catch {
    // Nothing useful to do; the values expire with the tab regardless.
  } finally {
    emitSessionCacheChange();
  }
}
