"use client";

/**
 * Whether this browser can give us a GL context — false on the server, and a
 * constant for the life of the tab on the client.
 *
 * NOT an effect that sets state. That was the first shape, and
 * `react-hooks/set-state-in-effect` correctly rejected it: this is not state
 * synchronising with an external system that changes, it is one value that
 * simply differs between the server render and the client render and then
 * never moves again. `useSyncExternalStore` is precisely the tool for that —
 * it takes a server snapshot and a client snapshot, and a subscribe that
 * never fires because nothing can change.
 *
 * The probe is memoised at module scope because it costs a real canvas and a
 * real context: six seats' worth of components asking independently would
 * create six contexts on a device that may be short of them, which is the
 * exact resource this hook exists to be careful about.
 */

import { useSyncExternalStore } from "react";
import { canRenderWebGL } from "@/lib/scene/table-renderer";

let cached: boolean | null = null;

function clientSnapshot(): boolean {
  if (cached === null) cached = canRenderWebGL();
  return cached;
}

/** The server has no GL context and must not claim one, or hydration mismatches. */
function serverSnapshot(): boolean {
  return false;
}

/** Nothing can change WebGL support mid-session, so this never notifies. */
function subscribe(): () => void {
  return () => {};
}

export function useWebglSupport(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
