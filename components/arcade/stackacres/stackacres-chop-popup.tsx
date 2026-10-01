"use client";

import { useEffect, useRef, useState } from "react";
import { CHOP_SWEEP_MS, CHOP_SWEET_ZONE, gradeChopSwing } from "@/lib/stackacres/chop";
import type { WoodNodeSnapshot } from "@/lib/stackacres/wood";
import type { TapPoint } from "./world-contract";

/**
 * The chop popup: a tap on one of the Homestead's own trees
 * (lib/stackacres/tree-nodes.ts) opens this. Same screen-pinned real-DOM
 * shape as StackAcresFenceUpgradePopup -- anchored at the tap point, closed
 * by Escape or its own button, not a canvas overlay.
 *
 * THE SWING ITSELF is timed against a marker sweeping the bar on a plain CSS
 * animation (`.sa-chop-marker`), not a rAF loop -- there is nothing here for
 * a frame callback to compute, since the server never trusts this component's
 * verdict on its own (see lib/stackacres/chop.ts's own header): a press is
 * graded against `performance.now()` since the marker's own animation
 * started, using the exact same triangle-wave formula
 * (`gradeChopSwing`/`chopMeterValue`) the CSS keyframes are tuned to trace,
 * so the number this component reports matches what the player watched.
 */

export interface StackAcresChopPopupProps {
  at: TapPoint;
  node: WoodNodeSnapshot;
  busy: boolean;
  onSwing: (sweet: boolean) => void;
  onClose: () => void;
}

/** mm:ss-free "about 4 minutes" copy for a regrowing stump -- this popup
 *  never shows a live countdown (nothing here re-renders on its own), so a
 *  precise number would go stale the instant it painted. */
function respawnHint(progress: number): string {
  if (progress >= 0.85) return "Almost grown back";
  if (progress >= 0.4) return "Still growing back";
  return "Just chopped -- give it a while";
}

export function StackAcresChopPopup({ at, node, busy, onSwing, onClose }: StackAcresChopPopupProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
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
    const { sweet } = gradeChopSwing(performance.now() - startedAt);
    onSwing(sweet);
  };

  return (
    <div className="sa-chop-popup" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-chop-popup-pin" aria-hidden="true" />
      <div className="sa-chop-popup-card" role="dialog" aria-label="Tree">
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
                  left: `${CHOP_SWEET_ZONE.min * 100}%`,
                  width: `${(CHOP_SWEET_ZONE.max - CHOP_SWEET_ZONE.min) * 100}%`,
                }}
              />
              <div className="sa-chop-marker" style={{ animationDuration: `${CHOP_SWEEP_MS}ms` }} />
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
            <p className="sa-chop-popup-line">{respawnHint(node.respawnProgress ?? 0)}</p>
            <button type="button" className="sa-chop-popup-no" ref={firstRef} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
