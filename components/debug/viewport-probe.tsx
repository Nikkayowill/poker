"use client";

/**
 * TEMPORARY DIAGNOSTIC -- delete this file, its mount in app/layout.tsx, and
 * app/debug/viewport-launch once the installed-PWA cold-launch nav gap is
 * resolved.
 * See the open-bug block at the top of app/styles/45-mobile-shell.css.
 *
 * The bug only shows during the first moments of a cold launch, and the PWA
 * always launches at "/", so by the time you can navigate to a debug page the
 * viewport has already settled and the evidence is gone. This records the
 * launch timeline into localStorage instead, so /debug/viewport-launch can read
 * back what happened during a launch that already finished.
 *
 * Renders nothing and touches no layout -- it must not perturb the very thing
 * it measures. In particular it never forces a reflow: reading offsetHeight or
 * toggling display is exactly the intervention under test.
 */

import { useEffect } from "react";

const STORAGE_KEY = "stackchips:viewport-probe";
/** Past the ~300-400ms settle window earlier passes described, with room either side. */
const SAMPLE_DELAYS_MS = [0, 100, 300, 600, 1200, 2500];
/** Enough for the scheduled samples plus a rotation, then recording stops. See `record`. */
const MAX_SAMPLES = 40;

export type ViewportSample = {
  /** ms since the probe mounted, or the event name that produced the sample. */
  at: string;
  /** The layout viewport the page believes it has. */
  innerHeight: number;
  innerWidth: number;
  /** What the visual viewport reports; diverges from innerHeight under keyboards/toolbars. */
  visualHeight: number | null;
  visualOffsetTop: number | null;
  /** The physical screen, which never changes across the launch. */
  screenHeight: number;
  /** documentElement.clientHeight -- the initial containing block `bottom: 0` resolves against. */
  clientHeight: number;
  safeTop: string;
  safeBottom: string;
  /**
   * Where an element pinned `position: fixed; bottom: 0` actually lands.
   *
   * This is the decisive number. If probeBottom === innerHeight while a gap is
   * still visible on the device, the gap is OUTSIDE the document -- the web
   * view's frame is short -- and nothing in this app's CSS or JS can close it.
   */
  probeBottom: number | null;
  standalone: boolean;
};

function sample(at: string, probe: HTMLElement | null): ViewportSample {
  const styles = getComputedStyle(document.documentElement);
  return {
    at,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    visualHeight: window.visualViewport?.height ?? null,
    visualOffsetTop: window.visualViewport?.offsetTop ?? null,
    screenHeight: window.screen.height,
    clientHeight: document.documentElement.clientHeight,
    safeTop: styles.getPropertyValue("--safe-top").trim() || "0px",
    safeBottom: styles.getPropertyValue("--safe-bottom").trim() || "0px",
    // getBoundingClientRect reads existing layout; it does not force a new one
    // the way offsetHeight after a style mutation would.
    probeBottom: probe ? Math.round(probe.getBoundingClientRect().bottom) : null,
    standalone: window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as { standalone?: boolean }).standalone === true,
  };
}

export function ViewportProbe() {
  useEffect(() => {
    // A 1px transparent element pinned exactly the way .mshell-nav is, so we
    // measure the real containing block rather than trusting that it matches.
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none;opacity:0";
    document.body.appendChild(probe);

    const samples: ViewportSample[] = [];
    const started = performance.now();
    const record = (at: string) => {
      // Hard cap, and the reason matters if this ever runs in production:
      // visualViewport's resize fires continuously on iOS as the toolbars
      // collapse during a scroll, and every call re-serialises the whole
      // array. Uncapped, a long session grows an unbounded list and pays a
      // JSON.stringify of it on every scroll frame. Everything this bug needs
      // happens in the first seconds, so stop once we have enough.
      if (samples.length >= MAX_SAMPLES) return;
      samples.push(sample(at, probe));
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
      } catch {
        // Private mode or a full store: the on-screen readout still works for
        // a session that stays on this page.
      }
    };

    record("mount");
    const timers = SAMPLE_DELAYS_MS.map((delay) =>
      window.setTimeout(() => record(`+${delay}ms`), delay),
    );

    const onResize = () => record(`resize @${Math.round(performance.now() - started)}ms`);
    const onOrientation = () => record(`orientation @${Math.round(performance.now() - started)}ms`);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
      window.visualViewport?.removeEventListener("resize", onResize);
      probe.remove();
    };
  }, []);

  return null;
}

export { STORAGE_KEY as VIEWPORT_PROBE_KEY };
