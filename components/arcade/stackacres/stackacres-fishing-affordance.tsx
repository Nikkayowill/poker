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
import { StackAcresIcon } from "./stackacres-icon";
import { isDragDrop } from "@/lib/stackacres/drag-affordance";
import { arrowGeometry } from "./stackacres-drag-affordance";
import type { TapPoint } from "./stackacres-scene";

/**
 * Fishing: the same pick-up-and-drop tool `StackAcresDragAffordance` gives
 * water and feed, played as a two-stage cast instead of a one-drop pour --
 * see this file's own state machine below. Its own component rather than a
 * third `DragAffordanceKind` there: a cast's phases (wait for a bite, then
 * reel against a second, opposite drag) don't fit that component's
 * single-drop `settle`/`springBack` shape.
 *
 * 1. Drag the rod onto the water. Dropped short, it springs back to try
 *    again -- same as the can or the scoop.
 * 2. Dropped on the spot, the line goes quiet (`waiting`, ungrabbable) for a
 *    beat, then the spot turns red (`biting`) and the rod can be picked up
 *    again.
 * 3. Drag it back OUT past the drop radius and let go: a catch, and
 *    `onCatch` fires. Letting go still over the spot just leaves it hooked,
 *    waiting for a real pull.
 */

export interface StackAcresFishingAffordanceProps {
  /** Where the rod rests before it is picked up. Pixels inside .sa-field. */
  iconAt: TapPoint;
  /** Where the cast has to land. Same pixel space. */
  targetAt: TapPoint;
  onCatch: () => void;
  onClose: () => void;
}

/** How long the catch splash plays before the overlay goes away. */
const SETTLE_MS = 560;
/** How long the spring back takes. Matches the token's CSS transition. */
const RETURN_MS = 260;
/** How long a line sits quiet before it can be reeled -- the "mini game"
 *  the whole overlay exists for, not a skill check: there is no way to miss
 *  it once it turns red, only a wait short enough to not feel like idling. */
const BITE_DELAY_MIN_MS = 700;
const BITE_DELAY_MAX_MS = 2000;

type Phase = "idle" | "dragging" | "waiting" | "biting" | "settling" | "returning";

export function StackAcresFishingAffordance({
  iconAt,
  targetAt,
  onCatch,
  onClose,
}: StackAcresFishingAffordanceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<HTMLButtonElement>(null);
  const grab = useRef({ left: 0, top: 0, dx: 0, dy: 0 });
  const timer = useRef<number | null>(null);
  /** Which state a press started from: the first cast (from `idle`) settles
   *  IN on a good drop, the reel (from `biting`) settles OUT on one -- the
   *  two gestures a plain `isDragDrop` check can't tell apart by itself. */
  const dragFrom = useRef<"idle" | "biting">("idle");
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

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const springBack = () => {
    setPhase("returning");
    setPos(iconAt);
    timer.current = window.setTimeout(() => setPhase("idle"), RETURN_MS);
  };

  /** A good first cast: the line goes quiet, then bites after a beat. */
  const hook = () => {
    setPos(targetAt);
    setPhase("waiting");
    const delay = BITE_DELAY_MIN_MS + Math.random() * (BITE_DELAY_MAX_MS - BITE_DELAY_MIN_MS);
    timer.current = window.setTimeout(() => setPhase("biting"), delay);
  };

  /** A good reel: the catch. */
  const land = (at: TapPoint) => {
    setPhase("settling");
    setPos(at);
    onCatch();
    timer.current = window.setTimeout(onClose, SETTLE_MS);
  };

  const pointerSpot = (event: ReactPointerEvent<HTMLButtonElement>): TapPoint => {
    const g = grab.current;
    return { x: event.clientX - g.left + g.dx, y: event.clientY - g.top + g.dy };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (phase !== "idle" && phase !== "biting") return;
    clearTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = rootRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    grab.current = { left, top, dx: pos.x - (event.clientX - left), dy: pos.y - (event.clientY - top) };
    dragFrom.current = phase;
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
    const onTarget = isDragDrop(at, targetAt);
    if (dragFrom.current === "idle") {
      if (onTarget) hook();
      else springBack();
      return;
    }
    // Reeling: a pull that cleared the spot lands the fish. Letting go
    // still over it just leaves the line hooked -- there is no failure
    // state here, only "not yet".
    if (!onTarget) land(at);
    else setPos(targetAt);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging") return;
    event.stopPropagation();
    if (dragFrom.current === "biting") setPos(targetAt);
    else springBack();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (phase === "idle") hook();
    else if (phase === "biting") land(targetAt);
  };

  const arrow = arrowGeometry(iconAt, targetAt);
  const tokenStyle = { "--x": `${pos.x}px`, "--y": `${pos.y}px` } as CSSProperties;
  const grabbable = phase === "idle" || phase === "biting" || phase === "dragging";
  const hint =
    phase === "waiting"
      ? "Something's circling..."
      : phase === "biting"
        ? "Drag it back out!"
        : "Drag onto the water";

  return (
    <div ref={rootRef} className={clsx("sa-fish", `is-${phase}`)}>
      <button
        type="button"
        className="sa-fish-scrim"
        aria-label="Reel in and put the rod down"
        onPointerDown={() => {
          scrimPressed.current = true;
        }}
        onClick={(event) => {
          if (scrimPressed.current || event.detail === 0) onClose();
        }}
      />
      {arrow && phase !== "waiting" && phase !== "biting" && (
        <svg className="sa-fish-arrow" aria-hidden="true">
          <path className="sa-fish-arrow-line" d={arrow.d} />
          <polygon className="sa-fish-arrow-head" points={arrow.head} />
        </svg>
      )}
      <span
        className={clsx("sa-fish-target", { "is-biting": phase === "biting" })}
        style={{ left: `${targetAt.x}px`, top: `${targetAt.y}px` }}
        aria-hidden="true"
      />
      {phase === "settling" && (
        <span className="sa-fish-burst" style={{ left: `${pos.x}px`, top: `${pos.y}px` }} aria-hidden="true">
          <span className="sa-fish-splash" />
        </span>
      )}
      <button
        ref={tokenRef}
        type="button"
        className="sa-fish-token"
        style={tokenStyle}
        aria-label={hint}
        disabled={!grabbable}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <StackAcresIcon name="ico-rod" size={32} />
      </button>
      {(phase === "idle" || phase === "returning" || phase === "waiting" || phase === "biting") && (
        <span className="sa-fish-hint" style={{ left: `${pos.x}px`, top: `${pos.y + 40}px` }} aria-hidden="true">
          {hint}
        </span>
      )}
    </div>
  );
}
