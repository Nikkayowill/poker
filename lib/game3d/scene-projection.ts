/**
 * Screen-space geometry for the 3D room's e2e seam.
 *
 * The Canvas-2D room could answer "how big is the felt on screen" and "how
 * many CSS pixels is a world unit" from its own fit, because an orthographic
 * projection has exactly one scale and `projection.ts` solved it in closed
 * form. A perspective camera has neither property: a world unit near the
 * viewer covers more pixels than the same unit at the far rail, so there's
 * no single number to report and no formula to report it from.
 *
 * So the seam measures instead of deriving. Everything here works on points
 * that three.js has already projected, which keeps the reasoning (what a
 * "scale" even means under perspective, how an ellipse's on-screen size is
 * defined once it's no longer an ellipse) in `lib/` where `npm test` can
 * reach it, rather than in a component behind a WebGL context that
 * `vitest.config.ts` doesn't collect and CI has no GPU for.
 */

export interface Point2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The canvas's box on the page, as `getBoundingClientRect` reports it. */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Normalised device coordinates to viewport CSS pixels.
 *
 * NDC is -1..1 with **y up**; the DOM is pixels with **y down**, measured
 * from the document's top-left. Both the flip and the canvas's own offset
 * matter: every consumer of this seam compares its answer against a
 * `getBoundingClientRect()` from the DOM HUD, so an answer in canvas-local
 * pixels would be silently wrong by the header's height on every page that
 * has one.
 */
export function ndcToViewport(ndc: Point2, rect: ViewportRect): Point2 {
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height,
  };
}

/**
 * The axis-aligned bounding box of a set of projected points.
 *
 * This is what "the felt's on-screen size" has to mean under perspective.
 * The table is an ellipse on the ground plane, and a perspective camera
 * looking down at it projects that ellipse to a shape whose near edge is
 * wider than its far edge: not an ellipse, and with no single width. The
 * bounding box is the honest reduction, and it's the one a test comparing
 * the room against a DOM element's rect actually wants.
 */
export function screenExtent(points: readonly Point2[]): { width: number; height: number } {
  if (points.length === 0) return { width: 0, height: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { width: maxX - minX, height: maxY - minY };
}

/**
 * Evenly spaced points around an ellipse lying flat on the ground plane.
 *
 * Sampled rather than solved because the projection isn't analytic here:
 * the caller pushes each of these through the real camera and takes the
 * extent of what comes back. `count` therefore sets the accuracy of that
 * extent: the sampled hull is inscribed, so it can only ever understate the
 * true silhouette, and it understates it by less as `count` rises.
 */
export function ellipseRimSamples(
  radiusX: number,
  radiusZ: number,
  y: number,
  count: number,
): Vec3[] {
  const samples: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    samples.push({
      x: Math.cos(angle) * radiusX,
      y,
      z: Math.sin(angle) * radiusZ,
    });
  }
  return samples;
}

/**
 * CSS pixels per world unit, measured between two already-projected points
 * that were a known distance apart in world space.
 *
 * Under perspective this is a reading at one depth, not a property of the
 * scene, so the caller has to say where it took the measurement and the
 * answer only means anything there. The seam takes it across the felt's
 * centre, which is the closest thing to "the scale of the table" that
 * exists once orthography is gone.
 */
export function scaleBetween(a: Point2, b: Point2, worldDistance: number): number {
  if (worldDistance === 0) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y) / worldDistance;
}

/*
 * There's no `isLoopAwake(lastFrameAt, now)` here on purpose. The first cut
 * of the seam answered `awake()` from how recently a frame had been drawn: a
 * 50ms window, three frames at 60Hz. It's the obvious reading of "is the
 * loop running", and it was wrong in a way only a real run showed: driven
 * headlessly, the room rendered about two frames a second, because a
 * shadow-mapped scene under SwiftShader takes ~450ms a frame. Every sample
 * fell outside the window, so a room with eight chips visibly in the air
 * reported itself asleep, across 1,141 consecutive samples.
 *
 * Frame recency can't tell "nothing left to draw" apart from "still drawing
 * the last thing, slowly", and those are opposite answers. A window wide
 * enough for software rendering is far too wide to prove a loop settled.
 *
 * So `awake()` reports whether there's animation in progress, published by
 * the layer that drives the loop (see `animating` in ./scene-registry.ts).
 * That's also what the Canvas-2D room's `isAwake(scheduler)` has always
 * meant: pending work, not recent paint. `framesRendered()` remains the
 * independent evidence that the loop actually stopped.
 */
