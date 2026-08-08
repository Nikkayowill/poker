"use client";

/**
 * React's view of the per-tab entry-gate flag (lib/auth/entry-gate.ts).
 *
 * `useSyncExternalStore` rather than the deferred-set idiom
 * use-stored-preference.ts uses, because the two hooks want opposite timing.
 * A preference restoring a beat after mount is invisible; the entry gate
 * restoring a beat after mount *is* the bug -- the sign-in card paints for a
 * frame on every "Back to the lobby" trip out of the arcade. With the flag
 * read as an external store, a client-side remount renders the lobby on its
 * very first pass, and a server render/hydration pass reads the `false`
 * server snapshot, so there is nothing for hydration to mismatch on.
 *
 * The listener set exists because sessionStorage does not notify the tab
 * that wrote it (the `storage` event fires only in *other* tabs, and
 * sessionStorage is per-tab anyway). Every write goes through `setPassed`,
 * which is what keeps the snapshot honest.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  browserEntryGateStorage,
  readEntryGatePassed,
  writeEntryGatePassed,
} from "@/lib/auth/entry-gate";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function readSnapshot(): boolean {
  return readEntryGatePassed(browserEntryGateStorage());
}

function serverSnapshot(): boolean {
  return false;
}

export function useEntryGateFlag(): [boolean, (passed: boolean) => void] {
  const passed = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const setPassed = useCallback((next: boolean) => {
    writeEntryGatePassed(browserEntryGateStorage(), next);
    for (const listener of listeners) listener();
  }, []);
  return [passed, setPassed];
}
