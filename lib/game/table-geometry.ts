/**
 * Where the seats sit, and how far away they read.
 *
 * The seats ring a round table. A circle viewed from a tilted camera
 * projects to an ellipse whose horizontal radius is unchanged and whose
 * vertical radius is foreshortened by sin(camera tilt) -- so placing seats
 * on an ellipse is not a stylistic choice, it is what a real round table
 * looks like from a player's chair.
 *
 * Everything else follows from one number per seat: its depth into the
 * scene. Scale, stacking order and atmospheric falloff are all derived from
 * it, which is why the far side reads as further away rather than merely
 * smaller.
 */

/** Seat 0 sits nearest the viewer; screen y grows downward, so 90deg is the near edge. */
const NEAR_ANGLE_DEG = 90;

/**
 * Ellipse radii as a percentage of the table's bounding box. Sized so a seat
 * straddles the rail: most of it outside, its lower edge tucked behind. Pull
 * these in further and the rail starts eating names and stacks, which trades
 * information for atmosphere -- the wrong way round.
 */
const RADIUS_X = 53;
const RADIUS_Y = 51;

/**
 * Narrow viewports cannot afford the full horizontal radius: a seat is a
 * fixed-width box, so past a point the ring pushes the side seats off the
 * edge of the screen. Pulling the ellipse in keeps every name on screen,
 * which matters more than the width of the oval.
 */
const NARROW_RADIUS_X = 38;
const NARROW_BREAKPOINT_PX = 620;

export function radiiForWidth(viewportWidth: number): { rx: number; ry: number } {
  return isNarrow(viewportWidth)
    ? { rx: NARROW_RADIUS_X, ry: RADIUS_Y }
    : { rx: RADIUS_X, ry: RADIUS_Y };
}

export function isNarrow(viewportWidth: number): boolean {
  return viewportWidth <= NARROW_BREAKPOINT_PX;
}

/**
 * Whether the far seats should pass behind the rail.
 *
 * Occlusion is a luxury that costs legibility. On a narrow screen the ring is
 * pulled in to fit, which puts the upper seats inside the rail's outline
 * rather than straddling its edge -- they would be swallowed whole instead of
 * tucked. There, every seat draws in front: a phone player needs to read who
 * is in the hand more than they need the table to look deep.
 */
export function occlusionEnabled(viewportWidth: number): boolean {
  return !isNarrow(viewportWidth);
}

/** Stacking order when occlusion is off: still depth-sorted, but all above the rail. */
export function flatZ(depth: number): number {
  return RAIL_Z + 1 + Math.round(depth * 40);
}

/**
 * Focal length for the perspective divide, in units where the table is one
 * deep. Real perspective is scale = f / (f + z), not a linear ramp: the
 * falloff is steeper near the camera, which is exactly the cue that makes a
 * flat ring read as a receding table.
 *
 * Solved so the far edge lands at FAR_SCALE:
 *   FAR_SCALE = f / (f + 1)  =>  f = FAR_SCALE / (1 - FAR_SCALE)
 */
const FAR_SCALE = 0.82;
const FOCAL = FAR_SCALE / (1 - FAR_SCALE);

export interface SeatGeometry {
  /** Percentage across the table's bounding box. */
  x: number;
  y: number;
  /** 0 at the far rail, 1 nearest the viewer. */
  depth: number;
  /** Perspective foreshortening, FAR_SCALE..1. */
  scale: number;
  /**
   * Painter's-algorithm order: far seats draw first and therefore behind the
   * rail, near seats draw over it. The rail itself sits at RAIL_Z.
   */
  z: number;
}

/** The rail's own stacking level. Seats below it are occluded by it. */
export const RAIL_Z = 50;

/**
 * Geometry for one seat on a ring of `count`, offset by `slot` places from
 * the near edge. The local player occupies slot 0 and is drawn separately in
 * the foreground, so opponents start at slot 1.
 */
export function seatGeometry(
  slot: number,
  count: number,
  radii: { rx: number; ry: number } = { rx: RADIUS_X, ry: RADIUS_Y },
): SeatGeometry {
  const theta = ((NEAR_ANGLE_DEG + (slot * 360) / count) * Math.PI) / 180;

  // Circle -> ellipse under camera tilt.
  const x = 50 + radii.rx * Math.cos(theta);
  const y = 50 + radii.ry * Math.sin(theta);

  // sin(theta) is +1 at the near edge and -1 at the far rail.
  const depth = (Math.sin(theta) + 1) / 2;

  // Perspective divide: z is distance into the scene, 0 near and 1 far.
  const scale = FOCAL / (FOCAL + (1 - depth));

  return { x, y, depth, scale, z: Math.round(depth * 100) };
}

/**
 * Distance haze. Far seats lose a little contrast and colour, which reads as
 * air between the viewer and the far rail. Kept subtle -- names and stacks
 * still have to be legible over there.
 */
export function atmosphere(depth: number): { brightness: number; saturate: number } {
  return {
    brightness: 0.78 + 0.22 * depth,
    saturate: 0.7 + 0.3 * depth,
  };
}
