"use client";

/**
 * Whether the viewport is phone-width, i.e. narrow enough that the lobby
 * should be the swipeable three-pane shell instead of the hub grid.
 *
 * Built exactly like `useLandscape` next door, and for the same reason: a
 * value that differs between the server render and the client, read during
 * render. `useSyncExternalStore` is what makes that legal -- React renders the
 * server snapshot through hydration and re-renders once with the real
 * measurement, rather than a mismatch or a set-state-in-effect.
 *
 * 600px is not a new number. It is the breakpoint every other mobile rule in
 * this app already turns on (`--lobby-header-h` drops to 68px there, the hub
 * grid goes two-up there), so the shell and the chrome around it change over
 * at the same width instead of one lagging the other by a few pixels.
 *
 * The desktop hub is the honest server default. 45-mobile-shell.css hides the
 * hub's own children below 600px so a phone never paints the grid in the gap
 * before hydration -- it sees the room and the header, then the shell.
 */

import { useSyncExternalStore } from "react";

/** Matches `@media (max-width: 600px)` in 45-mobile-shell.css. Keep in step. */
const QUERY = "(max-width: 600px)";

function clientSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

function serverSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePhoneViewport(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
