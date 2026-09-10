"use client";

import clsx from "clsx";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { isDragDrop } from "@/lib/stackacres/drag-affordance";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";
import type { TapPoint } from "./stackacres-scene";

/**
 * The dock that replaced both the ring's seed options and the old
 * bottom-docked seed strip inside the Crop Fields: a horizontally
 * scrollable row of "liquid gel" tokens, anchored at the tap rather than
 * glued to the screen edge, where nothing fires on a tap alone -- every
 * token has to be DRAGGED into the circle pinned on the tapped tile, same
 * physical gesture as the water can and the feed scoop
 * (stackacres-drag-affordance.tsx), just picked from a row of choices
 * instead of floating pre-chosen.
 *
 * What the row holds is entirely up to the caller (see stackacres-farm.tsx's
 * `cropFieldGelItems`): owned seeds to plant, the two-way Lay Pipe/Plant
 * Soil choice on bare ground, soil tiers once Plant Soil is picked, or the
 * management tokens (Aim, Draw Water, Remove) on a tile that already has
 * pipe or a bed. This component only knows how to lay a row out and turn a
 * drag on one of its items into that item's own `onCommit`.
 */

export interface StackAcresGelDockItem {
  key: string;
  label: string;
  icon: PainterName;
  /** Shown as a Gold price, e.g. laying a fresh pipe tile. */
  cost?: number;
  /** Shown as a plain "xN" count, e.g. seeds or soil bags on hand. */
  qty?: number;
  disabledReason?: string;
  /** True for a token that only swaps the row for another (Plant Soil's own
   *  tier choices, or arming/disarming Remove Bed's confirm) rather than
   *  finishing anything -- the dock stays open on the same tile instead of
   *  closing the way a terminal commit (planting, laying, removing) does. */
  keepOpen?: boolean;
  onCommit: () => void;
}

export interface StackAcresGelDockProps {
  /** Where the finger landed, in pixels inside .sa-field -- also where the
   *  completion circle is pinned, since the tapped tile is always the drop
   *  target: there is nowhere else for any of these tokens to go. */
  at: TapPoint;
  items: readonly StackAcresGelDockItem[];
  label: string;
  busy: boolean;
  onClose: () => void;
  /** "There is more to this district than this one tile" -- offered only
   *  when `items` is empty (e.g. a bed with no seed on hand), same handoff
   *  to the sidebar the old ring/strip both gave. */
  onManage?: () => void;
}

/** How long the settle pulse plays before the dock closes on its own. */
const SETTLE_MS = 420;
/** How long a missed drop takes springing back to its row slot. */
const RETURN_MS = 220;
/** How far above (or, flipped, below) the tap the row sits -- clear of the
 *  circle pinned on the tap itself, the same spirit as the radial ring's own
 *  RADIUS but a straight offset rather than an arc. */
const ROW_OFFSET = 92;
/** Mirrors StackAcresRadialMenu's own HEADROOM/SIDE_ROOM: how much room the
 *  row needs before it has to flip below the tap or nudge off an edge. */
const HEADROOM = 150;
const SIDE_ROOM = 150;

type Phase = "idle" | "dragging" | "returning" | "settling";

export function StackAcresGelDock({ at, items, label, busy, onClose, onManage }: StackAcresGelDockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const timer = useRef<number | null>(null);
  const homeClient = useRef<TapPoint>({ x: 0, y: 0 });
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragClient, setDragClient] = useState<TapPoint>({ x: 0, y: 0 });
  const [phase, setPhase] = useState<Phase>("idle");
  // Whether the live token is over the circle right now -- read from
  // `rootRef` inside the pointer handlers below and mirrored into state
  // rather than recomputed at render time: a ref is only safe to read
  // outside render (an event handler or an effect), never in the render body
  // itself.
  const [isHot, setIsHot] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Re-focuses the first token whenever the SET of tokens changes, not just
  // on mount -- a `keepOpen` commit (Plant Soil swapping in its tiers)
  // replaces every item in place without unmounting this component, and a
  // keyboard user needs focus to land on the new row exactly the way it did
  // on the first one.
  const itemsSignature = items.map((item) => item.key).join("|");
  useEffect(() => {
    const timeout = window.setTimeout(() => firstRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [itemsSignature]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  /** The circle's own position, in client (viewport) pixels -- the same
   *  space the row's tokens already drag in, so a drop check never has to
   *  cross coordinate systems. */
  const targetClient = (): TapPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: (rect?.left ?? 0) + at.x, y: (rect?.top ?? 0) + at.y };
  };

  const commit = (item: StackAcresGelDockItem) => {
    setPhase("settling");
    item.onCommit();
    timer.current = window.setTimeout(() => {
      if (item.keepOpen) {
        setPhase("idle");
        setDragKey(null);
      } else {
        onClose();
      }
    }, SETTLE_MS);
  };

  const springBack = () => {
    setPhase("returning");
    setDragClient(homeClient.current);
    setIsHot(false);
    timer.current = window.setTimeout(() => {
      setPhase("idle");
      setDragKey(null);
    }, RETURN_MS);
  };

  const onTokenPointerDown = (item: StackAcresGelDockItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (phase === "settling" || busy || item.disabledReason) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    homeClient.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setDragKey(item.key);
    setDragClient({ x: event.clientX, y: event.clientY });
    setPhase("dragging");
  };

  const onTokenPointerMove = (item: StackAcresGelDockItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging" || dragKey !== item.key) return;
    event.stopPropagation();
    const at = { x: event.clientX, y: event.clientY };
    setDragClient(at);
    setIsHot(isDragDrop(at, targetClient()));
  };

  const onTokenPointerUp = (item: StackAcresGelDockItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging" || dragKey !== item.key) return;
    event.stopPropagation();
    setIsHot(false);
    if (isDragDrop({ x: event.clientX, y: event.clientY }, targetClient())) commit(item);
    else springBack();
  };

  const onTokenPointerCancel = (item: StackAcresGelDockItem, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (phase !== "dragging" || dragKey !== item.key) return;
    event.stopPropagation();
    springBack();
  };

  const onTokenKeyDown = (item: StackAcresGelDockItem, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(item);
    }
  };

  const flip = at.y < HEADROOM;
  const nudgeX = Math.max(0, SIDE_ROOM - at.x) - Math.max(0, at.x + SIDE_ROOM - viewportWidth);
  const rowTop = at.y + (flip ? ROW_OFFSET : -ROW_OFFSET);

  return (
    <div ref={rootRef} className="sa-gel">
      <span className="sa-gel-pin" style={{ left: `${at.x}px`, top: `${at.y}px` }} aria-hidden="true" />
      <span
        className={clsx("sa-gel-target", { "is-hot": isHot, "is-settling": phase === "settling" })}
        style={{ left: `${at.x}px`, top: `${at.y}px` }}
        aria-hidden="true"
      />
      <div
        className="sa-gel-row"
        role="group"
        aria-label={label}
        style={{ left: `${at.x + nudgeX}px`, top: `${rowTop}px` }}
      >
        <button type="button" className="sa-gel-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        {items.length === 0 ? (
          <div className="sa-gel-empty">
            <p>Nothing on hand.</p>
            {onManage && (
              <button type="button" className="sa-cta" ref={firstRef} onClick={onManage}>
                Visit Ray&apos;s shop
              </button>
            )}
          </div>
        ) : (
          items.map((item, index) => {
            const live = dragKey === item.key && phase !== "idle";
            const disabled = busy || Boolean(item.disabledReason);
            return (
              <button
                key={item.key}
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className={clsx("sa-gel-token", {
                  "is-live": live,
                  "is-returning": live && phase === "returning",
                })}
                style={live ? { left: `${dragClient.x}px`, top: `${dragClient.y}px` } : undefined}
                disabled={disabled}
                title={item.disabledReason}
                onPointerDown={(event) => onTokenPointerDown(item, event)}
                onPointerMove={(event) => onTokenPointerMove(item, event)}
                onPointerUp={(event) => onTokenPointerUp(item, event)}
                onPointerCancel={(event) => onTokenPointerCancel(item, event)}
                onKeyDown={(event) => onTokenKeyDown(item, event)}
              >
                <StackAcresIcon name={item.icon} size={24} />
                <span className="sa-gel-name">{item.label}</span>
                {typeof item.cost === "number" && (
                  <span className="sa-gel-cost">
                    <StackAcresIcon name="ico-gold" size={12} />
                    {item.cost.toLocaleString()}
                  </span>
                )}
                {typeof item.qty === "number" && <span className="sa-gel-qty">×{item.qty}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
