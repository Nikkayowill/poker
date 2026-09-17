/**
 * Where a drag tool floats before it is picked up, what counts as a drop, and
 * the bowed arrow that points from one to the other.
 *
 * Only the fishing cast still uses any of this. The water can, the feed scoop
 * and the harvest basket were drag tools too until the tool belt replaced them
 * (lib/stackacres/toolbelt.ts): a belt tool is used where the farmer stands, so
 * there is nothing left to drag anywhere.
 *
 * Pure so vitest can reach it. The overlay that draws the cast is
 * components/arcade/stackacres/stackacres-fishing-affordance.tsx.
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

/** How far a press has to travel before it is anything but a press, in CSS
 *  pixels. */
export const GESTURE_SLOP = 8;

/**
 * How much more sideways than vertical a move has to be before it counts as
 * browsing a scrollable row rather than pulling a token out of it.
 *
 * The gel dock used to demand a move steeper than 45 degrees, because its row
 * was scrolled by the BROWSER (`touch-action: pan-x`) and a touch the browser
 * has claimed for a pan cannot be handed back. Two problems with a thumb: the
 * dock's drop circle sits above the MIDDLE of the row, so dragging a token at
 * either end of it toward the circle is a roughly 40-degree reach that the old
 * test read as a scroll and refused to pick up; and a finger's idea of
 * "straight up" is looser than a mouse's. The row scrolls under the dock's own
 * hand now, so the split is ours to pick: clearly sideways -- past about 30
 * degrees off horizontal -- browses, and anything with real vertical intent in
 * it drags.
 */
export const BROWSE_BIAS = 1.7;

/** What a press on a row token has turned into. */
export type RowGesture = "press" | "browse" | "drag";

/**
 * What a move of (`dx`, `dy`) off the press point means for a token in a row
 * that can (`scrollable`) or cannot be scrolled sideways.
 *
 * A row with nothing to scroll never browses: there is only one thing a
 * finger on a token in it can mean.
 */
export function rowGesture(
  move: { dx: number; dy: number },
  options: { scrollable: boolean },
): RowGesture {
  if (Math.hypot(move.dx, move.dy) < GESTURE_SLOP) return "press";
  if (!options.scrollable) return "drag";
  return Math.abs(move.dx) > Math.abs(move.dy) * BROWSE_BIAS ? "browse" : "drag";
}

/**
 * The arrow from the token to the target, bowed upward so it reads as a
 * throw rather than a ruler line. Both ends are pulled in so the token and
 * the target ring sit over clean ends instead of over the line.
 */
export function arrowGeometry(from: FieldPoint, to: FieldPoint): { d: string; head: string } | null {
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
