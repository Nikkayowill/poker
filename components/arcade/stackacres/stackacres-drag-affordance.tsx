"use client";

import clsx from "clsx";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";
import { isDragDrop } from "@/lib/stackacres/drag-affordance";
import type { TapPoint } from "./stackacres-scene";

/**
 * A tool you pick up and drop on the thing that needs it.
 *
 * Tapping a dry crop or a hungry pen floats a glass token next to it, with a
 * curved arrow pointing at the target. Dragging the token onto the target
 * does the job and plays a short pour or scatter. Letting go anywhere else
 * springs it back so the player can try again.
 *
 * Enter or Space on the focused token counts as a drop, so a keyboard can
 * still do everything a finger can.
 */

export type DragAffordanceKind = "water" | "feed";

export interface StackAcresDragAffordanceProps {
  kind: DragAffordanceKind;
  /** Where the token rests before it is picked up. Pixels inside .sa-field. */
  iconAt: TapPoint;
  /** Where it has to land. Same pixel space. */
  targetAt: TapPoint;
  /** One short line under the token, and its accessible name. */
  hint: string;
  onDrop: () => void;
  onClose: () => void;
}

const ICONS: Readonly<Record<DragAffordanceKind, PainterName>> = {
  water: "ico-water",
  feed: "ico-feed",
};

/** How long the pour or scatter plays before the overlay goes away. */
const SETTLE_MS = 620;
/** How long the spring back takes. Matches the token's CSS transition. */
const RETURN_MS = 260;
/** The pour or scatter: where each drop or grain lands relative to the target, and when it leaves. */
const PARTICLES: readonly { dx: number; dy: number; delay: number }[] = [
  { dx: -22, dy: 18, delay: 0 },
  { dx: -10, dy: 26, delay: 40 },
  { dx: 2, dy: 22, delay: 20 },
  { dx: 14, dy: 28, delay: 70 },
  { dx: 24, dy: 16, delay: 30 },
  { dx: -4, dy: 34, delay: 110 },
  { dx: 10, dy: 12, delay: 90 },
];

type Phase = "idle" | "dragging" | "returning" | "settling";

/**
 * The arrow from the token to the target, bowed upward so it reads as a
 * throw rather than a ruler line. Both ends are pulled in so the token and
 * the target ring sit over clean ends instead of over the line.
 */
function arrowGeometry(from: TapPoint, to: TapPoint): { d: string; head: string } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 70) return null;
  const bow = Math.min(64, len * 0.35);
  let nx = (-dy / len) * bow;
  let ny = (dx / len) * bow;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (from.x + to.x) / 2 + nx;
  const cy = (from.y + to.y) / 2 + ny;
  const startDir = Math.atan2(cy - from.y, cx - from.x);
  const endDir = Math.atan2(to.y - cy, to.x - cx);
  const sx = from.x + Math.cos(startDir) * 34;
  const sy = from.y + Math.sin(startDir) * 34;
  const ex = to.x - Math.cos(endDir) * 30;
  const ey = to.y - Math.sin(endDir) * 30;
  const wing = 9;
  const back = 12;
  const bx = ex - Math.cos(endDir) * back;
  const by = ey - Math.sin(endDir) * back;
  const head = [
    `${ex},${ey}`,
    `${bx + Math.cos(endDir + Math.PI / 2) * wing},${by + Math.sin(endDir + Math.PI / 2) * wing}`,
    `${bx + Math.cos(endDir - Math.PI / 2) * wing},${by + Math.sin(endDir - Math.PI / 2) * wing}`,
  ].join(" ");
  return { d: `M ${sx} ${sy} Q ${cx} ${cy} ${bx} ${by}`, head };
}

export function StackAcresDragAffordance({
  kind,
  iconAt,
  targetAt,
  hint,
  onDrop,
  onClose,
}: StackAcresDragAffordanceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLButtonElement>(null);
  const grab = useRef({ left: 0, top: 0, dx: 0, dy: 0 });
  const timer = useRef<number | null>(null);
  /** Set by a press that starts on the scrim, so only a click that began
   *  there closes it. See the scrim below. */
  const scrimPressed = useRef(false);
  const [pos, setPos] = useState<TapPoint>(iconAt);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    tokenRef.current?.focus({ preventScroll: true });
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const settle = () => {
    if (phase === "settling") return;
    setPhase("settling");
    setPos(targetAt);
    onDrop();
    timer.current = window.setTimeout(onClose, SETTLE_MS);
  };

  const springBack = () => {
    setPhase("returning");
    setPos(iconAt);
    timer.current = window.setTimeout(() => setPhase("idle"), RETURN_MS);
  };

  /** Where the pointer puts the token, in field pixels. */
  const pointerSpot = (event: ReactPointerEvent<HTMLButtonElement>): TapPoint => {
    const g = grab.current;
    return { x: event.clientX - g.left + g.dx, y: event.clientY - g.top + g.dy };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (phase === "settling") return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rootRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    // Keep the grab point under the finger instead of snapping the token's
    // centre to it.
    grab.current = { left, top, dx: pos.x - (event.clientX - left), dy: pos.y - (event.clientY - top) };
    setPhase("dragging");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging") return;
    event.stopPropagation();
    setPos(pointerSpot(event));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging") return;
    event.stopPropagation();
    const at = pointerSpot(event);
    if (isDragDrop(at, targetAt)) settle();
    else springBack();
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging") return;
    event.stopPropagation();
    springBack();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      settle();
    }
  };

  const near = phase === "dragging" && isDragDrop(pos, targetAt);
  const arrow = arrowGeometry(iconAt, targetAt);
  const tokenStyle = { "--x": `${pos.x}px`, "--y": `${pos.y}px` } as CSSProperties;

  return (
    <div ref={rootRef} className={clsx("sa-drag", `is-${kind}`, `is-${phase}`)}>
      {/* A click closes this only if the press also started here, or if it
          came from a keyboard (detail 0). The tap that opened the overlay is
          followed by a synthetic click that lands here with no press of its
          own; on a phone that click used to shut the can the instant it
          appeared. The scrim stays up to swallow it, so it can't fall through
          to a button underneath either. */}
      <button
        type="button"
        className="sa-drag-scrim"
        aria-label="Put it down"
        onPointerDown={() => {
          scrimPressed.current = true;
        }}
        onClick={(event) => {
          if (scrimPressed.current || event.detail === 0) onClose();
        }}
      />
      {arrow && (
        <svg className="sa-drag-arrow" aria-hidden="true">
          <path className="sa-drag-arrow-line" d={arrow.d} />
          <polygon className="sa-drag-arrow-head" points={arrow.head} />
        </svg>
      )}
      <span
        className={clsx("sa-drag-target", { "is-hot": near })}
        style={{ left: `${targetAt.x}px`, top: `${targetAt.y}px` }}
        aria-hidden="true"
      />
      {phase === "settling" && (
        <span className="sa-drag-burst" style={{ left: `${targetAt.x}px`, top: `${targetAt.y}px` }} aria-hidden="true">
          <span className="sa-drag-splash" />
          {PARTICLES.map((p, index) => (
            <i
              key={index}
              style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--d": `${p.delay}ms` } as CSSProperties}
            />
          ))}
        </span>
      )}
      <button
        ref={tokenRef}
        type="button"
        className="sa-drag-token"
        style={tokenStyle}
        aria-label={hint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <StackAcresIcon name={ICONS[kind]} size={30} />
      </button>
      {(phase === "idle" || phase === "returning") && (
        <span className="sa-drag-hint" style={{ left: `${iconAt.x}px`, top: `${iconAt.y + 38}px` }} aria-hidden="true">
          {hint}
        </span>
      )}
    </div>
  );
}
