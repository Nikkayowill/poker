"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import type { GameSnapshot } from "@/lib/game/types";

export function HandHistoryDrawer({
  log,
  handNumber,
  onClose,
}: {
  log: GameSnapshot["log"];
  handNumber: number;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="history-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className="history-drawer" role="dialog" aria-modal="true" aria-label="Hand history">
        <div className="panel-heading">
          <div>
            <span>TABLE ACTIVITY</span>
            <strong>Hand #{handNumber}</strong>
          </div>
          <button ref={closeButtonRef} className="modal-close" onClick={onClose} aria-label="Close hand history"><X size={16} /></button>
        </div>
        <div className="activity-list">
          {log.length === 0 && <p className="activity-empty">Nothing has happened yet.</p>}
          {log.map((entry) => (
            <div className={clsx("activity-item", `activity-${entry.kind}`)} key={entry.id}>
              <span className="activity-icon">{entry.kind === "win" ? "♛" : entry.kind === "deal" ? "◆" : "•"}</span>
              <div>
                <p>{entry.text}</p>
                <time>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
            </div>
          ))}
        </div>
        <div className="panel-footnote">Deck and hole cards secured server-side</div>
      </aside>
    </div>
  );
}
