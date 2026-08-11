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
  SEAT_COUNT_3D,
  SEAT_RING_RADIUS_X,
  SEAT_RING_RADIUS_Z,
  seatPosition,
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
 * `contentBias` is where the fitted content's centre sits up the frame, in
 * NDC. Upright, a 2:1 table across a 9:19.5 screen fills the width and
 * leaves the height half empty; centred, that empty height is split evenly
 * above and below, and the lower half is exactly where the controls and a
 * thumb are. Biasing high gives that space to the HUD instead of splitting
 * it between two margins nobody uses. Landscape sits at 0 — there, height is
 * the scarce axis and every pixel of slack is worth reclaiming.
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
/*
 * `contentBias` replaces the old world-space `aimDrop`, and the change is
 * not cosmetic. A drop in metres converts to a different amount of
 * screen-space lift at every elevation and distance, so it had to be
 * re-tuned by hand whenever either moved — and in landscape, where nothing
 * was aimed at all, the frame ended up with 30% of its height empty above
 * the far player and 9% below the near ones. Stating the bias in the units
 * the requirement is actually about (screen) makes "centred" mean centred at
 * every aspect.
 *
 * Landscape is 0: balance the slack, which is what recovers that 30%.
 * Upright keeps the table high — the bottom of an upright screen belongs to
 * the action bar and a thumb — and 0.2 is calibrated to reproduce the
 * hand-tuned placement the old `aimDrop: 2.35` produced, so the orientation
 * that was judged on renders is not silently re-framed by this change.
 */
const LANDSCAPE = { elevationDeg: 48, fovY: 40, targetZ: 0.02, contentBias: 0 };
const PORTRAIT = { elevationDeg: 66, fovY: 66, targetZ: -0.06, contentBias: 0.2 };

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
  /** Half a seated figure, shoulder to centreline. */
  bodyHalfWidth: 0.55,
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

/**
 * Iteration counts for the fit. Both are fixed, so the solve is O(1) and
 * deterministic — it runs once per resize (never in the frame loop), and the
 * same viewport always produces bit-identical numbers.
 *
 * The distance search is a bisection on a monotone function: pushing the
 * camera back can only shrink the projected extent, so there is exactly one
 * crossing. 40 halvings of a [0.5, 60] bracket resolves it to ~5e-11 units.
 *
 * The aim search is a Newton step with an exact derivative (rotating the
 * view axis down by d radians lifts a point by d/tan(halfFovY) in NDC to
 * first order), so it converges in two or three passes; six is slack.
 */
const DISTANCE_ITERATIONS = 40;
const AIM_ITERATIONS = 6;
const DISTANCE_BRACKET = { min: 0.5, max: 60 };

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
 * NDC bounds of the required points, for a camera standing `distance` back
 * along the elevation ray and looking down at `pitch`.
 *
 * Written as scalar arithmetic rather than through `projectToNdc` on purpose:
 * the solver below calls this a few hundred times per resize, and the vector
 * form would allocate five short-lived objects per point per call. Nothing
 * here allocates anything.
 *
 * The basis collapses because the rig never leaves the x = 0 plane. With
 * `forward = (0, -sin p, -cos p)`, `cross(forward, worldUp)` is `(cos p, 0, 0)`
 * normalised — exactly `(1, 0, 0)` — so `right` is the world X axis and `up`
 * is `(0, -f.z, f.y)`. `cameraBasis` derives the same thing generally; this is
 * that result specialised, and `projectToNdc` is what the tests measure with,
 * so the two are checked against each other rather than trusted.
 */
interface NdcBounds {
  /** Largest |x| or |y| over every point; Infinity if any fell behind. */
  extent: number;
  minY: number;
  maxY: number;
}

function boundsAt(
  points: readonly Vec3[],
  pivotY: number,
  pivotZ: number,
  elevation: number,
  distance: number,
  pitch: number,
  tanHalfFovX: number,
  tanHalfFovY: number,
): NdcBounds {
  const cameraY = pivotY + distance * Math.sin(elevation);
  const cameraZ = pivotZ + distance * Math.cos(elevation);
  const forwardY = -Math.sin(pitch);
  const forwardZ = -Math.cos(pitch);

  let extent = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const dy = point.y - cameraY;
    const dz = point.z - cameraZ;
    const depth = dy * forwardY + dz * forwardZ;
    if (depth <= 0) return { extent: Infinity, minY: -Infinity, maxY: Infinity };

    const ndcX = point.x / (depth * tanHalfFovX);
    // up = (0, -forwardZ, forwardY)
    const ndcY = (dy * -forwardZ + dz * forwardY) / (depth * tanHalfFovY);

    const reach = Math.max(Math.abs(ndcX), Math.abs(ndcY));
    if (reach > extent) extent = reach;
    if (ndcY < minY) minY = ndcY;
    if (ndcY > maxY) maxY = ndcY;
  }

  return { extent, minY, maxY };
}

/**
 * Solve the camera for a viewport aspect (width / height).
 *
 * WHY THIS IS A SEARCH AND NOT A FORMULA. The version this replaces solved
 * each axis in closed form and took the larger: half the table's length
 * across the horizontal cone, its foreshortened depth plus half the far
 * players' headroom up the vertical one. Both terms are upper bounds on
 * things that do not actually co-occur — the deepest point of the felt and
 * the tallest head are not the same point, and neither is at the distance
 * the other was solved for — so the answer was always conservative, and
 * conservative by an amount that changed with the aspect. Measured, it left
 * 30% of the frame empty above the far player and 9% below the near ones at
 * every landscape aspect, and it still managed to CLIP the outer seats at
 * 1180x820, where the profile blend leaves the width requirement short of
 * the full player ring. A search over the real projected points has neither
 * failure: it is exact by construction at every shape, including the ones
 * nobody thought to check.
 *
 * The cost of exactness is ~250 scalar point-projections, once, inside the
 * `resize` path. That is well under a tenth of a millisecond and it never
 * runs again — no matrix work, no allocation and no solver of any kind
 * happens in the frame loop.
 */
export function frameCamera(aspect: number): CameraFraming {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1;
  const t = landscapeness(safeAspect);
  const elevationDeg = mix(PORTRAIT.elevationDeg, LANDSCAPE.elevationDeg, t);
  const fovY = mix(PORTRAIT.fovY, LANDSCAPE.fovY, t);
  const targetZ = mix(PORTRAIT.targetZ, LANDSCAPE.targetZ, t);
  const contentBias = mix(PORTRAIT.contentBias, LANDSCAPE.contentBias, t);

  const elevation = elevationDeg * DEG;
  const halfFovY = (fovY * DEG) / 2;
  const tanHalfFovY = Math.tan(halfFovY);
  const tanHalfFovX = Math.tan(horizontalFov(fovY, safeAspect) / 2);
  const pivotY = FELT_TOP_Y;

  const points = framingProbePoints(safeAspect);
  /** The extent the fit aims for: full frame, less the safety margin. */
  const targetExtent = 1 / SAFETY;

  // Aim starts level with the pivot, then alternates with the distance
  // search: each pass fits, measures where the content landed, and rotates
  // the aim to put it where `contentBias` asks. Both converge monotonically,
  // so the order within a pass does not matter, only that both run.
  let pitch = elevation;
  let distance = DISTANCE_BRACKET.max;

  for (let pass = 0; pass < AIM_ITERATIONS; pass += 1) {
    // Bisect for the nearest distance whose extent still fits. `extent` only
    // ever falls as the camera retreats, so `low` stays too-close and `high`
    // stays comfortable, and the answer is the boundary between them.
    let low = DISTANCE_BRACKET.min;
    let high = DISTANCE_BRACKET.max;
    for (let i = 0; i < DISTANCE_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      const fits =
        boundsAt(points, pivotY, targetZ, elevation, mid, pitch, tanHalfFovX, tanHalfFovY)
          .extent <= targetExtent;
      if (fits) high = mid;
      else low = mid;
    }
    distance = high;

    const bounds = boundsAt(
      points, pivotY, targetZ, elevation, distance, pitch, tanHalfFovX, tanHalfFovY,
    );
    if (!Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) break;

    // Rotating the view axis down by `d` radians lifts every point by about
    // `d / tan(halfFovY)` in NDC, so this is one Newton step, not a nudge.
    const centre = (bounds.minY + bounds.maxY) / 2;
    const correction = (contentBias - centre) * tanHalfFovY;
    if (Math.abs(correction) < 1e-6) break;
    pitch += correction;
  }

  const position: Vec3 = {
    x: 0,
    y: pivotY + distance * Math.sin(elevation),
    z: targetZ + distance * Math.cos(elevation),
  };
  // The target is reported one unit down the solved look axis. `cameraBasis`
  // and every consumer derive the direction from (target - position), so
  // handing back a point ON that axis is what keeps the aim the solver
  // measured and the aim the room renders the same aim.
  return {
    position,
    target: {
      x: 0,
      y: position.y - Math.sin(pitch),
      z: position.z - Math.cos(pitch),
    },
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
  const t = landscapeness(aspect);
  const points: Vec3[] = [
    { x: -FRAME.uprightHalfWidth, y: FELT_TOP_Y, z: 0 },
    { x: FRAME.uprightHalfWidth, y: FELT_TOP_Y, z: 0 },
    { x: 0, y: FELT_TOP_Y, z: FRAME.halfDepth },
    { x: 0, y: FELT_TOP_Y, z: -FRAME.halfDepth },
    FAR_CROWN,
  ];

  /*
   * The seats, at the height they are actually occupied.
   *
   * This used to be two points on the felt plane at the ring's widest x,
   * added only once the aspect was FULLY landscape. Both halves of that were
   * wrong, and the second hid the first.
   *
   * Wrong height: a projected x is `x / (depth · tan(halfFovX))`, and depth
   * is not constant over a seat — a head 1.5 units up at the near half of
   * the ring is closer to a camera looking down than the cloth beside it is,
   * so it lands FURTHER out. Probing the ring's width at felt height
   * understates the width of every person standing on it.
   *
   * Wrong gate: `>= 1` is a step, and the blend band it sits on top of is
   * continuous. At 1180x820 — landscapeness 0.91, an ordinary tablet — the
   * seats were not probed at all, and measured against a render the outer
   * two projected to |x| = 1.04: clipped, by a fit that reported success.
   *
   * The ramp is the documented contract made continuous: landscape
   * guarantees shoulders and elbows, upright guarantees the bodies and lets
   * the outermost sleeve edges kiss the frame.
   */
  const bodyHalfWidth = mix(0, FRAME.bodyHalfWidth, t);
  for (let slot = 0; slot < SEAT_COUNT_3D; slot += 1) {
    const seat = seatPosition(slot);
    for (const dx of [-bodyHalfWidth, bodyHalfWidth]) {
      points.push({ x: seat.x + dx, y: FRAME.headroom, z: seat.z });
    }
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
