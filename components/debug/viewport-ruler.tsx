"use client";

/**
 * TEMPORARY DIAGNOSTIC -- delete this file and its mount in app/layout.tsx as
 * soon as the bottom-chrome bug is settled. It paints on top of the real app.
 *
 * Why this exists when app/debug/viewport-launch already does: that page is
 * unreachable. The bug only shows in an installed PWA, a PWA always launches
 * at "/", and standalone mode has no address bar to type a debug URL into --
 * so in six passes over several weeks nobody has ever actually read the
 * numbers off the device, and every one of those passes was reasoning about
 * WebKit instead. This puts the readout on the screen the bug is happening on.
 *
 * It answers ONE question, and the answer decides whether the bug is fixable
 * in this app at all:
 *
 *   Is the strip of dead space at the bottom INSIDE the web view or outside it?
 *
 * The LIME band is drawn at `bottom: -64px` -- deliberately below where the
 * document believes its own bottom edge is.
 *   - Lime visible on screen  => those pixels belong to the page. The layout
 *     viewport is just short, and bottom-anchored chrome can be shifted down
 *     to cover it. Fixable here, in CSS/JS.
 *   - Lime NOT visible        => the web view's own frame ends at the magenta
 *     line. Nothing this app draws can reach below it, and the fix is in the
 *     manifest or the native shell, not the stylesheets.
 *
 * The MAGENTA line is `bottom: 0` -- where the document thinks the bottom is.
 * On a healthy launch it sits on the physical bottom edge of the screen.
 *
 * Standalone only, so nobody in a browser ever sees it. Tap the readout to
 * dismiss for the session.
 */

import { useEffect, useState } from "react";

type Reading = {
  inner: number;
  client: number;
  visual: string;
  screen: string;
  dvh: number;
  svh: number;
  lvh: number;
  safeBottom: string;
  envBottom: string;
  dpr: number;
  at: string;
};

/** Measures a viewport unit by reading a probe sized in it. */
function unit(value: string): number {
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;top:0;left:0;width:1px;height:${value};visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  const height = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return height;
}

/**
 * The raw, uncapped inset. --safe-bottom is capped in 01-tokens.css, so
 * reading that property alone cannot tell us what the browser actually
 * reported -- which is the number the previous fix assumed was ~86px.
 */
function rawInset(): string {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:0;left:0;width:1px;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return `${Math.round(height * 10) / 10}px`;
}

function read(at: string): Reading {
  const vv = window.visualViewport;
  return {
    inner: window.innerHeight,
    client: document.documentElement.clientHeight,
    visual: vv ? `${Math.round(vv.height)} @${Math.round(vv.offsetTop)}` : "-",
    screen: `${window.screen.width}x${window.screen.height}`,
    dvh: unit("100dvh"),
    svh: unit("100svh"),
    lvh: unit("100lvh"),
    safeBottom: getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom").trim(),
    envBottom: rawInset(),
    dpr: window.devicePixelRatio,
    at,
  };
}

export function ViewportRuler() {
  const [reading, setReading] = useState<Reading | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as { standalone?: boolean }).standalone === true;
    if (!standalone) return;

    const sample = (at: string) => setReading(read(at));
    sample("load");
    // The launch settle window the earlier passes described, so a value that
    // starts wrong and corrects itself is visible as it happens.
    const timers = [300, 1200, 2500].map((ms) =>
      window.setTimeout(() => sample(`+${ms}ms`), ms),
    );
    const onResize = () => sample("resize");
    const onRotate = () => sample("rotate");
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onRotate);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      timers.forEach(window.clearTimeout);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onRotate);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  if (!reading || hidden) return null;

  // Short by this much: in standalone there is no browser chrome, so the
  // layout viewport should equal the screen. Anything else is the bug.
  const short = window.screen.height - reading.inner;

  return (
    <>
      {/* BELOW the document's bottom edge. Visible => the page owns those pixels. */}
      <div style={below} aria-hidden="true">
        <span style={belowText}>▼ BELOW bottom:0 — if you can read this, the page can paint here</span>
      </div>
      {/* The document's own bottom edge. */}
      <div style={edge} aria-hidden="true" />
      <button type="button" style={panel} onClick={() => setHidden(true)}>
        <b style={{ color: short > 2 ? "#ff6b6b" : "#7CFC98" }}>
          short by {short}px{short > 2 ? "  ← THE BUG" : "  ← healthy"}
        </b>
        <span>inner {reading.inner} · client {reading.client} · screen {reading.screen}</span>
        <span>visual {reading.visual} · dpr {reading.dpr}</span>
        <span>dvh {reading.dvh} · svh {reading.svh} · lvh {reading.lvh}</span>
        <span>env bottom <b>{reading.envBottom}</b> · capped {reading.safeBottom}</span>
        <span style={{ opacity: .6 }}>sample: {reading.at} — tap to hide</span>
      </button>
    </>
  );
}

const below: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: -64,
  height: 64,
  zIndex: 2147483647,
  background: "#7CFC00",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: 4,
  pointerEvents: "none",
};

const belowText: React.CSSProperties = {
  color: "#000",
  font: "600 10px/1.2 ui-monospace, monospace",
  textAlign: "center",
};

const edge: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  height: 3,
  zIndex: 2147483647,
  background: "#ff00d0",
  pointerEvents: "none",
};

const panel: React.CSSProperties = {
  position: "fixed",
  left: 6,
  right: 6,
  bottom: 6,
  zIndex: 2147483646,
  display: "flex",
  flexDirection: "column",
  gap: 1,
  alignItems: "flex-start",
  border: 0,
  borderRadius: 6,
  padding: "6px 8px",
  background: "rgba(0,0,0,.86)",
  color: "#eef2f8",
  font: "500 11px/1.35 ui-monospace, monospace",
  textAlign: "left",
};
