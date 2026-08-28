"use client";

/**
 * TEMPORARY diagnostic overlay for the "tab bar sits too high on a fresh
 * PWA launch" bug. Two prior fixes (ed5c067, aa592db) and one more nudge
 * alongside this file all targeted the symptom without a real device
 * measurement to confirm against -- this captures actual viewport/rect
 * numbers at the moment the glitch would be visible instead of guessing a
 * fourth time. Screenshot it on a cold launch when the bar looks wrong and
 * send it back; delete this file and its one call site in mobile-shell.tsx
 * once the bug is confirmed fixed -- it is not meant to ship long-term.
 *
 * Always mounted rather than query-param gated: an installed PWA launches
 * from its manifest's fixed `start_url`, so there is no way to add a debug
 * flag to a cold launch after the fact. Auto-hides after 8s, or on tap, so
 * it isn't in the way once it has done its job.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

type Sample = {
  t: number;
  label: string;
  innerH: number;
  vvH: number | null;
  vvTop: number | null;
  navTop: number | null;
  navBottom: number | null;
  navPadBottom: string;
};

export function MshellNavDebug({ navRef }: { navRef: RefObject<HTMLElement | null> }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = performance.now();
    const capture = (label: string) => {
      const rect = navRef.current?.getBoundingClientRect() ?? null;
      const vv = window.visualViewport;
      setSamples((prev) => [
        ...prev,
        {
          t: Math.round(performance.now() - startRef.current),
          label,
          innerH: window.innerHeight,
          vvH: vv ? Math.round(vv.height) : null,
          vvTop: vv ? Math.round(vv.offsetTop) : null,
          navTop: rect ? Math.round(rect.top) : null,
          navBottom: rect ? Math.round(rect.bottom) : null,
          navPadBottom: navRef.current ? getComputedStyle(navRef.current).paddingBottom : "n/a",
        },
      ].slice(-16));
    };

    capture("mount");
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      capture("raf1");
      raf2 = requestAnimationFrame(() => capture("raf2"));
    });
    const timers = [200, 500, 1000, 2000, 4000].map((ms) =>
      window.setTimeout(() => capture(`${ms}ms`), ms),
    );
    const onResize = () => capture("vv-resize");
    window.visualViewport?.addEventListener("resize", onResize);
    const dismissTimer = window.setTimeout(() => setDismissed(true), 8000);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(dismissTimer);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [navRef]);

  if (dismissed) return null;

  return (
    <div
      role="status"
      onClick={() => setDismissed(true)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,.88)",
        color: "#5cff5c",
        fontFamily: "ui-monospace, monospace",
        fontSize: 9,
        lineHeight: 1.35,
        padding: "6px 8px",
        maxHeight: "38vh",
        overflowY: "auto",
        whiteSpace: "pre",
      }}
    >
      <div style={{ color: "#fff", marginBottom: 4 }}>NAV DEBUG -- tap to dismiss</div>
      {samples.map((s, i) => (
        <div key={i}>
          {`t=${String(s.t).padStart(4)}ms [${s.label.padEnd(8)}] innerH=${s.innerH} vvH=${s.vvH} vvTop=${s.vvTop} navTop=${s.navTop} navBottom=${s.navBottom} padB=${s.navPadBottom}`}
        </div>
      ))}
    </div>
  );
}
