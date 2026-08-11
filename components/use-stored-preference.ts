"use client";

import { useCallback, useEffect, useState } from "react";
import {
  browserPreferenceStorage,
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/profile/stored-preference";

/**
 * A preference that lives in localStorage and drives a module outside React.
 *
 * Three blocks in components/poker-app.tsx were this, written out longhand:
 * sound, menu music and chip animation style. They agreed on a subtle idiom
 * that is easy to get wrong when copying, so it is stated here once.
 *
 * THE DEFERRED SET
 *
 * The stored value is applied to the *module* synchronously and to React state
 * a tick later, via a `setTimeout(..., 0)`. That asymmetry is deliberate. The
 * server renders the default, so setting React state during the first commit
 * would swap the markup underneath a hydration that is still in progress;
 * deferring by a tick puts the change in a later commit where it is an ordinary
 * update. The module-level side effect has no such constraint and must not
 * wait -- muting has to take hold before the first sound can play, not after.
 *
 * `apply` is where `setSoundEnabled` / `setMenuMusicEnabled` hang. It runs for
 * the restored value on mount and for every change afterwards, and it is told
 * which of the two it is -- because some side effects only make sense for a
 * deliberate change. Enabling sound plays a click to confirm it; doing that for
 * the restored value would mean the app greeted every page load with a noise
 * nobody asked for.
 *
 * On a change, `apply` runs inside the state updater and before the write, so a
 * handler can rely on the module being in the new state by the time `apply`
 * returns -- which is what lets the sound preference play its click through the
 * channel it has just unmuted.
 */
export type PreferenceChangeCause = "restore" | "change";

export function useStoredPreference<T>(options: {
  key: string;
  /** A superseded key to migrate from, once. See readStoredPreference. */
  legacyKey?: string;
  /** The value rendered on the server and before the stored one lands. */
  fallback: T;
  parse: (raw: string | null) => T;
  serialize?: (value: T) => string;
  apply?: (value: T, cause: PreferenceChangeCause) => void;
}): [T, (update: T | ((current: T) => T)) => void, boolean] {
  const { key, legacyKey, fallback, parse, serialize, apply } = options;
  const [value, setValue] = useState<T>(fallback);
  /**
   * Has the stored value landed in React state yet?
   *
   * A third tuple member rather than a new options field, so the three
   * existing call sites that destructure `[value, set]` are untouched --
   * array destructuring ignores a trailing element.
   *
   * It exists because THE DEFERRED SET ABOVE IS OBSERVABLE. Between the first
   * commit and the tick that restores the stored value, `value` is the
   * fallback, and a caller cannot tell "the player chose the default" from
   * "the choice has not arrived". For a mute that gap is invisible -- the
   * module was already muted synchronously, and nothing renders differently.
   * For a preference that decides which of two renderers to MOUNT it is a
   * whole subtree built, painted and thrown away: a player who picked the
   * classic table gets the 3D room for a frame first, because
   * DEFAULT_TABLE_RENDERER is `webgl_3d`.
   *
   * True on the server and in the same first commit is exactly wrong, so it
   * starts false; a consumer that does not care simply never reads it.
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const stored = readStoredPreference(browserPreferenceStorage(), { key, legacyKey, parse });
    apply?.(stored, "restore");
    const timer = window.setTimeout(() => {
      setValue(stored);
      setSettled(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // Mount-only by design: this reads the persisted value once, and re-running
    // it would clobber a choice the player has since made in this session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved =
          typeof next === "function" ? (next as (current: T) => T)(current) : next;
        apply?.(resolved, "change");
        writeStoredPreference(
          browserPreferenceStorage(),
          key,
          serialize ? serialize(resolved) : String(resolved),
        );
        return resolved;
      });
    },
    // Same reasoning as above: these are configuration, not reactive inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return [value, update, settled];
}
