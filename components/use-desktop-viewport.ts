"use client";

/**
 * Whether the viewport is at or above the seat-art desktop breakpoint.
 *
 * Built the same way as `useLandscape`/`useWebglSupport` -- a real
 * subscription via `useSyncExternalStore` rather than a snapshot read once
 * at mount, so resizing the window (or rotating a tablet across the
 * threshold) updates it live instead of freezing whatever was true on
 * first paint.
 *
 * WHAT USES IT: `lib/scene/seat-art.ts`'s `SEAT_ART_OVERRIDES` /
 * `DESKTOP_SEAT_ART_OVERRIDES` are two separate hand-tuned tables, and
 * `seatArtSlotFor`/`pickSeatArtForSlot` need to be told which one applies --
 * they take an explicit `isDesktop` rather than checking `matchMedia`
 * themselves for the same reason `/dev/table-layout` needed one: a caller
 * that DOES know which frame it's drawing (this hook, for the live table)
 * should pass that, not have the function re-derive a possibly-wrong answer.
 */

import { useSyncExternalStore } from "react";
import { DESKTOP_BREAKPOINT_PX } from "@/lib/scene/seat-art";

const QUERY = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

function clientSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/** The server has no viewport. Desktop is the honest default for the same
 *  reason `useLandscape` picks landscape: it's what most first paints are,
 *  and the table is held behind `tableRendererSettled` until the real
 *  client measurement lands. */
function serverSnapshot(): boolean {
  return true;
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useDesktopViewport(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
