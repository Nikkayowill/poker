/**
 * The gesture maths behind the lobby's swipeable panes, kept pure so it can be
 * tested without a DOM or a pointer.
 *
 * Three rules, and each one exists because the obvious version is wrong:
 *
 * 1. AXIS LOCK. A pane scrolls vertically and the track scrolls horizontally,
 *    on the same finger. Whichever axis moves further first wins the whole
 *    gesture; the other is ignored until the finger lifts. Without the lock a
 *    diagonal drag both scrolls the list and drags the page, which reads as the
 *    screen coming apart.
 * 2. EDGE RESISTANCE. Dragging past the first or last pane still moves, at
 *    `EDGE_RESISTANCE` of the distance. A hard stop reads as a broken gesture;
 *    a rubber band reads as an edge. It never changes page, so the resistance
 *    is cosmetic by construction.
 * 3. A DISTANCE THRESHOLD, not a velocity one. `SETTLE_FRACTION` of the pane
 *    width commits the turn. Velocity would be better on a real phone and is
 *    deliberately not here: it needs a timestamp per move event, and this app
 *    has no frame clock on the lobby to sample against.
 */

/** Which way a gesture has committed. `undecided` until it passes the lock. */
export type SwipeAxis = "undecided" | "horizontal" | "vertical";

export interface SwipeGesture {
  readonly startX: number;
  readonly startY: number;
  /** Pane width in px, captured at press so a resize mid-drag cannot skew it. */
  readonly width: number;
  readonly axis: SwipeAxis;
}

/** Movement needed before either axis claims the gesture. */
export const AXIS_LOCK_PX = 7;

/** Fraction of a pane width that commits a turn on release. */
export const SETTLE_FRACTION = 0.16;

/** How much of an over-drag past the ends actually moves. */
export const EDGE_RESISTANCE = 0.3;

export function beginSwipe(startX: number, startY: number, width: number): SwipeGesture {
  return { startX, startY, width: width > 0 ? width : 1, axis: "undecided" };
}

export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(pageCount - 1, Math.max(0, page));
}

export interface SwipeMove {
  readonly gesture: SwipeGesture;
  /** Px to offset the track by, or null while the gesture is not horizontal. */
  readonly offset: number | null;
}

/**
 * Feed a pointer position in. Returns the (possibly newly axis-locked) gesture
 * and the offset the track should paint at.
 */
export function trackSwipe(
  gesture: SwipeGesture,
  x: number,
  y: number,
  page: number,
  pageCount: number,
): SwipeMove {
  const dx = x - gesture.startX;
  const dy = y - gesture.startY;

  let axis = gesture.axis;
  if (axis === "undecided") {
    if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) {
      return { gesture, offset: null };
    }
    axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
  }

  const moved: SwipeGesture = axis === gesture.axis ? gesture : { ...gesture, axis };
  if (axis !== "horizontal") return { gesture: moved, offset: null };

  const atStart = page <= 0 && dx > 0;
  const atEnd = page >= pageCount - 1 && dx < 0;
  return { gesture: moved, offset: atStart || atEnd ? dx * EDGE_RESISTANCE : dx };
}

/**
 * Where the track lands when the finger lifts. A vertical or undecided gesture
 * never turns a page, so it always returns the page it started on.
 */
export function settleSwipe(
  gesture: SwipeGesture,
  offset: number,
  page: number,
  pageCount: number,
): number {
  if (gesture.axis !== "horizontal") return clampPage(page, pageCount);
  const threshold = gesture.width * SETTLE_FRACTION;
  if (offset <= -threshold) return clampPage(page + 1, pageCount);
  if (offset >= threshold) return clampPage(page - 1, pageCount);
  return clampPage(page, pageCount);
}
