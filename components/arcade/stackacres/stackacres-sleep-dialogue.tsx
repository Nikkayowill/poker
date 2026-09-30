"use client";

import { useEffect, useRef } from "react";
import { useKeepOnScreen } from "./use-keep-on-screen";
import type { TapPoint } from "./world-contract";

/**
 * The bed's "Go to sleep?" card. Same pinned speech-bubble card as the Pixel
 * Pilgrim's (stackacres-monk-dialogue.tsx), reusing its styles, with a night
 * blue pin. "Not yet" sends nothing. The shell closes it on the next world tap.
 */
export interface StackAcresSleepDialogueProps {
  at: TapPoint;
  onSleep: () => void;
  onClose: () => void;
}

export function StackAcresSleepDialogue({ at, onSleep, onClose }: StackAcresSleepDialogueProps) {
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useKeepOnScreen<HTMLDivElement>();

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

  return (
    <div className="sa-monk-dialogue sa-sleep-dialogue" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-monk-dialogue-pin" aria-hidden="true" />
      <div ref={cardRef} className="sa-monk-dialogue-card" role="dialog" aria-label="Go to sleep?">
        <button type="button" className="sa-monk-dialogue-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <p className="sa-monk-dialogue-prompt">Go to sleep?</p>
        <p className="sa-monk-dialogue-progress">You&apos;ll wake up at 6 AM.</p>
        <div className="sa-monk-dialogue-actions">
          <button type="button" className="sa-monk-dialogue-yes" ref={firstRef} onClick={onSleep}>
            Sleep
          </button>
          <button type="button" className="sa-monk-dialogue-no" onClick={onClose}>
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}
