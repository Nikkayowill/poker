"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { STACKACRES_SELECTABLE_TOOLS, STACKACRES_TOOL_DEFS, type StackAcresTool } from "@/lib/stackacres/tools";
import type { PainterName } from "./stackacres-art";
import { StackAcresIcon } from "./stackacres-icon";

/**
 * The dock: Scythe/Pipe/Soil are still click-to-hold, then a drag across the
 * ground lays or lifts a run of them -- see lib/stackacres/tools.ts's own
 * header. Water/Feed/Harvest are NOT (2026-09-10): the old "hold the tool,
 * then tap or drag across the field" gesture read as unpredictable in
 * practice -- whether a stroke acted at all was decided at the exact pixel
 * the finger first pressed, so landing a hair off a unit's own hitbox
 * silently turned the same gesture into a camera pan instead, with nothing
 * telling the player why nothing happened. These three are pick-up-and-drop
 * instead, the way FarmVille's own watering can works: press the icon,
 * drag it (a ghost follows the finger), and release it ON a unit that tool
 * can act on. The hit-test only ever runs once, at the drop -- there is no
 * press-time guess left to be wrong about, which is what makes this
 * predictable where the old one wasn't. A plain tap or click on one of
 * these three buttons, with no drag, does nothing at all; there is no
 * "held" state for them any more; the drag IS the whole gesture.
 *
 * Look is gone as a button (2026-09-09) -- it is `"inspect"`, the resting
 * state a session starts in and none of the three click-to-hold tools ever
 * leave for good: pressing whichever one is already held drops back to it,
 * since with no Look button left there would otherwise be no way to let go
 * of a tool at all. `STACKACRES_SELECTABLE_TOOLS` is the six below;
 * `inspect` stays a real `StackAcresTool` value, just not one of them.
 */

/** Which three tools are picked up and dropped rather than clicked and
 *  held -- see this file's own header. */
const DRAG_TOOLS: ReadonlySet<StackAcresTool> = new Set(["water", "feed", "harvest"]);

type DragToolId = "water" | "feed" | "harvest";

function isDragTool(id: StackAcresTool): id is DragToolId {
  return DRAG_TOOLS.has(id);
}

export interface StackAcresToolbeltProps {
  tool: StackAcresTool;
  onPick: (tool: StackAcresTool) => void;
  /**
   * A Water/Feed/Harvest drag was released at this client point. Returns
   * whether it actually landed on a unit that tool could touch -- a miss
   * (bare ground, the wrong kind of unit) springs the ghost back to the dock
   * instead of just vanishing, so a drop that did nothing reads as declined
   * rather than as the app eating the gesture.
   */
  onToolDrop: (tool: DragToolId, clientX: number, clientY: number) => boolean;
  /** Fired whenever a Water/Feed/Harvest drag starts or ends, so the shell
   *  can swap the hint line under the dock to match what is actually in
   *  hand -- there is no persisted `tool` state for these three any more
   *  for it to read instead. `null` once the drag ends, whether by a hit, a
   *  miss, or a cancel. Never fired for a bare position update mid-drag. */
  onDragToolChange?: (tool: DragToolId | null) => void;
}

interface DragState {
  tool: DragToolId;
  x: number;
  y: number;
  /** Set for the brief spring-back after a drop missed every unit -- see
   *  `.sa-tool-ghost-reject` in 52-stackacres.css. */
  rejected: boolean;
}

const REJECT_SPRING_MS = 160;

export function StackAcresToolbelt({ tool, onPick, onToolDrop, onDragToolChange }: StackAcresToolbeltProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  // Read inside pointer handlers instead of `drag` itself: those fire faster
  // than React re-renders, and a stale closure over `drag` would drop moves
  // that land between two renders.
  const dragRef = useRef<DragState | null>(null);

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Already released.
      }
      const active = dragRef.current;
      dragRef.current = null;
      if (!active) return;
      onDragToolChange?.(null);
      const hit = onToolDrop(active.tool, event.clientX, event.clientY);
      if (hit) {
        setDrag(null);
        return;
      }
      setDrag({ ...active, rejected: true });
      window.setTimeout(() => setDrag(null), REJECT_SPRING_MS);
    },
    [onToolDrop, onDragToolChange],
  );

  return (
    <div className="sa-toolbelt" role="radiogroup" aria-label="Toolbelt">
      {STACKACRES_SELECTABLE_TOOLS.map((id) => {
        const def = STACKACRES_TOOL_DEFS[id];
        if (!isDragTool(id)) {
          const held = tool === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={held}
              className={clsx("sa-tool", { "is-held": held })}
              aria-label={def.label}
              onClick={() => onPick(held ? "inspect" : id)}
            >
              <StackAcresIcon name={def.icon as PainterName} size={22} />
              <span className="sa-tool-label">{def.label}</span>
            </button>
          );
        }
        const held = drag?.tool === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={held}
            className={clsx("sa-tool", "sa-tool-drag", { "is-held": held })}
            aria-label={def.label}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const next: DragState = { tool: id, x: event.clientX, y: event.clientY, rejected: false };
              dragRef.current = next;
              setDrag(next);
              onDragToolChange?.(id);
            }}
            onPointerMove={(event) => {
              if (dragRef.current?.tool !== id) return;
              const next = { ...dragRef.current, x: event.clientX, y: event.clientY };
              dragRef.current = next;
              setDrag(next);
            }}
            onPointerUp={endDrag}
            onPointerCancel={() => {
              dragRef.current = null;
              setDrag(null);
              onDragToolChange?.(null);
            }}
          >
            <StackAcresIcon name={def.icon as PainterName} size={22} />
            <span className="sa-tool-label">{def.label}</span>
          </button>
        );
      })}
      {drag && (
        <div
          className={clsx("sa-tool-ghost", { "sa-tool-ghost-reject": drag.rejected })}
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <StackAcresIcon name={STACKACRES_TOOL_DEFS[drag.tool].icon as PainterName} size={28} />
        </div>
      )}
    </div>
  );
}
