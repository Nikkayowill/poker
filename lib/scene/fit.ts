/**
 * Making the WebGL room agree with the DOM table drawn over it.
 *
 * The camera is fixed by the spec -- position, target and field of view are
 * not adjustable, because the whole look depends on that one tilt. But the
 * DOM table is not fixed: `.poker-table-wrap` is capped by leftover height as
 * well as by width, so the same viewport can hand it a wide plate or a tall
 * one depending on what the header and action bar took. A room built at one
 * fixed world size would therefore line up at exactly one breakpoint and be
 * visibly wrong at every other, with the felt's painted edge sitting inside
 * or outside the seats ringing it.
 *
 * Since the camera cannot move, the room is scaled instead. That is the same
 * transformation as dollying the camera, without touching the projection the
 * composition depends on.
 *
 * The solve lives here, pure and testable, taking the projection as a
 * callback -- `three`'s matrices stay in the renderer where they belong, and
 * this file can be exercised against an analytic stand-in.
 */

/**
 * Bounds on the search.
 *
 * The lower bound is a room a fifth of nominal size, the upper a room three
 * times it; anything outside that is a broken measurement (a zero-width box
 * during layout, a detached canvas) rather than a table, and clamping is a
 * better failure than a scale of 40 putting the felt through the camera.
 */
export const MIN_ROOM_SCALE = 0.2;
export const MAX_ROOM_SCALE = 3;

/** Stop when the projected width is within this many pixels of the target. */
const TOLERANCE_PX = 0.5;

/**
 * Enough halvings to resolve the bracket to well under a pixel, and a hard
 * stop so a non-monotonic projector -- which would mean the camera is inside
 * the table -- cannot spin here.
 */
const MAX_ITERATIONS = 24;

/**
 * The room scale whose felt projects to `targetPx` across.
 *
 * Bisection rather than an algebraic inverse. The projected width of an
 * ellipse under a perspective camera looking down at it is not a function
 * anyone should be inverting by hand -- the near and far edges foreshorten by
 * different amounts, so the widest point is not on the ellipse's own major
 * axis -- but it is strictly increasing in scale, which is the only property
 * bisection needs and the one property that is obviously true.
 */
export function solveRoomScale(
  projectedWidthAt: (scale: number) => number,
  targetPx: number,
): number {
  if (!Number.isFinite(targetPx) || targetPx <= 0) return 1;
  return solveMonotonic(projectedWidthAt, targetPx, MIN_ROOM_SCALE, MAX_ROOM_SCALE, 1);
}

/**
 * How far the room has to be lifted for its ring to sit where the DOM's does.
 *
 * The second half of the fit, and the one that decides whether Layer C can
 * ever be turned on. Scaling alone matches the *size* of the projected seat
 * ring; it cannot move it, and the 3D ring lands lower in frame than the DOM
 * ellipse does -- measured at 1440x900, the near seat projected to y = 758
 * while the DOM avatar sitting in that chair was centred at y = 640. A
 * hundred pixels is the difference between a sprite in a chair and a sprite
 * standing behind one.
 *
 * Solved as a world-space Y translation rather than by moving the camera,
 * because the camera is the composition and is fixed by the spec. Lifting the
 * room lifts the floor with it, which is invisible: there is no horizon in
 * frame, only fog.
 *
 * Screen Y grows downward while world Y grows up, so this is monotonically
 * *decreasing* -- which `solveMonotonic` detects rather than assumes.
 */
export const MIN_ROOM_LIFT = -8;
export const MAX_ROOM_LIFT = 8;

export function solveRoomLift(
  projectedCentreYAt: (lift: number) => number,
  targetPx: number,
): number {
  if (!Number.isFinite(targetPx)) return 0;
  return solveMonotonic(projectedCentreYAt, targetPx, MIN_ROOM_LIFT, MAX_ROOM_LIFT, 0);
}

/**
 * Bisection on a function known to be monotonic, in either direction.
 *
 * Bisection rather than an algebraic inverse, for both solves. Neither
 * quantity is something anyone should be inverting by hand -- the projected
 * width of an ellipse under a camera looking down at it is not maximised on
 * the ellipse's own major axis, because the near and far edges foreshorten by
 * different amounts -- but both are strictly monotonic, which is the only
 * property bisection needs and the one that is obviously true.
 */
function solveMonotonic(
  f: (x: number) => number,
  target: number,
  low: number,
  high: number,
  fallback: number,
): number {
  const atLow = f(low);
  const atHigh = f(high);
  if (!Number.isFinite(atLow) || !Number.isFinite(atHigh)) return fallback;

  const ascending = atHigh > atLow;
  // A target outside what the room can reach at all: clamp rather than
  // converge onto a bound and pretend it was a solution.
  if (ascending ? atLow >= target : atLow <= target) return low;
  if (ascending ? atHigh <= target : atHigh >= target) return high;

  let x = fallback;
  let lo = low;
  let hi = high;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    x = (lo + hi) / 2;
    const value = f(x);
    if (Math.abs(value - target) <= TOLERANCE_PX) return x;
    if (ascending ? value < target : value > target) lo = x;
    else hi = x;
  }
  return x;
}

/**
 * The size to hand the renderer, in device pixels.
 *
 * Two separate caps, for two separate reasons. `maxPixelRatio` is about
 * shading cost -- a phone reporting a ratio of 4 would have the GPU filling
 * sixteen times the pixels for a scene made of soft gradients. The CSS size
 * is taken from the measured box rather than the window because the canvas
 * fills the table area, not the viewport.
 *
 * Returns integers: a fractional drawing-buffer size is silently rounded by
 * the browser and then disagrees with the aspect ratio the camera was given,
 * which shows up as a room that is a fraction of a degree off level.
 */
export function rendererSize(
  box: { width: number; height: number },
  devicePixelRatio: number,
  maxPixelRatio: number,
): { width: number; height: number; pixelRatio: number; aspect: number } {
  const width = Math.max(1, Math.floor(box.width));
  const height = Math.max(1, Math.floor(box.height));
  const ratio = Math.min(
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
    maxPixelRatio,
  );
  return { width, height, pixelRatio: ratio, aspect: width / height };
}
