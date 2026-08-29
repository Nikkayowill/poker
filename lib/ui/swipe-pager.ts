/**
 * The gesture maths behind the lobby's swipeable panes, kept pure so it can be
 * tested without a DOM or a pointer.
 *
 * Four rules, and each one exists because the obvious version is wrong:
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
 * 3. A DISTANCE THRESHOLD. `SETTLE_FRACTION` of the pane width commits the
 *    turn on its own, independent of speed.
 * 4. A VELOCITY OVERRIDE. A fast flick commits the turn even short of the
 *    distance threshold, same as rule 3 said this needed a timestamp per move
 *    event that the lobby had no clock to produce — but the pointer events
 *    already carry one (`PointerEvent.timeStamp`), so the caller just has to
 *    pass it through; no polling loop required.
 */

/** Which way a gesture has committed. `undecided` until it passes the lock. */
export type SwipeAxis = "undecided" | "horizontal" | "vertical";

export interface SwipeGesture {
  readonly startX: number;
  readonly startY: number;
  /** Pane width in px, captured at press so a resize mid-drag cannot skew it. */
  readonly width: number;
  readonly axis: SwipeAxis;
  /** Position/time of the most recent sample, for the velocity at release. */
  readonly lastX: number;
  readonly lastTime: number;
}

/** Movement needed before either axis claims the gesture. */
export const AXIS_LOCK_PX = 7;

/** Fraction of a pane width that commits a turn on release. */
export const SETTLE_FRACTION = 0.16;

/** How much of an over-drag past the ends actually moves. */
export const EDGE_RESISTANCE = 0.3;

/**
 * px/ms at or above which a flick commits the turn regardless of distance.
 * ~550px/s — comfortably past ordinary drag speed, well below a hard flick.
 */
export const FLICK_VELOCITY_PX_MS = 0.55;

export function beginSwipe(
  startX: number,
  startY: number,
  width: number,
  time = 0,
): SwipeGesture {
  return {
    startX,
    startY,
    width: width > 0 ? width : 1,
    axis: "undecided",
    lastX: startX,
    lastTime: time,
  };
}

export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(pageCount - 1, Math.max(0, page));
}

export interface SwipeMove {
  readonly gesture: SwipeGesture;
  /** Px to offset the track by, or null while the gesture is not horizontal. */
  readonly offset: number | null;
  /**
   * Signed px/ms since the previous sample (0 while not horizontal). Reflects
   * the most recent movement, not the whole gesture, so a drag that pauses and
   * then flicks is judged on the flick.
   */
  readonly velocity: number;
}

/**
 * Feed a pointer position in. Returns the (possibly newly axis-locked) gesture
 * and the offset the track should paint at. `time` should be the originating
 * event's `timeStamp`; omit it only in tests that don't care about velocity.
 */
export function trackSwipe(
  gesture: SwipeGesture,
  x: number,
  y: number,
  page: number,
  pageCount: number,
  time = gesture.lastTime,
): SwipeMove {
  const dx = x - gesture.startX;
  const dy = y - gesture.startY;

  let axis = gesture.axis;
  if (axis === "undecided") {
    if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) {
      return { gesture, offset: null, velocity: 0 };
    }
    axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
  }

  const dt = Math.max(1, time - gesture.lastTime);
  const velocity = axis === "horizontal" ? (x - gesture.lastX) / dt : 0;
  const moved: SwipeGesture = { ...gesture, axis, lastX: x, lastTime: time };
  if (axis !== "horizontal") return { gesture: moved, offset: null, velocity };

  const atStart = page <= 0 && dx > 0;
  const atEnd = page >= pageCount - 1 && dx < 0;
  return {
    gesture: moved,
    offset: atStart || atEnd ? dx * EDGE_RESISTANCE : dx,
    velocity,
  };
}

/**
 * Where the track lands when the finger lifts. A vertical or undecided gesture
 * never turns a page, so it always returns the page it started on. `velocity`
 * is the signed px/ms at release (see `SwipeMove.velocity`) — a flick at or
 * past `FLICK_VELOCITY_PX_MS` commits the turn even short of the distance
 * threshold, as long as the drag is already moving that way (a flick back
 * against an over-threshold drag must not un-commit it).
 */
export function settleSwipe(
  gesture: SwipeGesture,
  offset: number,
  page: number,
  pageCount: number,
  velocity = 0,
): number {
  if (gesture.axis !== "horizontal") return clampPage(page, pageCount);
  const threshold = gesture.width * SETTLE_FRACTION;
  const flingingNext = velocity <= -FLICK_VELOCITY_PX_MS && offset < 0;
  const flingingPrev = velocity >= FLICK_VELOCITY_PX_MS && offset > 0;
  if (offset <= -threshold || flingingNext) return clampPage(page + 1, pageCount);
  if (offset >= threshold || flingingPrev) return clampPage(page - 1, pageCount);
  return clampPage(page, pageCount);
}
