"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { StackChipsMark } from "@/components/brand/stackchips-mark";

/**
 * The full-screen "entering the room" beat, shared by both table renderers.
 *
 * `sceneReady` gates on every seated character actually mounting (see
 * lib/game3d/avatar-load-gate.ts) rather than on WebGL context creation
 * alone, which used to let the room present itself as finished while
 * avatars popped in seat by seat, reading as "falling out of the sky." This
 * component covers that wait instead of leaving the player looking at flat
 * DOM felt while it happens.
 *
 * The 2D table has the same gap for a different reason: its felt/rail art
 * is a real image loaded over the network rather than canvas-painted (see
 * use-felt-art-ready.ts), so the shell/seats/HUD would be interactive
 * before the felt finished loading. `sceneReady` from poker-table.tsx
 * reflects readiness for whichever renderer is active, so
 * `active={!sceneReady}` covers both; this component only presents that
 * state, it doesn't own the decision.
 */

const FLAVOR_LINES = [
  "Racking the chips…",
  "Warming up the felt…",
  "Dealing you in…",
  "Finding your seat…",
] as const;

const FLAVOR_INTERVAL_MS = 1800;
const FADE_MS = 350;

/**
 * A backstop independent of PokerScene's own ~10s avatar-load timeout. That
 * timeout covers a slow/stuck fetch by presenting the room anyway; it does
 * nothing for a genuine scene failure, where `SceneBoundary` reports
 * `sceneReady = false` for good. Without this the splash would sit forever
 * over a DOM fallback table that is already working fine. Set past the
 * scene-side timeout so the natural path wins first whenever the room is
 * merely slow, not broken.
 */
const AUTO_HIDE_MS = 11_000;

type Phase = "hidden" | "visible" | "hiding";

export function TableLoadingSplash({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>(active ? "visible" : "hidden");
  const [prevActive, setPrevActive] = useState(active);
  const [flavorIndex, setFlavorIndex] = useState(0);

  // React's own documented pattern for "adjust state when a prop changes":
  // compared and set during render, not synced from an effect. A fresh load
  // (renderer switched back to 3D after leaving it) always gets its own full
  // "visible" phase; a load finishing (or failing, via the DOM fallback
  // already taking over) starts the fade unless nothing was ever shown.
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) {
      setPhase("visible");
    } else if (phase !== "hidden") {
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setPhase(reduceMotion ? "hidden" : "hiding");
    }
  }

  // The fade-out's own duration: a genuine timer, not derived state.
  useEffect(() => {
    if (phase !== "hiding") return;
    const timer = setTimeout(() => setPhase("hidden"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // The auto-hide backstop described above.
  useEffect(() => {
    if (phase !== "visible") return;
    const timer = setTimeout(() => {
      setPhase((current) => (current === "visible" ? "hiding" : current));
    }, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

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
