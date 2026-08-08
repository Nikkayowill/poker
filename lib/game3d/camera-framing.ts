/**
 * Where the camera stands, for the shape of screen it is standing in.
 *
 * The rig used to be three literals — position (0, 4.15, 5.45) looking at
 * (0, 0.55, -0.2) — which is one framing for every device. That is a 32
 * degree elevation: shallow enough that the board reads as a row of slivers,
 * and, worse, it is computed against nothing, so a phone held upright showed
 * a table cropped at both ends with no way to notice from the code.
 *
 * Two things are solved here instead:
 *
 * ELEVATION. Higher than it was (46 degrees landscape), because the cards
 * are the thing being read and a card lying on the cloth shows its face in
 * proportion to how far above it you are. Steeper still on a phone held
 * upright, where the table has to be seen down the frame rather than across
 * it.
 *
 * DISTANCE, PER ASPECT. The table is twice as long as it is deep, so the
 * binding constraint swaps between orientations: a wide screen runs out of
 * height first, an upright one runs out of width. Solving both and taking
 * the larger is what keeps the felt's ends on screen at every shape — from
 * a 21:9 desktop to a 9:19.5 phone — instead of at the one the numbers were
 * typed against.
 *
 * Landscape is the primary orientation. That is a product decision (a table
 * is a wide object and the app is meant to be played sideways), and it is
 * expressed here as the profile that gets the natural field of view; the
 * upright profile widens the lens because it has no other way to fit a 2.13
 * metre table across a 390 pixel screen.
 *
 * Pure trigonometry, no three.js, so `npm test` reaches it — and
 * `projectToNdc` is exported specifically so the tests can *measure* what
 * lands on screen rather than trusting the algebra above.
 */

import {
  FELT_RADIUS_X,
  FELT_TOP_Y,
  SEAT_RING_RADIUS_X,
  SEAT_RING_RADIUS_Z,
  type Vec3,
} from "./seat-layout";

export interface CameraFraming {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, in degrees, for THREE.PerspectiveCamera.fov. */
  fovY: number;
  elevationDeg: number;
}

/** Aspect at or above which the framing is fully "landscape". */
const LANDSCAPE_ASPECT = 1.5;
/** Aspect at or below which it is fully "upright". */
const PORTRAIT_ASPECT = 0.8;

/**
 * The two profiles the framing interpolates between. Elevation is the angle
 * above the felt plane, fovY is the lens, and `targetZ` nudges what the
 * frame is built around.
 *
 * `aimDrop` is how far *below* the felt the camera looks, which lifts the
 * table up the frame. Upright, a 2:1 table across a 9:19.5 screen fills the
 * width and leaves the height half empty; centred, that empty height is
 * split evenly above and below, and the lower half is exactly where the
 * controls and a thumb are. Aiming low gives that space to the HUD instead
 * of splitting it between two margins nobody uses. Landscape needs none of
 * this — there, height is the scarce axis.
 */
/*
 * Elevations raised twice from the original 46/57 (2026-08-07, product
 * direction, both times judged on renders): a steeper look-down makes the
 * table's dark foreground — the skirt and the shadow pool under the near
 * rail — reach further down the frame, so the foreground players' lower
 * halves sink into that shadow band instead of hanging beside it, and the
 * community cards are read from higher up. Landscape is the primary (PWA
 * horizontal) viewport and leads; upright follows so a phone held tall
 * keeps the same read of the board.
 *
 * Brought back down partway, to 48 (2026-08-08, real .glb characters):
 * that reasoning was tuned entirely against the sprite/card-legibility
 * room. A seated head is real geometry now, not a billboard that always
 * faces the lens — at 58 degrees the camera looks almost straight down and
 * every seat reads as a part-line, not a face. This is a compromise, not a
 * full reversion: judge any further move on a render, weighing face
 * visibility against the shadow-band/card-legibility case above.
 */
const LANDSCAPE = { elevationDeg: 48, fovY: 40, targetZ: 0.02, aimDrop: 0 };
// aimDrop rises with the elevation: a steeper camera converts less of the
// drop into screen-space lift, and the upright profile's contract (the
// felt centre rides high; the bottom of the screen belongs to the
// controls) is test-pinned.
const PORTRAIT = { elevationDeg: 66, fovY: 66, targetZ: -0.06, aimDrop: 2.35 };

/**
 * What must be inside the frame, as half-extents around the table's centre.
 *
 * The players are part of this, and leaving them out is a mistake worth
 * recording: a fit that contains only the felt pulls the camera in until the
 * table fills the screen, and at a raised elevation that crops the seated
 * players at both edges — a room with its people cut off, which reads far
 * worse than a slightly smaller table.
 *
 * The width requirement differs by orientation. Landscape — the primary
 * (PWA horizontal) viewport — guarantees the full player ring, shoulders
 * included. Upright used to guarantee only the felt and let the side
 * seats run off the edges, which read as half-faces sliced by the frame;
 * it now guarantees the seated BODIES too (`uprightHalfWidth`: the tucked
 * side seats plus most of a sprite's half-width), trading ~10% of table
 * size for six whole players. Full shoulders-and-elbows width upright
 * would shrink the felt to a postage stamp — the compromise is bodies
 * whole, outermost sleeve edges allowed to kiss the frame.
 */
const FRAME = {
  /** Upright minimum: felt, rail, and the seated bodies at the sides. */
  uprightHalfWidth: FELT_RADIUS_X * 1.48,
  /** The seat ring plus a body's half-width, shoulders and elbows included. */
  playersHalfWidth: SEAT_RING_RADIUS_X + 0.55,
  /** Far enough back for the opposite chair, far enough forward for yours. */
  halfDepth: SEAT_RING_RADIUS_Z + 0.35,
  /** Top of a seated player's head above the floor. */
  headroom: 1.75,
};

/**
 * The far seated player's crown — the highest occupied point in the room,
 * and therefore the ceiling of the empty backdrop above the table.
 *
 * Exported because the DOM board reads it: upright, the felt is too small to
 * carry five legible cards, so the board is placed in the emptiness ABOVE the
 * room rather than on the cloth, and "above the room" has to mean above the
 * furthest head rather than above the felt — a card row clearing the rail
 * still lands across the far player's face. `framingProbePoints` keys off
 * this same constant, so the point the framing guarantees on screen and the
 * point the board measures against cannot drift apart.
 */
export const FAR_CROWN: Vec3 = {
  x: 0,
  y: FRAME.headroom,
  z: -SEAT_RING_RADIUS_Z,
};

/** A hair of air, so nothing sits exactly on the frustum edge. */
const SAFETY = 1.04;

const DEG = Math.PI / 180;

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 0 at the upright profile, 1 at the landscape one.
 *
 * Exported so the DOM overlays blend on the SAME curve the camera does. The
 * board needs to know how upright the viewport is in order to decide between
 * the felt and the backdrop above it, and inventing a second threshold for
 * that is how two numbers that must agree start disagreeing.
 */
export function landscapeness(aspect: number): number {
  const span = LANDSCAPE_ASPECT - PORTRAIT_ASPECT;
  return Math.min(1, Math.max(0, (aspect - PORTRAIT_ASPECT) / span));
}

/** Horizontal field of view implied by a vertical one at this aspect. */
export function horizontalFov(fovYDeg: number, aspect: number): number {
  return 2 * Math.atan(Math.tan((fovYDeg * DEG) / 2) * aspect);
}

/**
 * Solve the camera for a viewport aspect (width / height).
 *
 * The distance satisfies both axes at once: the table's half-length across
 * the horizontal cone, and its foreshortened depth plus the far players'
 * headroom up the vertical one.
 */
export function frameCamera(aspect: number): CameraFraming {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1;
  const t = landscapeness(safeAspect);
  const elevationDeg = mix(PORTRAIT.elevationDeg, LANDSCAPE.elevationDeg, t);
  const fovY = mix(PORTRAIT.fovY, LANDSCAPE.fovY, t);
  const targetZ = mix(PORTRAIT.targetZ, LANDSCAPE.targetZ, t);
  const aimDrop = mix(PORTRAIT.aimDrop, LANDSCAPE.aimDrop, t);

  const elevation = elevationDeg * DEG;
  const halfFovY = (fovY * DEG) / 2;
  const halfFovX = horizontalFov(fovY, safeAspect) / 2;

  // Up the screen the table shows its depth foreshortened by the elevation,
  // while anything standing at the far rail rises by its height's cosine.
  const projectedHalfHeight =
    FRAME.halfDepth * Math.sin(elevation) + (FRAME.headroom * Math.cos(elevation)) / 2;

  // Sideways, the people are inside the frame; upright, only the table is.
  const requiredHalfWidth = mix(FRAME.uprightHalfWidth, FRAME.playersHalfWidth, t);
  const distanceForWidth = requiredHalfWidth / Math.tan(halfFovX);
  const distanceForHeight = projectedHalfHeight / Math.tan(halfFovY);
  const distance = Math.max(distanceForWidth, distanceForHeight) * SAFETY;

  // The camera is placed around the felt, then aimed below it: the pivot
  // sets the distance and elevation, the target sets what the frame is
  // centred on. Folding the drop into both would move the camera as well as
  // its aim, which changes the fit the distance was just solved for.
  const pivot: Vec3 = { x: 0, y: FELT_TOP_Y, z: targetZ };
  return {
    position: {
      x: 0,
      y: pivot.y + distance * Math.sin(elevation),
      z: pivot.z + distance * Math.cos(elevation),
    },
    target: { x: 0, y: pivot.y - aimDrop, z: pivot.z },
    fovY,
    elevationDeg,
  };
}

/**
 * Where a world point lands in normalised device coordinates: -1..1 on both
 * axes is on screen. The scene's own projection matrix would do this, but it
 * lives inside three.js and a WebGL context — this is the same arithmetic,
 * reachable by a unit test, which is the only way the framing above can be
 * checked against every screen shape instead of the one someone opened.
 */
/**
 * The camera's orthonormal basis in world space.
 *
 * Exported because the seat sprites are screen-aligned: they need the
 * camera's own up axis to place a head, and a nameplate has to project the
 * same point the quad actually put it at. Deriving it twice from the
 * elevation angle would be a second definition that drifts — and would be
 * wrong outright in the upright profile, where `aimDrop` tilts the look
 * direction away from the elevation the camera was placed at.
 */
export function cameraBasis(framing: CameraFraming): {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
} {
  const forward = normalise(subtract(framing.target, framing.position));
  const right = normalise(cross(forward, { x: 0, y: 1, z: 0 }));
  return { forward, right, up: cross(right, forward) };
}

export function projectToNdc(
  point: Vec3,
  framing: CameraFraming,
  aspect: number,
): { x: number; y: number; depth: number } {
  const { forward, right, up } = cameraBasis(framing);

  const view = subtract(point, framing.position);
  const depth = dot(view, forward);
  if (depth <= 0) return { x: Infinity, y: Infinity, depth };

  const halfFovY = (framing.fovY * DEG) / 2;
  const halfFovX = horizontalFov(framing.fovY, aspect) / 2;
  return {
    x: dot(view, right) / (depth * Math.tan(halfFovX)),
    y: dot(view, up) / (depth * Math.tan(halfFovY)),
    depth,
  };
}

/**
 * The points the framing exists to keep on screen at this aspect: both ends
 * of the felt, its near and far edges, and the head of whoever is sitting
 * opposite — plus, in landscape, the outermost players, who are the whole
 * reason the frame is wider than the table there.
 *
 * Exported so the tests assert the contract rather than the arithmetic that
 * happens to implement it.
 */
export function framingProbePoints(aspect: number): Vec3[] {
  const points: Vec3[] = [
    { x: -FRAME.uprightHalfWidth, y: FELT_TOP_Y, z: 0 },
    { x: FRAME.uprightHalfWidth, y: FELT_TOP_Y, z: 0 },
    { x: 0, y: FELT_TOP_Y, z: FRAME.halfDepth },
    { x: 0, y: FELT_TOP_Y, z: -FRAME.halfDepth },
    FAR_CROWN,
  ];
  if (landscapeness(aspect) >= 1) {
    // The two seats at the ends of the ring, shoulders included.
    points.push(
      { x: -FRAME.playersHalfWidth, y: FELT_TOP_Y, z: 0 },
      { x: FRAME.playersHalfWidth, y: FELT_TOP_Y, z: 0 },
    );
  }
  return points;
}

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
