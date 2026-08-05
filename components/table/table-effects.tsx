"use client";

/**
 * The one transient overlay still drawn in the DOM: folded cards drifting to
 * the muck. It self-removes via `onDone` when its animation finishes, so no
 * node or timer outlives it.
 *
 * The two chip sprays that used to live here as well -- PotFunnel, the pot
 * going out to its winners, and ChipFlight, a bet going in -- are meshes now
 * (components/table/scene/chips.ts). This one stays CSS on purpose rather
 * than for lack of time: it is a *card*, and every other card at this table
 * is a DOM node carrying the player's own purchased card back. Moving it to
 * the scene would mean uploading each cosmetic back as a texture to animate
 * one element for half a second.
 */

import { useEffect, useState } from "react";
import type { Card } from "@/lib/game/types";
import { PlayingCard } from "./playing-card";

/**
 * Bridges a seat's cards from "visible at the seat" to "gone" the moment it
 * folds, so the disappearance (PlayerSeat stops rendering them once
 * `folded`) reads as the cards actually leaving rather than an instant cut.
 * Renders whatever the seat's own `holeCards` already were at the moment of
 * folding -- real cards for the local player (whose own hand always stays
 * visible to them, fold or not), already-masked nulls/card-backs for any
 * other seat -- so it can never surface hidden information itself.
 */
export function MuckDrift({
  id,
  seatId,
  cards,
  isMine,
  tableWrapRef,
  potRef,
  seatRefs,
  onDone,
}: {
  id: string;
  seatId: string;
  cards: Array<Card | null>;
  isMine: boolean;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  potRef: React.RefObject<HTMLDivElement | null>;
  seatRefs: React.RefObject<Record<string, HTMLElement | null>>;
  onDone: (id: string) => void;
}) {
  const [layout, setLayout] = useState<{ originX: number; originY: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const wrapRect = tableWrapRef.current?.getBoundingClientRect();
    const potRect = potRef.current?.getBoundingClientRect();
    const seatEl = seatRefs.current[seatId];
    if (!wrapRect || !potRect || !seatEl) {
      onDone(id);
      return;
    }
    const seatRect = seatEl.getBoundingClientRect();
    setLayout({
      originX: seatRect.left + seatRect.width / 2 - wrapRect.left,
      originY: seatRect.top + seatRect.height / 2 - wrapRect.top,
      dx: potRect.left + potRect.width / 2 - (seatRect.left + seatRect.width / 2),
      dy: potRect.top + potRect.height / 2 - (seatRect.top + seatRect.height / 2),
    });
    const timer = window.setTimeout(() => onDone(id), 560);
    return () => window.clearTimeout(timer);
    // One-shot: a self-contained event keyed by its own id, not something
    // that should react to later layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!layout) return null;

  return (
    <div
      className="muck-drift"
      style={{
        left: `${layout.originX}px`,
        top: `${layout.originY}px`,
        "--muck-dx": `${layout.dx}px`,
        "--muck-dy": `${layout.dy}px`,
      } as React.CSSProperties}
      aria-hidden="true"
    >
      {cards.map((card, index) => (
        <span className="muck-drift-card" key={index}>
          <PlayingCard card={card} small={!isMine} large={isMine} />
        </span>
      ))}
    </div>
  );
}
