"use client";

/**
 * Whether the viewport is currently wider than it is tall.
 *
 * Built the same way as `useWebglSupport` and for most of the same reasons --
 * a value that differs between the server render and the client, read during
 * render, where an effect that sets state would be both a wasted commit and a
 * `react-hooks/set-state-in-effect` violation. The difference is that this one
 * genuinely changes: `subscribe` is a real subscription to the orientation
 * media query rather than the no-op the WebGL probe uses.
 *
 * `(orientation: landscape)` rather than a `width > height` comparison against
 * `innerWidth`/`innerHeight`. They agree, but the media query is what the
 * browser itself recomputes on a rotation, so it cannot be caught mid-rotation
 * reporting one axis from before the turn and one from after -- which is a
 * real hazard on iOS, where `orientationchange` fires before the viewport has
 * finished resizing.
 *
 * WHAT USES IT: the 2.5D racetrack table is landscape-only. Its table is 2:1
 * and in a portrait frame the felt collapses to a ~58px sliver with the
 * opponents' nameplates on the cloth, so PokerTable shows an orientation gate
 * instead of mounting a different renderer. Rotating back restores it on the
 * spot, because this is a subscription and not a snapshot taken once at mount.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(orientation: landscape)";

function clientSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * The server has no viewport. Landscape is the honest default: it is what
 * every desktop is, and the one consumer that could flicker on a wrong guess
 * -- the table -- is held behind `tableRendererSettled` until after the first
 * client commit, by which point this is the real measurement.
 */
function serverSnapshot(): boolean {
  return true;
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useLandscape(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
