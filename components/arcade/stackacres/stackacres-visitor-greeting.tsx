"use client";

import { useEffect, useRef } from "react";
import { VISITOR_LINE, VISITOR_NAME, VISITOR_PORTRAIT, type VisitorId } from "@/lib/stackacres/visitors";
import type { TapPoint } from "./stackacres-scene";

/**
 * One of the ten stranded visitors' greeting: a single line, no phases, no
 * picker -- placement + flavour dialogue only, the whole scope of this
 * feature (gifts, quests and Gold are deliberately future work). Anchored at
 * the tap point the scene handed back, the same screen-pinned real-DOM
 * speech-bubble posture `StackAcresMonkDialogue` uses for its own "greeting"
 * phase, just without the "will you pray?" prompt this NPC has no
 * counterpart for.
 *
 * Dismissal is not this component's job, same posture every other
 * screen-anchored popup on this map documents: stackacres-farm.tsx closes it
 * on the next world tap (`onViewMoved`) and on its own explicit close button
 * here.
 */
export interface StackAcresVisitorGreetingProps {
  id: VisitorId;
  at: TapPoint;
  onClose: () => void;
}

export function StackAcresVisitorGreeting({ id, at, onClose }: StackAcresVisitorGreetingProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
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
    <div className="sa-visitor-greeting" style={{ left: `${at.x}px`, top: `${at.y}px` }}>
      <span className="sa-visitor-greeting-pin" aria-hidden="true" />
      <div className="sa-visitor-greeting-card" role="dialog" aria-label={VISITOR_NAME[id]}>
        <button
          type="button"
          className="sa-visitor-greeting-close"
          aria-label="Close"
          ref={closeRef}
          onClick={onClose}
        >
          ×
        </button>
        <img src={VISITOR_PORTRAIT[id]} alt="" className="sa-visitor-greeting-portrait" />
        <p className="sa-visitor-greeting-name">{VISITOR_NAME[id]}</p>
        <p className="sa-visitor-greeting-line">&ldquo;{VISITOR_LINE[id]}&rdquo;</p>
      </div>
    </div>
  );
}
