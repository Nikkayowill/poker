/**
 * World to pixels, for the racetrack's chip painter.
 *
 * This interface exists for the chip painter specifically, which is worth
 * being precise about, because "abstract the camera" is otherwise the kind
 * of indirection that costs more than it saves. `paint.ts` is ~200 lines of
 * layered chip drawing (bevel, inserts, groove, inlay, stamped
 * denomination, decoupled ground shadow) tuned over several renderers
 * before the racetrack was the only one left. Parameterising the three
 * things the painter actually asks a camera for keeps that tuning alive
 * without the painter itself needing to know what kind of camera it is.
 *
 * Those three things, and nothing else:
 *
 *   project      - a world point as canvas-local CSS pixels, plus the
 *                  depth-sort key the painter's algorithm needs.
 *   scaleAt      - CSS pixels per world unit at a point. Under a real
 *                  pinhole camera this falls off with depth: a painter
 *                  that cached one number would draw every far chip at
 *                  near-chip size.
 *   groundSquash - the minor/major ratio of a disc lying flat on the felt.
 *                  A chip is a cylinder seen from above, so this is what
 *                  turns its circular face into the ellipse that reads as
 *                  lying on cloth rather than standing up facing the camera.
 */

import { CAMERA_ELEVATION_DEG, type Camera, project as projectPerspective } from "./table-anchors";
import { type Vec3 } from "./scene-config";

export interface ProjectedPoint {
  x: number;
  y: number;
  /**
   * Distance in front of the camera. Only ever compared against other
   * depths from the same projection, as a painter's-algorithm sort key:
   * "further from the viewer first" is all the sort needs.
   */
  depth: number;
}

export interface SceneProjection {
  project(point: Vec3): ProjectedPoint;
  /** CSS pixels per world unit at `point`. See the header. */
  scaleAt(point: Vec3): number;
  /** Minor/major ratio of a disc lying on the felt. */
  readonly groundSquash: number;
}

const PERSPECTIVE_GROUND_SQUASH = Math.sin((CAMERA_ELEVATION_DEG * Math.PI) / 180);

/**
 * The racetrack room's pinhole camera, as a projection.
 *
 * `scaleAt` is the pinhole relation itself, focal length over distance, and
 * the depth guard matters: a chip is only ever on the felt, but the painter
 * also projects a point half a chip's thickness below it, and a degenerate
 * camera (a pre-layout frame of zero height) would hand back a focal of 0
 * and a depth of 0 and turn every subsequent coordinate into NaN. A NaN
 * canvas coordinate does not throw; it silently draws nothing, which is the
 * hardest kind of blank screen to diagnose.
 */
export function perspectiveProjection(camera: Camera): SceneProjection {
  return {
    project: (point) => projectPerspective(camera, point),
    scaleAt: (point) => {
      const { depth } = projectPerspective(camera, point);
      return depth > 1e-6 ? camera.focal / depth : 0;
    },
    groundSquash: PERSPECTIVE_GROUND_SQUASH,
  };
}

/**
 * The same projection, fed in a different unit.
 *
 * This is the one place the racetrack's metres and the chip layer's world
 * units meet, and confining the conversion to a single function is the whole
 * reason it is safe to have two unit systems at all.
 *
 * `lib/scene/chip-space.ts` explains the alternative and why it was rejected:
 * the chip layer's motion is tuned in world units across a dozen unrelated
 * constants (arc peak, drop heights, spring rest distance and speed, settle
 * epsilon, flight swell, splash scatter), and converting the layer to metres
 * means finding and rescaling every one of them, where missing one produces a
 * chip that never settles rather than an error anybody would see. Converting
 * at the boundary instead leaves all of that arithmetic exactly as tuned.
 *
 * `scale` is inner units per outer unit: metres per world unit, here. Note
 * `scaleAt` multiplies by it as well as scaling the point, because it answers
 * "pixels per outer unit": a chip a tenth of a metre wide is still one
 * chip's worth of pixels.
 */
export function scaledProjection(inner: SceneProjection, scale: number): SceneProjection {
  const toInner = (point: Vec3): Vec3 => ({
    x: point.x * scale,
    y: point.y * scale,
    z: point.z * scale,
  });
  return {
    project: (point) => inner.project(toInner(point)),
    scaleAt: (point) => inner.scaleAt(toInner(point)) * scale,
    groundSquash: inner.groundSquash,
  };
}
