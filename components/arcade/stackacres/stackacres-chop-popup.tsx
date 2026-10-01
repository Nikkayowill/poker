"use client";

import { useEffect, useRef, useState } from "react";
import { SWING_PROFILES, gradeSwing, type SwingKind } from "@/lib/stackacres/chop";
import type { TapPoint } from "./world-contract";

/**
 * The swing popup: a tap on one of the Homestead's own trees
 * (lib/stackacres/tree-nodes.ts) or one of the Mine's boulders
 * (lib/stackacres/stone-nodes.ts) opens this. Same screen-pinned real-DOM
 * shape as StackAcresFenceUpgradePopup -- anchored at the tap point, closed
 * by Escape or its own button, not a canvas overlay.
 *
 * ONE COMPONENT, TWO KINDS. Chopping and mining share the exact same
 * sweep-and-press mechanic (lib/stackacres/chop.ts) and the same markup and
 * CSS classes (`.sa-chop-*`, unrenamed on purpose -- see that file's own
 * header) -- only the sweep speed, the sweet zone, and a handful of copy
 * strings differ per `kind`.
 *
 * THE SWING ITSELF is timed against a marker sweeping the bar on a plain CSS
 * animation (`.sa-chop-marker`), not a rAF loop -- there is nothing here for
 * a frame callback to compute, since the server never trusts this component's
 * verdict on its own (see lib/stackacres/chop.ts's own header): a press is
 * graded against `performance.now()` since the marker's own animation
 * started, using the exact same triangle-wave formula
 * (`gradeSwing`/`swingMeterValue`) the CSS keyframes are tuned to trace, so
 * the number this component reports matches what the player watched.
 */

/** What the popup needs to render one node, regardless of kind -- the same
 *  shape lib/stackacres/wood.ts's `WoodNodeSnapshot` and
 *  lib/stackacres/stone-nodes.ts's `StoneNodeSnapshot` both already are. */
export interface SwingNodeSnapshot {
  readonly ready: boolean;
  readonly hitsRemaining: number;
  readonly respawnProgress: number | null;
}

export interface StackAcresChopPopupProps {
  at: TapPoint;
  kind: SwingKind;
  node: SwingNodeSnapshot;
  busy: boolean;
  onSwing: (sweet: boolean) => void;
  onClose: () => void;
}

const COPY: Readonly<Record<SwingKind, { label: string; growing: string; almost: string; fresh: string }>> = {
  chop: {
    label: "Tree",
    growing: "Still growing back",
    almost: "Almost grown back",
    fresh: "Just chopped -- give it a while",
  },
  mine: {
    label: "Boulder",
    growing: "Still re-forming",
    almost: "Almost re-formed",
    fresh: "Just mined out -- give it a while",
  },
};

/** mm:ss-free "about 4 minutes" copy for a regrowing node -- this popup
 *  never shows a live countdown (nothing here re-renders on its own), so a
 *  precise number would go stale the instant it painted. */
function respawnHint(kind: SwingKind, progress: number): string {
  const copy = COPY[kind];
  if (progress >= 0.85) return copy.almost;
  if (progress >= 0.4) return copy.growing;
  return copy.fresh;
}

export function StackAcresChopPopup({ at, kind, node, busy, onSwing, onClose }: StackAcresChopPopupProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const { sweepMs, sweetZone } = SWING_PROFILES[kind];
  // Lazy initializer, same "read the clock once, at mount" pattern this
  // screen's own `useState(() => Date.now())` timers already use -- the
  // marker's CSS animation and this timestamp both start counting from the
  // same instant the popup mounts.
  const [startedAt] = useState(() => performance.now());

  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSwing = () => {
    const { sweet } = gradeSwing(kind, performance.now() - startedAt);
    onSwing(sweet);
  };

  return (
    <div className="sa-chop-popup" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-chop-popup-pin" aria-hidden="true" />
      <div className="sa-chop-popup-card" role="dialog" aria-label={COPY[kind].label}>
        <button type="button" className="sa-chop-popup-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {node.ready ? (
          <>
            <p className="sa-chop-popup-line">
              {node.hitsRemaining} swing{node.hitsRemaining === 1 ? "" : "s"} left
            </p>
            <div className="sa-chop-meter" aria-hidden="true">
              <div
                className="sa-chop-meter-sweet"
                style={{
                  left: `${sweetZone.min * 100}%`,
                  width: `${(sweetZone.max - sweetZone.min) * 100}%`,
                }}
              />
              <div className="sa-chop-marker" style={{ animationDuration: `${sweepMs}ms` }} />
            </div>
            <div className="sa-chop-popup-actions">
              <button type="button" className="sa-chop-popup-swing" ref={firstRef} disabled={busy} onClick={handleSwing}>
                Swing!
              </button>
              <button type="button" className="sa-chop-popup-no" onClick={onClose}>
                Not now
              </button>
            </div>
          </>
        ) : (
          <div className="sa-chop-popup-actions">
            <p className="sa-chop-popup-line">{respawnHint(kind, node.respawnProgress ?? 0)}</p>
            <button type="button" className="sa-chop-popup-no" ref={firstRef} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
