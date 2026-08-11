"use client";

import { useSyncExternalStore } from "react";

/**
 * Mirrors a `min-width` media query in JS. Exists for exactly one caller:
 * `06-table.css` floats the 3D room's action bar into the bottom-right
 * corner at `min-width: 901px`, and the local player's own corner HUD has
 * to agree with that same breakpoint pixel-for-pixel to land in the
 * opposite corner -- a CSS-only `display: none` would still leave the seat
 * nameplate layer thinking the player's own plate should stay hidden below
 * that width, since suppressing it is a JS decision (seat-nameplates.tsx
 * drops a seat from the projected list entirely, it doesn't just hide it).
 *
 * `useSyncExternalStore`, not a state+effect pair -- `window.matchMedia` is
 * exactly the external store that hook exists for, and reading it in an
 * effect body would mean calling `setState` synchronously on mount, which
 * `react-hooks/set-state-in-effect` correctly flags (same reasoning
 * `lib/lobby/first-run.ts`'s own doc comment gives for using this hook
 * instead of a deferred-restore one). Server snapshot is `false`, same as
 * this HUD's only-ever-client-rendered contract: it doesn't exist until the
 * WebGL room reports ready, well after hydration.
 */
export function useMinWidth(px: number): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(`(min-width: ${px}px)`).matches : false),
    () => false,
  );
}
