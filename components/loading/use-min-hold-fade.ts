"use client";

import { useEffect, useState } from "react";
import { phaseOnDeactivate, remainingHoldMs, type FadePhase } from "@/lib/loading/min-hold-fade";

export type { FadePhase };

export interface MinHoldFadeOptions {
  /** Once `active` goes true, hold "visible" for at least this long. */
  minMs?: number;
  /** How long "hiding" lasts before settling to "hidden" -- must match the
   *  CSS transition duration the consumer applies to its own hiding class. */
  fadeMs?: number;
}

const DEFAULT_MIN_MS = 450;
const DEFAULT_FADE_MS = 350;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * hidden -> visible -> hiding -> hidden, driven by an `active` boolean, with
 * a minimum hold on "visible" so a fast resolve can't skip the loading state
 * entirely. The state-machine arithmetic lives in lib/loading/min-hold-fade.ts
 * (tested there, plain numbers in and out); this hook is the effect/timer
 * shell around it.
 *
 * Every transition is driven from an effect, never derived during render --
 * this codebase's react-hooks purity lint forbids reading the clock
 * (Date.now/matchMedia) during render, and separately requires a setState
 * called directly in an effect body to be deferred a macrotask rather than
 * fired synchronously (same `window.setTimeout(fn, 0)` shape loadProfile and
 * useProgression already use for their own effects). The two timer-driven
 * setPhase calls below (the hold floor, the fade-out) are exempt from that
 * second rule -- they already run inside a genuine timer callback, not
 * synchronously in the effect body.
 */
export function useMinHoldFade(active: boolean, opts: MinHoldFadeOptions = {}): FadePhase {
  const minMs = opts.minMs ?? DEFAULT_MIN_MS;
  const fadeMs = opts.fadeMs ?? DEFAULT_FADE_MS;

  const [phase, setPhase] = useState<FadePhase>(active ? "visible" : "hidden");
  // When the current "visible" phase began. Only ever written from an
  // effect, so nothing here reads the clock during render.
  const [shownAt, setShownAt] = useState<number | null>(null);

  // Activation: always an immediate, full "visible".
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      setShownAt(Date.now());
      setPhase("visible");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active]);

  // Deactivation: moves to "hiding"/"hidden" right away if the minimum hold
  // has already elapsed. If not, phaseOnDeactivate leaves this at "visible"
  // and the effect below is what finishes the job once the remainder passes.
  useEffect(() => {
    if (active) return;
    const timer = window.setTimeout(() => {
      setPhase((current) => {
        if (current === "hidden") return current;
        const elapsed = shownAt === null ? minMs : Date.now() - shownAt;
        return phaseOnDeactivate(elapsed, minMs, prefersReducedMotion());
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, shownAt, minMs]);

  // The minimum-hold floor itself.
  useEffect(() => {
    if (active || phase !== "visible") return;
    const elapsed = shownAt === null ? minMs : Date.now() - shownAt;
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "visible" ? phaseOnDeactivate(minMs, minMs, prefersReducedMotion()) : current));
    }, remainingHoldMs(elapsed, minMs));
    return () => window.clearTimeout(timer);
  }, [active, phase, shownAt, minMs]);

  // The fade-out's own duration -- a genuine timer, not derived state.
  useEffect(() => {
    if (phase !== "hiding") return;
    const timer = window.setTimeout(() => setPhase("hidden"), fadeMs);
    return () => window.clearTimeout(timer);
  }, [phase, fadeMs]);

  return phase;
}
