"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { StackChipsMark } from "@/components/brand/stackchips-mark";
import { useMinHoldFade } from "@/components/loading/use-min-hold-fade";

/**
 * The full-screen "entering the room" beat over the racetrack table.
 *
 * Started life covering two renderers -- this one and the now-deleted WebGL
 * 3D room (recoverable from the `archive/webgl-3d-table` git tag), whose own
 * `onReady` used to fire on context creation alone, essentially instant,
 * while each seated character kept loading independently behind its own
 * Suspense boundary. That let the room present itself as finished and then
 * have avatars pop in seat by seat, which read as "falling out of the sky."
 *
 * The racetrack table earns the same kind of gap for a different reason: its
 * canvas needs a frame to mount before `RacetrackScene`'s own `onReady`
 * fires, so without this the table shell/seats/HUD would already be
 * interactive for that one frame before the room painted in behind them.
 * `sceneReady` from poker-table.tsx reflects that readiness; this component
 * owns none of the decision, only the presentation of it.
 *
 * Phase timing (hidden/visible/hiding, plus the minimum hold before a hide
 * is allowed to start) is shared with every other loading treatment in the
 * app via useMinHoldFade -- see that hook for why the hold exists.
 */

const FLAVOR_LINES = [
  "Racking the chips…",
  "Warming up the felt…",
  "Dealing you in…",
  "Finding your seat…",
] as const;

const FLAVOR_INTERVAL_MS = 1800;
const MIN_VISIBLE_MS = 450;
const FADE_MS = 350;

/**
 * A backstop independent of PokerScene's own ~10s avatar-load timeout. That
 * timeout covers a slow/stuck fetch by presenting the room anyway; it does
 * nothing for a genuine scene failure, where `SceneBoundary` reports
 * `sceneReady = false` for good. Without this the splash would sit forever
 * over a DOM fallback table that is already working fine. Set past the
 * scene-side timeout so the natural path wins first whenever the room is
 * merely slow, not broken.
 *
 * Implemented as a local override of `active` (see `effectiveActive` below)
 * rather than inside the phase hook -- the hook only knows hidden/visible/
 * hiding, it has no concept of "force-hide even though the caller still says
 * active."
 */
const AUTO_HIDE_MS = 11_000;

export function TableLoadingSplash({ active }: { active: boolean }) {
  const [backstopExpired, setBackstopExpired] = useState(false);
  const effectiveActive = active && !backstopExpired;
  const phase = useMinHoldFade(effectiveActive, { minMs: MIN_VISIBLE_MS, fadeMs: FADE_MS });
  const [flavorIndex, setFlavorIndex] = useState(0);

  // Resets whenever a fresh load starts, so a second wait gets its own full
  // backstop window rather than inheriting whatever was left of the last one.
  // Deferred a macrotask rather than called synchronously in the effect body
  // -- same `window.setTimeout(fn, 0)` shape useMinHoldFade uses, required by
  // this codebase's react-hooks/set-state-in-effect lint.
  useEffect(() => {
    if (!active) {
      const timer = window.setTimeout(() => setBackstopExpired(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setBackstopExpired(true), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (phase === "hidden") return;
    const timer = setInterval(() => {
      setFlavorIndex((index) => (index + 1) % FLAVOR_LINES.length);
    }, FLAVOR_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      className={clsx("table-loading-splash", phase === "hiding" && "table-loading-splash-hiding")}
      role="status"
      aria-live="polite"
    >
      <StackChipsMark size={80} />
      <span className="table-loading-splash-spinner" aria-hidden="true" />
      <p className="table-loading-splash-flavor">{FLAVOR_LINES[flavorIndex]}</p>
    </div>
  );
}
