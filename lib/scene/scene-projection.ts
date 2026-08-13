/**
 * World to pixels, for either of the two 2D rooms.
 *
 * There are two cameras in `lib/scene/` now and they are genuinely different
 * kinds of camera, not two settings of one. The classic room is an
 * orthographic tilt (`projection.ts`): near and far project identically, so
 * `scale` is a single number for the whole scene and the fit is closed-form.
 * The racetrack room is a real pinhole camera (`table-anchors.ts`): size
 * falls off with depth, which is the entire point of it -- an orthographic
 * tilt cannot produce depth at any angle.
 *
 * WHAT THIS INTERFACE EXISTS FOR IS THE CHIP PAINTER, and it is worth being
 * precise about why, because "abstract the camera" is otherwise the kind of
 * indirection that costs more than it saves. `paint.ts` is ~200 lines of
 * layered chip drawing -- bevel, inserts, groove, inlay, stamped
 * denomination, decoupled ground shadow -- tuned over three renderers. The
 * racetrack needs every one of those pixels and none of that tuning is about
 * the camera. Duplicating it would give the two rooms chips that drift apart
 * the first time either is touched; parameterising the three things the
 * painter actually asks a camera for lets one painter serve both.
 *
 * Those three things, and nothing else:
 *
 *   project     -- a world point as canvas-local CSS pixels, plus the
 *                  depth-sort key the painter's algorithm needs.
 *   scaleAt     -- CSS pixels per world unit AT A POINT. The `At` is the
 *                  whole difference between the two cameras: constant under
 *                  orthography, and a function of depth under perspective.
 *                  A painter that cached one number would draw every far
 *                  chip at near-chip size.
 *   groundSquash-- the minor/major ratio of a disc lying flat on the felt.
 *                  A chip is a cylinder seen from above, so this is what
 *                  turns its circular face into the ellipse that reads as
 *                  lying on cloth rather than standing up facing the camera.
 *
 * Both cameras happen to give `groundSquash` the same closed form -- the
 * sine of the elevation -- which is not a coincidence: it falls out of the
 * ground plane's angle to the view direction either way, and only the
 * perspective one also varies its scale with depth.
 */

import { CAMERA_ELEVATION_DEG, type Camera, project as projectPerspective } from "./table-anchors";
import { project as projectOrthographic, type SceneView } from "./projection";
import { TILT_SIN, type Vec3 } from "./scene-config";

export interface ProjectedPoint {
  x: number;
  y: number;
  /**
   * Distance in front of the camera under perspective; world Z under
   * orthography. Only ever compared against other depths from the same
   * projection, as a painter's-algorithm sort key -- both orderings are
   * "further from the viewer first", which is all the sort needs.
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

/** The classic room's orthographic tilt, as a projection. */
export function orthographicProjection(view: SceneView): SceneProjection {
  return {
    project: (point) => projectOrthographic(view, point),
    // Constant, and deliberately still a function: a caller that reached for
    // a bare `scale` field would work here and silently mis-size every chip
    // on the perspective camera.
    scaleAt: () => view.scale,
    groundSquash: TILT_SIN,
  };
}

const PERSPECTIVE_GROUND_SQUASH = Math.sin((CAMERA_ELEVATION_DEG * Math.PI) / 180);

/**
 * The racetrack room's pinhole camera, as a projection.
 *
 * `scaleAt` is the pinhole relation itself -- focal length over distance --
 * and the depth guard matters: a chip is only ever on the felt, but the
 * painter also projects a point half a chip's thickness below it, and a
 * degenerate camera (a pre-layout frame of zero height) would hand back a
 * focal of 0 and a depth of 0 and turn every subsequent coordinate into NaN.
 * A NaN canvas coordinate does not throw; it silently draws nothing, which
 * is the hardest kind of blank screen to diagnose.
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
 * THIS IS THE ONE PLACE THE RACETRACK'S METRES AND THE CHIP LAYER'S WORLD
 * UNITS MEET, and confining the conversion to a single function is the whole
 * reason it is safe to have two unit systems at all.
 *
 * `lib/scene/chip-space.ts` explains the alternative and why it was rejected:
 * the chip layer's motion is tuned in world units across a dozen unrelated
 * constants -- arc peak, drop heights, spring rest distance and speed, settle
 * epsilon, flight swell, splash scatter -- and converting the layer to metres
 * means finding and rescaling every one of them, where missing one produces a
 * chip that never settles rather than an error anybody would see. Converting
 * at the boundary instead leaves all of that arithmetic exactly as tuned.
 *
 * `scale` is inner units per outer unit: metres per world unit, here. Note
 * `scaleAt` multiplies by it as well as scaling the point, because it answers
 * "pixels per OUTER unit" -- a chip a tenth of a metre wide is still one
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
