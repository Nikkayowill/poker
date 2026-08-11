/**
 * The room the table stands in — which is the FLOOR, and only the floor.
 *
 * WHY THERE IS NO BACKDROP WALL, NO SKYBOX AND NO ROOM MESH. The obvious
 * way to give a 3D table an environment is to put something behind it. At
 * this camera there is no "behind it" on screen. `frameCamera` stands the
 * rig 48 degrees above the felt in landscape and 66 upright, and at both
 * the whole frustum points DOWN: the highest ray on screen — the top-left
 * corner — still descends at ~28 degrees and meets the floor plane 12.9
 * units out. The horizon is never in frame at any shipped aspect
 * (`horizonInFrame` below is the assertion, and its test walks the whole
 * blend band). A wall, a cyclorama or a sky would be built, lit, uploaded
 * and drawn strictly off screen.
 *
 * So the environment is the ground, and the work is:
 *
 *   1. Make the floor actually cover the frame. It did not. The disc in
 *      table-3d.tsx is radius 9, and at 2560x1080 the top corners land at
 *      9.6 — the rim was INSIDE the frame, hidden only because
 *      `studioFog` happened to be fully opaque by then. That is a coupling
 *      nobody wrote down: any change to the fog span, the elevation or the
 *      lens would have slid a hard geometric edge into view with no test to
 *      catch it. `FLOOR_RADIUS` is solved from the camera now, so the floor
 *      follows the framing instead of being a literal that used to match it.
 *
 *   2. Give it something to be. A flat `#0a080d` disc is why the room reads
 *      as a void rather than as a floor. The band from the rail out to
 *      roughly 5 units is genuinely lit and genuinely on screen — it is what
 *      the chairs stand on — and a radial fall from a warm near-table value
 *      to exactly the void colour at the rim reads as a carpet under a
 *      table light, while still meeting the fog invisibly because the two
 *      ends agree by construction (`carpetColorAt(FLOOR_RADIUS)` IS
 *      `STUDIO_BACKDROP`; a test pins it).
 *
 * All of it is vertex colour on geometry that already exists — no texture
 * fetch, no second material, no extra draw call, and nothing here is ever
 * read after the first frame. Pure arithmetic, no three.js import, so
 * `npm test` reaches it.
 */

import { cameraBasis, frameCamera, horizontalFov, type CameraFraming } from "./camera-framing";
import { FELT_RADIUS_X } from "./seat-layout";
import { STUDIO_BACKDROP } from "./studio-environment";

/**
 * The shapes the floor is solved against.
 *
 * Deliberately the extremes plus the blend band rather than a list of
 * devices: the footprint is largest at the widest aspect (the top corners
 * swing furthest out) and at the most upright one (the camera stands
 * furthest back), and the answer is the maximum over all of them, so a
 * viewport between two samples cannot exceed both.
 */
const SOLVE_ASPECTS: readonly number[] = [
  0.4, 0.46, 0.55, 0.69, 0.8, 1, 1.2, 1.44, 1.6, 1.78, 2.16, 2.37, 3.2,
];

/** Air past the widest footprint, so the rim is never a near miss. */
const FLOOR_MARGIN = 2.5;

export interface FloorHit {
  /** Plan radius from the table's centre where this ray meets y = 0. */
  radius: number;
  /** How far the ray travelled to get there. */
  distance: number;
}

/**
 * Where a frustum corner meets the floor plane, or `null` if that ray
 * escapes above the horizon and never does.
 *
 * `null` is the interesting answer, not the boring one: it is precisely the
 * condition under which a backdrop wall would become visible and this
 * module's whole premise would need revisiting.
 */
export function frustumFloorHit(
  framing: CameraFraming,
  aspect: number,
  cornerX: -1 | 0 | 1,
  cornerY: -1 | 0 | 1,
): FloorHit | null {
  const { forward, right, up } = cameraBasis(framing);
  const tanX = Math.tan(horizontalFov(framing.fovY, aspect) / 2);
  const tanY = Math.tan((framing.fovY * Math.PI) / 180 / 2);

  const dx = forward.x + right.x * tanX * cornerX + up.x * tanY * cornerY;
  const dy = forward.y + right.y * tanX * cornerX + up.y * tanY * cornerY;
  const dz = forward.z + right.z * tanX * cornerX + up.z * tanY * cornerY;
  const length = Math.hypot(dx, dy, dz) || 1;
  const ny = dy / length;
  // Level or rising: this ray leaves the room through the ceiling that
  // isn't there.
  if (ny >= -1e-9) return null;

  const distance = -framing.position.y / ny;
  const hx = framing.position.x + (dx / length) * distance;
  const hz = framing.position.z + (dz / length) * distance;
  return { radius: Math.hypot(hx, hz), distance };
}

/** True if any part of this frame looks past the horizon. */
export function horizonInFrame(aspect: number): boolean {
  const framing = frameCamera(aspect);
  for (const x of [-1, 0, 1] as const) {
    if (frustumFloorHit(framing, aspect, x, 1) === null) return true;
  }
  return false;
}

/** The largest plan radius this aspect's frame reaches on the floor. */
export function floorFootprintRadius(aspect: number): number {
  const framing = frameCamera(aspect);
  let widest = 0;
  for (const x of [-1, 0, 1] as const) {
    for (const y of [-1, 0, 1] as const) {
      const hit = frustumFloorHit(framing, aspect, x, y);
      // An escaping ray has no floor radius to contribute; `horizonInFrame`
      // is what reports that case, and its test is what fails on it.
      if (hit && hit.radius > widest) widest = hit.radius;
    }
  }
  return widest;
}

/**
 * Radius of the floor disc, solved so no shipped viewport can see its rim.
 *
 * Computed once at module load over a fixed sample list — deterministic, and
 * cheap enough (13 aspects x 9 corners) that deriving it beats writing the
 * number down and letting it fall out of step with the camera, which is
 * exactly what happened to the 9 it replaces.
 */
export const FLOOR_RADIUS: number =
  Math.ceil(Math.max(...SOLVE_ASPECTS.map(floorFootprintRadius)) + FLOOR_MARGIN);

/**
 * Radial rings the floor disc is built from.
 *
 * More rings near the table, where the carpet is lit and the gradient has to
 * be smooth, and few further out, where everything is one flat void colour
 * anyway. 6 rings x 48 segments is 576 triangles for the entire environment.
 */
export const FLOOR_RINGS: readonly number[] = [0, 0.18, 0.34, 0.52, 0.74, 1];
export const FLOOR_SEGMENTS = 48;

/**
 * The carpet, as a radial ramp.
 *
 * Warm and barely-there under the table where the spot spills onto the
 * floor, cooling and darkening outward until it reaches — exactly — the
 * colour the fog fades to. That last equality is the whole trick: it is
 * what lets a lit floor sit inside a fogged void with no horizon line and
 * no fog-exempt materials, which is how the backdrop-plate approach would
 * have had to fake the same thing.
 *
 * The near-table stops lean warm brown rather than the cool purple-black
 * they used to (this is data, not a new system — retuning it is a one-line
 * edit): the rail and skirt (table-3d.tsx, `#2b1f15`/`#241a12`) are already
 * a dark mahogany wood, and a cool carpet under warm wood read as two rooms
 * meeting at the rail. A carpet in the same family reads as a lounge floor
 * the table actually stands on. Still well under the felt's own luminance
 * (see the test below) and still exactly `STUDIO_BACKDROP` at the rim.
 *
 * `stop` is a fraction of FLOOR_RADIUS.
 */
export const CARPET_STOPS: readonly { stop: number; color: string }[] = [
  { stop: 0, color: "#241a12" },
  { stop: 0.2, color: "#1c130e" },
  { stop: 0.45, color: "#100b0a" },
  { stop: 1, color: STUDIO_BACKDROP },
];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rrggbb` to 0..1 linear-ish components (sRGB values, as three reads them
 * from a hex literal — no conversion, so what is written is what is set). */
export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255,
  };
}

/** The carpet colour at a plan radius in world units. */
export function carpetColorAt(radius: number): Rgb {
  const t = Math.min(1, Math.max(0, radius / FLOOR_RADIUS));
  let lower = CARPET_STOPS[0];
  let upper = CARPET_STOPS[CARPET_STOPS.length - 1];
  for (let i = 0; i < CARPET_STOPS.length - 1; i += 1) {
    if (t >= CARPET_STOPS[i].stop && t <= CARPET_STOPS[i + 1].stop) {
      lower = CARPET_STOPS[i];
      upper = CARPET_STOPS[i + 1];
      break;
    }
  }
  const span = upper.stop - lower.stop;
  const k = span <= 0 ? 0 : (t - lower.stop) / span;
  const a = hexToRgb(lower.color);
  const b = hexToRgb(upper.color);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/**
 * A second, low-intensity light for edge definition.
 *
 * The rig has one shadow-casting spot and a hemisphere fill, which lights
 * the table from directly above and from nowhere in particular. Neither
 * puts an edge on the rail: a torus lit from straight overhead has its
 * silhouette exactly where its shading is flattest. This is a rim from
 * behind and to one side, low enough to be a suggestion of the room rather
 * than a second key.
 *
 * Colour is brass/gold rather than the cool blue-grey it started as —
 * a low-intensity warm kick along the rail's far edge reads as a glint off
 * the wood and its trim, the same "warm accent light" idea a real VIP room
 * would use, without adding a light, a texture or a mesh. Retuning this hex
 * is the whole lever; nothing else in the rig depends on which colour it is.
 *
 * `castShadow: false` is stated as DATA rather than left to the JSX default
 * on purpose. A three.js light that casts adds a whole depth pass over
 * every shadow-casting object in the scene — six rigged characters, six
 * chairs, every chip — to produce a second shadow that this intensity could
 * not make visible anyway. The flag is the difference between one shadow
 * pass per frame and two, so it is worth being unable to forget.
 */
export const STUDIO_RIM = {
  position: { x: -3.4, y: 2.9, z: -4.2 },
  intensity: 0.42,
  color: "#c99456",
  castShadow: false,
} as const;

/**
 * Plan radius at which the rim light's contribution is judged. Just outside
 * the rail — the edge it exists to draw.
 */
export const RIM_REFERENCE_RADIUS = FELT_RADIUS_X * 1.08;
