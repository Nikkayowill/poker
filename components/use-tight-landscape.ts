"use client";

/**
 * Whether the viewport is the tight mobile-landscape tier -- a phone on its
 * side, not a tablet or a desktop window that happens to be wide. The table
 * screen re-homes a few elements at this tier (the live feed moves into the
 * header; see .game-header-feed, 05-game-header.css) that have room to sit in
 * their normal spot everywhere else.
 *
 * Built exactly like `useLandscape`/`usePhoneViewport` next door, for the same
 * reason: this differs between the server render and the client, read during
 * render, and `useSyncExternalStore` is what makes that legal.
 *
 * 500px is not a new number: it is the height breakpoint `12-responsive.css`
 * already uses for this tier (--game-header-h drops to 42px there, the
 * 844:390 letterbox stage kicks in). Keep this query string in step with that
 * media query if it ever moves.
 */

import { useSyncExternalStore } from "react";

/** Matches `@media (max-height: 500px) and (orientation: landscape)` in 12-responsive.css. Keep in step. */
const QUERY = "(max-height: 500px) and (orientation: landscape)";

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

export function useTightLandscape(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
