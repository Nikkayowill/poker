/**
 * Where a drag tool floats before it is picked up, and what counts as a drop.
 *
 * Pure so vitest can reach it. The component that draws the tool is
 * components/arcade/stackacres/stackacres-drag-affordance.tsx.
 */

export interface FieldPoint {
  x: number;
  y: number;
}

/** How far off the tap the token floats, in CSS pixels. Up and to the right
 *  by default, so the thumb that tapped does not cover it. */
export const DRAG_ICON_OFFSET = { x: 64, y: -76 } as const;

/** Keep the token this far inside the field's edges. */
export const DRAG_ICON_EDGE = 40;

/** How close to the target counts as a drop, in CSS pixels. */
export const DRAG_DROP_RADIUS = 46;

/** Where to float the token for a tap at `anchor`, kept inside the field.
 *  Flips to the left or below when the default spot would fall off an edge. */
export function dragIconSpot(anchor: FieldPoint, bounds: { width: number; height: number }): FieldPoint {
  let x = anchor.x + DRAG_ICON_OFFSET.x;
  let y = anchor.y + DRAG_ICON_OFFSET.y;
  if (x > bounds.width - DRAG_ICON_EDGE) x = anchor.x - DRAG_ICON_OFFSET.x;
  if (y < DRAG_ICON_EDGE) y = anchor.y - DRAG_ICON_OFFSET.y;
  return {
    x: Math.min(Math.max(x, DRAG_ICON_EDGE), Math.max(DRAG_ICON_EDGE, bounds.width - DRAG_ICON_EDGE)),
    y: Math.min(Math.max(y, DRAG_ICON_EDGE), Math.max(DRAG_ICON_EDGE, bounds.height - DRAG_ICON_EDGE)),
  };
}

/** Whether a token let go at `at` lands on `target`. */
export function isDragDrop(at: FieldPoint, target: FieldPoint): boolean {
  return Math.hypot(at.x - target.x, at.y - target.y) <= DRAG_DROP_RADIUS;
}
