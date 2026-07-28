"use client";

/**
 * The transient overlays: chips flying to the pot, the pot funnelling back to
 * a winner, and folded cards drifting to the muck. Each self-removes via
 * `onDone` when its animation finishes, so no node or timer outlives it.
 */

import { useEffect, useState } from "react";
import type { Card, Winner } from "@/lib/game/types";
import { PlayingCard } from "./playing-card";

/**
 * Animates chips flying from the pot to each winning seat. Measures real
 * screen positions (rather than hardcoded per-placement offsets) so the
 * trajectory stays correct across every responsive breakpoint. Keyed by hand
 * number from the parent, so it mounts fresh — and animates — exactly once
 * per completed hand.
 */
export function PotFunnel({
  winners,
  potRef,
  seatRefs,
}: {
  winners: Winner[];
  potRef: React.RefObject<HTMLDivElement | null>;
  seatRefs: React.RefObject<Record<string, HTMLElement | null>>;
}) {
  const [vectors, setVectors] = useState<Array<{ seatId: string; dx: number; dy: number }>>([]);

  useEffect(() => {
    const potRect = potRef.current?.getBoundingClientRect();
    if (!potRect) return;
    const potCenterX = potRect.left + potRect.width / 2;
    const potCenterY = potRect.top + potRect.height / 2;
    const next: Array<{ seatId: string; dx: number; dy: number }> = [];
    winners.forEach((winner) => {
      const seatEl = seatRefs.current[winner.seatId];
      if (!seatEl) return;
      const stashEl = seatEl.querySelector<HTMLElement>(".seat-stack") ?? seatEl;
      const seatRect = stashEl.getBoundingClientRect();
      next.push({
        seatId: winner.seatId,
        dx: seatRect.left + seatRect.width / 2 - potCenterX,
        dy: seatRect.top + seatRect.height / 2 - potCenterY,
      });
    });
    setVectors(next);
    // Deliberately runs once on mount: this component remounts (a fresh
    // measurement) via its `key={handNumber}` in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {vectors.flatMap((vector) =>
        Array.from({ length: 12 }, (_, index) => {
          const spreadX = ((index % 5) - 2) * 5;
          const spreadY = ((index * 7) % 13) - 6;
          return (
            <span
              key={`${vector.seatId}-${index}`}
              className={`pot-chip-flight chip-color-${index % 5}`}
              style={{
                "--funnel-dx": `${vector.dx + spreadX}px`,
                "--funnel-dy": `${vector.dy + spreadY}px`,
                "--shuffle-x": `${((index * 11) % 31) - 15}px`,
                "--shuffle-y": `${-12 - ((index * 5) % 18)}px`,
                "--chip-delay": `${index * 34}ms`,
              } as React.CSSProperties}
              aria-hidden="true"
            />
          );
        }),
      )}
    </>
  );
}

/**
 * A handful of chips flying from an acting seat to the pot. Renders as a
 * sibling of the seats (inside .poker-table-wrap, not .poker-felt) so the
 * felt's overflow:hidden never clips a seat that sits outside its oval --
 * the same reason the seats themselves live at that level. Self-removes
 * via `onDone` once its animation finishes, so no DOM nodes or timers
 * accumulate across a hand.
 */
export function ChipFlight({
  id,
  seatId,
  tableWrapRef,
  potRef,
  seatRefs,
  onDone,
}: {
  id: string;
  seatId: string;
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
    // Deliberately runs once on mount: this flight is a one-shot event keyed
    // by its own id, not something that reacts to later layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!layout) return null;

  return (
    <>
      {Array.from({ length: 3 }, (_, index) => (
        <span
          key={index}
          className={`seat-chip-flight chip-color-${index % 5}`}
          style={{
            left: `${layout.originX}px`,
            top: `${layout.originY}px`,
            "--flight-dx": `${layout.dx}px`,
            "--flight-dy": `${layout.dy}px`,
            "--flight-delay": `${index * 30}ms`,
          } as React.CSSProperties}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

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
