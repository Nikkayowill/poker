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
 * exactly `2 * radiusX * scale`, so fitting the table to the DOM's
 * `.poker-table-wrap` box is one division rather than a bisection solve —
 * and the projected seat ring is an ellipse, the same kind of shape as the
 * DOM's hand-tuned one, so the two can genuinely agree instead of
 * disagreeing by a chair's width at the sides.
 */

import { FELT, TILT_COS, TILT_SIN, type Vec3 } from "./scene-config";

/** The whole camera: where world-origin lands, and pixels per world unit. */
export interface SceneView {
  cx: number;
  cy: number;
  scale: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fit the felt to the table's own plate.
 *
 * `wrap` is `.poker-table-wrap`'s box in the same coordinate space the
 * canvas draws in (canvas-local CSS pixels). The felt's width is pinned to
 * the wrap's width and its centre to the wrap's centre — the DOM ellipse
 * rings that box, so the painted table sits inside the seat ring exactly as
 * the CSS-painted one did. cy compensates for the table's height above the
 * floor so it is the *felt surface*, not the floor under it, that lands on
 * the wrap's centre.
 */
export function fitView(wrap: Box): SceneView {
  const scale = wrap.width > 0 ? wrap.width / (2 * FELT.radiusX) : 1;
  return {
    cx: wrap.left + wrap.width / 2,
    cy: wrap.top + wrap.height / 2 + FELT.y * TILT_COS * scale,
    scale,
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
