/**
 * Every number the 2.5D room is built from, in one file.
 *
 * The scene is a *fixed* view looking down at a table — no orbit, no zoom,
 * no pan — so these constants are the whole geometry contract between the
 * canvas room and the DOM HUD drawn over it. They live in `lib/` rather than
 * beside the renderer because `vitest.config.ts` only collects tests under
 * `lib/` and `app/`; anything in `components/` is unreachable by `npm test`,
 * and the projection maths below is exactly the sort of thing that must not
 * drift silently.
 *
 * The renderer is Canvas 2D with an orthographic tilt, not a perspective
 * camera: one elevation angle derives the whole projection (see
 * `projection.ts`), which is what lets the fit be closed-form instead of a
 * solver, and what keeps the canvas ring and the DOM's hand-tuned ellipse
 * *the same kind of shape* — both are ellipses, so they can genuinely agree,
 * where a perspective ring and a CSS ellipse never could.
 */

/** A plain XYZ triple. X across the table, Y up, Z toward the viewer. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The camera's elevation above the horizon, and the two coefficients the
 * entire projection is made of.
 *
 * Ground-plane depth compresses by sin(alpha) — a circle of chips becomes
 * the familiar table ellipse — and height rises on screen by cos(alpha),
 * which is why a chip stack shows its edge. 38 degrees matches the framing
 * the old perspective camera had (it sat at y=12, z=15 from its target:
 * atan2(12, 15) ≈ 38.7°), so the table's proportions did not change when
 * the renderer did.
 */
export const TILT_DEG = 38;
export const TILT_SIN = Math.sin((TILT_DEG * Math.PI) / 180);
export const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180);

/**
 * The felt's ellipse, in world units. Everything else on the table is
 * expressed as a multiple of these two radii, so the table can be restyled
 * into a wider or rounder oval by editing exactly two numbers.
 *
 * radiusZ is close to radiusX * TILT_SIN on purpose: the *plan* shape is
 * nearly round, and the on-screen oval comes out of the projection — the
 * same division of labour the DOM ellipse baked into its own two radii.
 */
export const FELT = {
  radiusX: 9.0,
  radiusZ: 5.2,
  /** Table height. Chips, cards and the pot all rest on this plane. */
  y: 0.9,
} as const;

/**
 * Where the players sit, as a multiple of FELT's radii. Greater than 1 by
 * design — a seat is outside the felt, at the rail.
 */
export const SEAT_RING = {
  radiusScale: 1.19,
} as const;

/**
 * The rail around the felt, as a multiple of the felt's radii. Between the
 * two ellipses is the upholstered armrest the room paints in leather brown.
 */
export const RAIL_SCALE = 1.14;

/**
 * The colours the canvas paints the room in.
 *
 * Strings, not numbers, because they are handed straight to a 2D context.
 * The felt and rail hexes carry over from the WebGL room's materials, which
 * themselves carried over from the CSS felt before it — the palette has
 * survived two renderer changes now, which is the point of it.
 */
export const ROOM = {
  /** A deep desaturated mahogany, so the lamp has something to fall into. */
  floor: "#140f10",
  felt: "#0f4c33",
  feltEdge: "#0a3624",
  rail: "#241a17",
  railEdge: "#3a2c1c",
  /** The betting line scored into the cloth. */
  line: "rgba(214, 199, 127, 0.28)",
  /** The warm pool the overhead lamp puts on the felt. */
  lampPool: "rgba(255, 236, 180, 0.14)",
  /** The lattice the carpet tile is drawn in. See `carpetTile`. */
  carpetLine: "rgba(120, 62, 48, 0.14)",
  carpetLineFaint: "rgba(180, 140, 90, 0.07)",
} as const;

/**
 * Device pixel ratio ceiling.
 *
 * A modern phone reports 3 or 4, which would have the canvas shading nine to
 * sixteen times the pixels of a CSS-pixel-for-pixel render for a scene whose
 * entire content is soft gradients and painted discs. Two is where the
 * returns stop being visible on this material.
 */
export const MAX_PIXEL_RATIO = 2;
