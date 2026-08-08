/**
 * The per-tab record of having passed the account entry gate.
 *
 * `entryComplete` in components/poker-app.tsx is plain component state, and
 * the arcade lives on its own routes (`/games/*`) -- so "Back to the lobby"
 * remounts PokerApp and, before this existed, every return trip opened on the
 * sign-in card spinning "Checking your player session…" until GET /api/profile
 * came back. The session cookie already proves the player entered; this flag
 * only lets the client *believe* that a network round trip sooner, so the
 * lobby renders immediately and the profile fetch fills it in.
 *
 * Two scoping decisions are deliberate:
 *
 * - `sessionStorage`, never `localStorage`. The tightest session this app
 *   mints is a guest who declined "Stay signed in", whose cookie dies with
 *   the browser. A per-tab flag is strictly narrower than every cookie scope,
 *   so the optimistic lobby can only ever be shown where a cookie plausibly
 *   still exists. A localStorage flag would outlive the cookie and greet a
 *   signed-out browser with the lobby before bouncing it back to the gate --
 *   the exact flash this exists to remove, in the other direction.
 *
 * - The flag is a hint, not an authority. poker-app.tsx reconciles it against
 *   what GET /api/profile actually returns and reverts to the gate (clearing
 *   the flag) if no profile comes back, so a cookie cleared out from under a
 *   live tab cannot leave it stranded in an empty lobby -- and, more
 *   important, cannot let the first-visit profile-minting effect fire for a
 *   player who never chose an entry path this session.
 *
 * Pure and storage-injected for the same reason as stored-preference.ts:
 * vitest collects only `lib/` and `app/`, so logic living in poker-app.tsx is
 * unreachable by `npm test`. The React half -- a useSyncExternalStore hook,
 * chosen so the restore happens on a remount's *first render* rather than a
 * paint later -- is components/use-entry-gate.ts.
 */

import type { PreferenceStorage } from "@/lib/profile/stored-preference";

export const ENTRY_GATE_STORAGE_KEY = "stackchips:entry-complete";

/**
 * True only for an exact stored "true": absent, corrupted, or foreign values
 * all mean "show the gate", which is the safe default -- the gate can always
 * hand a returning player straight through, the lobby cannot un-show itself.
 * Note this is the opposite polarity from parseEnabledFlag on purpose.
 */
export function readEntryGatePassed(storage: PreferenceStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ENTRY_GATE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeEntryGatePassed(storage: PreferenceStorage | null, passed: boolean): void {
  if (!storage) return;
  try {
    if (passed) storage.setItem(ENTRY_GATE_STORAGE_KEY, "true");
    else storage.removeItem(ENTRY_GATE_STORAGE_KEY);
  } catch {
    // Private-mode Safari and a full quota both throw. A flag that fails to
    // persist just means the next remount shows the gate for one fetch, which
    // is the pre-existing behaviour, not an error worth surfacing.
  }
}

/** `window.sessionStorage`, or null wherever it is unavailable or blocked. */
export function browserEntryGateStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
