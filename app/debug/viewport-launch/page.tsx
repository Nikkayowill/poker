/**
 * TEMPORARY DIAGNOSTIC -- delete with components/debug/viewport-probe.tsx and
 * its mount in app/layout.tsx once the installed-PWA cold-launch nav gap is
 * resolved. See the open-bug block at the top of app/styles/45-mobile-shell.css.
 *
 * Separate from the older /debug/safe-area page (which reads insets live, right
 * now) because this bug only exists during the first second of a cold launch
 * and the PWA always launches at "/" -- so anything measured live on a debug
 * page only ever shows the settled, healthy state. ViewportProbe records the
 * launch into localStorage; this reads it back afterwards.
 *
 * How to use it: force-quit the installed PWA, relaunch, see the gap, then
 * navigate here and read the "Recorded launch" table.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { VIEWPORT_PROBE_KEY, type ViewportSample } from "@/components/debug/viewport-probe";

/**
 * The decisive read. `bottom: 0` resolves against the layout viewport, so if a
 * fixed probe lands exactly at innerHeight while a gap is visible on the glass,
 * the gap is outside the document and no CSS or JS in this app can close it.
 */
function verdict(sample: ViewportSample): string {
  if (sample.probeBottom === null) return "no probe";
  const drift = sample.innerHeight - sample.probeBottom;
  if (Math.abs(drift) > 1) return `probe ${drift}px off the viewport bottom -- containing block is NOT the viewport`;
  return "probe flush with the viewport bottom -- if you still saw a gap, it is outside the document";
}

function read(): ViewportSample[] {
  try {
    const raw = window.localStorage.getItem(VIEWPORT_PROBE_KEY);
    return raw ? (JSON.parse(raw) as ViewportSample[]) : [];
  } catch {
    return [];
  }
}

export default function ViewportLaunchDebug() {
  const [launch, setLaunch] = useState<ViewportSample[] | null>(null);

  const load = useCallback(() => setLaunch(read()), []);

  useEffect(() => {
    // Deferred rather than called straight from the effect body: reading
    // localStorage during render would also mismatch the prerendered HTML,
    // which has no storage to read.
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const clear = () => {
    try {
      window.localStorage.removeItem(VIEWPORT_PROBE_KEY);
    } catch {
      // Nothing to clear.
    }
    setLaunch([]);
  };

  return (
    <div style={page}>
      <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>Cold-launch viewport</h1>
      <p style={{ color: MUTED, margin: "0 0 16px", lineHeight: 1.5 }}>
        Force-quit the PWA, relaunch it, see the gap, then come here. The table
        below is what the probe recorded <em>during that launch</em>.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button type="button" onClick={load} style={btn}>Reload</button>
        <button type="button" onClick={clear} style={btn}>Clear</button>
      </div>

      {!launch ? <p style={{ color: MUTED }}>loading…</p>
        : launch.length === 0
          ? <p style={{ color: MUTED }}>Nothing recorded yet. Cold launch the app, then come back.</p>
          : (
            <>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: MUTED, textAlign: "left" }}>
                      {["at", "innerH", "visualH", "clientH", "screenH", "safeTop", "safeBot", "probeB", "PWA"].map((head) => (
                        <th key={head} style={cell}>{head}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {launch.map((row, index) => {
                      // Highlight the moment the viewport changes size: that is
                      // the whole question this page exists to answer.
                      const grew = index > 0 && row.innerHeight !== launch[index - 1].innerHeight;
                      return (
                        <tr key={`${row.at}-${index}`} style={grew ? { background: FLAG } : undefined}>
                          <td style={cell}>{row.at}</td>
                          <td style={{ ...cell, fontWeight: grew ? 700 : 400 }}>{row.innerHeight}</td>
                          <td style={cell}>{row.visualHeight ?? "-"}</td>
                          <td style={cell}>{row.clientHeight}</td>
                          <td style={cell}>{row.screenHeight}</td>
                          <td style={cell}>{row.safeTop}</td>
                          <td style={cell}>{row.safeBottom}</td>
                          <td style={cell}>{row.probeBottom ?? "-"}</td>
                          <td style={cell}>{row.standalone ? "yes" : "no"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ color: MUTED, marginTop: 8 }}>
                last sample: {verdict(launch[launch.length - 1])}
              </p>
            </>
          )}

      <div style={{ marginTop: 24, padding: 12, background: "rgba(255, 210, 63, .08)", borderRadius: 6, lineHeight: 1.6 }}>
        <strong>Reading it</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          <li><code>innerH</code> rising between samples (800 → 852, say) means the layout viewport starts short and grows. That is the bug, and no CSS can fix it.</li>
          <li><code>probeB</code> equal to <code>innerH</code> while you still saw a gap means the gap is outside the document — the web view frame is short. That points at the manifest and the native shell, not this app.</li>
          <li><code>safeBot</code> changing between samples would mean the inset really is stale, which would be a different bug than the one we think we have.</li>
        </ul>
      </div>
    </div>
  );
}

const MUTED = "#9aa8c0";
const FLAG = "rgba(255, 80, 80, .18)";
const page: React.CSSProperties = {
  padding: 16,
  fontFamily: "ui-monospace, monospace",
  background: "#12101a",
  color: "#eef2f8",
  minHeight: "100vh",
  fontSize: 12,
};
const cell: React.CSSProperties = {
  padding: "4px 8px",
  whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(255, 255, 255, .08)",
};
const btn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: 0,
  background: "#2a2740",
  color: "#eef2f8",
  font: "inherit",
};
