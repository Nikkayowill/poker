/**
 * The tilt projection: world units in, CSS pixels out.
 *
 * An orthographic camera elevated TILT_DEG above the horizon. That single
 * angle derives everything: ground-plane depth (world Z) compresses by
 * sin(alpha) — a circle of chips becomes the familiar table ellipse — and
 * height (world Y) rises on screen by cos(alpha), which is why a chip stack
 * shows its edge. Because the camera never moves, an entity's world Z *is*
 * its distance from the viewer, so the painter's-algorithm sort key falls
 * straight out of the state with no matrix inversion.
 *
 * The fit is closed-form, and that is the practical win over the perspective
 * room this replaced: under orthography the felt's projected width is
 * exactly `2 * radiusX * scale`, so fitting the table to a measured DOM box
 * is one division rather than a bisection solve — and the projected seat
 * ring is an ellipse, the same kind of shape as the DOM's hand-tuned one, so
 * the two can genuinely agree instead of disagreeing by a chair's width at
 * the sides.
 *
 * THE TABLE'S PLAN SHAPE IS PER-FIT, AND HAS TO BE. `.poker-table-wrap`'s
 * aspect ratio is not one number: it is 1.84 on a desktop, 0.62 on a
 * portrait phone and 3-3.6 in landscape (`--table-aspect`, overridden per
 * breakpoint in app/styles/12-responsive.css). A fit that reads only the
 * box's *width* and carries a fixed radiusX:radiusZ therefore paints the
 * same wide horizontal oval at every size — which on a portrait phone is a
 * flat pancake lying across the middle of a tall plate, with the seat ring
 * looping far above and below it. So `radiusZ` is solved for here rather
 * than imported: the plan shape of the table changes with the plate, and
 * the on-screen oval that falls out of the tilt is the shape the CSS
 * artwork had at that breakpoint.
 *
 * Deliberately *not* done by stretching the projection (a per-view depth
 * multiplier in `project`). That would stretch everything on the ground
 * plane including each chip's own face, and a chip is a chip at every
 * breakpoint. Elongating the table instead leaves discs round.
 */

import { FELT, RAIL_SCALE, TILT_COS, TILT_SIN, type Vec3 } from "./scene-config";

/** The whole camera: where world-origin lands, and pixels per world unit. */
export interface SceneView {
  cx: number;
  cy: number;
  scale: number;
  /**
   * The felt's plan-view depth radius, in world units, for this fit.
   *
   * Everything positioned around the table — the seat ring, the bet spots,
   * the pot — is a multiple of this rather than of `FELT.radiusZ`, so they
   * all follow the plate's shape together. `FELT.radiusZ` is the shape a
   * desktop plate happens to produce, kept as the default for pure callers
   * and tests.
   */
  radiusZ: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fit the room to the table's own rail.
 *
 * `rail` is `.poker-rail`'s box in the same coordinate space the canvas
 * draws in (canvas-local CSS pixels). That element, not `.poker-table-wrap`,
 * is the table's outer edge: it carries the per-breakpoint insets the CSS
 * artwork was cut to (`inset: 15% 4% 8%` on a desktop, `9% 7%` on a phone),
 * which is the geometry the seat ring in `lib/game/table-geometry.ts` was
 * hand-tuned against. Fitting to it is what puts a painted rail exactly
 * where the drawn one used to be, at every breakpoint, without the scene
 * restating a single one of those numbers.
 *
 * Both radii are solved so the *rail* ellipse — `RAIL_SCALE` outside the
 * felt — fills that box:
 *
 *   scale   = (railWidth / 2 / RAIL_SCALE) / FELT.radiusX
 *   radiusZ = (railHeight / 2 / RAIL_SCALE) / (TILT_SIN * scale)
 *
 * cy compensates for the table's height above the floor, so it is the
 * *felt surface* and not the floor under it that lands on the rail's centre.
 */
export function fitView(rail: Box): SceneView {
  const halfWidth = rail.width / 2 / RAIL_SCALE;
  const halfDepth = rail.height / 2 / RAIL_SCALE;
  const scale = halfWidth > 0 ? halfWidth / FELT.radiusX : 1;
  return {
    cx: rail.left + rail.width / 2,
    cy: rail.top + rail.height / 2 + FELT.y * TILT_COS * scale,
    scale,
    // A degenerate box (pre-layout, or a display:none ancestor) must not
    // hand back NaN or zero: every chip's position is a multiple of this.
    radiusZ: halfDepth > 0 ? halfDepth / (TILT_SIN * scale) : FELT.radiusZ,
  };
}

/** A world point, as canvas-local CSS pixels plus its depth-sort key. */
export function project(view: SceneView, point: Vec3): { x: number; y: number; depth: number } {
  return {
    x: view.cx + point.x * view.scale,
    y: view.cy + point.z * TILT_SIN * view.scale - point.y * TILT_COS * view.scale,
    depth: point.z,
  };
}

/** The felt's on-screen width — trivially exact under orthography. */
export function projectedFeltWidth(view: SceneView): number {
  return 2 * FELT.radiusX * view.scale;
}

/** The felt's on-screen height: the plan depth, foreshortened by the tilt. */
export function projectedFeltDepth(view: SceneView): number {
  return 2 * view.radiusZ * TILT_SIN * view.scale;
}
