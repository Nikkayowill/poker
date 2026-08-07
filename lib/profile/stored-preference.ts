/**
 * Reading and writing the small client-side preferences -- sound, menu music,
 * chip animation style.
 *
 * This is pure and takes its storage as an argument, which is the whole point:
 * the logic used to live inline in three near-identical `useEffect`s inside
 * components/poker-app.tsx, and `vitest.config.ts` only collects `lib/` and
 * `app/`, so none of it was reachable by `npm test`. That mattered, because one
 * of those blocks encodes a real incident -- see `readStoredPreference` below.
 *
 * The hook that drives React from these lives at
 * components/use-stored-preference.ts. Nothing here touches `window`.
 */

/** The slice of the `Storage` interface a preference needs. */
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The app's boolean convention: on unless the stored value is exactly "false".
 *
 * Stated once rather than spelled `stored !== "false"` at each call site. An
 * absent key, a corrupted value and a value from a newer build all mean "on",
 * which is the right default for a preference whose off state is a mute.
 */
export function parseEnabledFlag(raw: string | null): boolean {
  return raw !== "false";
}

/**
 * Reads a preference, migrating a superseded key exactly once on the way.
 *
 * `legacyKey` exists because of a specific bug worth not repeating. The
 * StackChips rename (f7a7cbb) moved `river-room:sound-enabled` to
 * `stackchips:sound-enabled` without carrying the value over. Combined with the
 * default above -- on unless exactly "false" -- that silently un-muted every
 * player who had muted the app, with nothing on screen to explain it. A rename
 * of a persisted key is a data migration, not a find-and-replace.
 *
 * The migration is write-then-delete under a read of the new key, so it runs at
 * most once per browser: after the first load the new key exists and the legacy
 * branch is never entered again. A player who has neither key is untouched and
 * gets whatever `parse` makes of `null`.
 *
 * `storage` is nullable so a server render, or a browser refusing storage
 * access, is an ordinary case rather than a thrown exception -- both fall
 * through to the parsed default.
 */
export function readStoredPreference<T>(
  storage: PreferenceStorage | null,
  options: { key: string; legacyKey?: string; parse: (raw: string | null) => T },
): T {
  if (!storage) return options.parse(null);

  let stored = storage.getItem(options.key);
  if (stored === null && options.legacyKey) {
    const legacy = storage.getItem(options.legacyKey);
    if (legacy !== null) {
      stored = legacy;
      storage.setItem(options.key, legacy);
      storage.removeItem(options.legacyKey);
    }
  }
  return options.parse(stored);
}

/** Persists a preference. A storage that is absent or throwing is not an error worth surfacing. */
export function writeStoredPreference(
  storage: PreferenceStorage | null,
  key: string,
  value: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Private-mode Safari and a full quota both throw here. A preference that
    // fails to persist is a preference that resets next visit, which is a far
    // smaller problem than an exception escaping a click handler.
  }
}

/** `window.localStorage`, or null wherever it is unavailable or blocked. */
export function browserPreferenceStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
