/**
 * The handful of chip-drawing constants shared across the chip system.
 *
 * This file used to hold the whole geometry contract for an orthographic-
 * tilt camera room (a felt ellipse, a seat ring, a rail scale, a fixed chip
 * thickness) — that room (the classic `canvas_2d` table) was deleted
 * outright, and every one of those constants went with it. What's left is
 * only what the surviving chip system (`lib/scene/chips/`) and the
 * racetrack's own metres-per-world-unit conversion (`chip-space.ts`) still
 * read.
 */

/** A plain XYZ triple. X across the table, Y up, Z toward the viewer. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A representative camera elevation, expressed as its sine — the squash
 * ratio a disc lying flat on the felt would show foreshortened on screen.
 * 38 degrees matches the framing the old perspective camera used (it sat at
 * y=12, z=15 from its target: atan2(12, 15) ≈ 38.7°).
 *
 * Nothing computes a live tilt from this any more — the racetrack's own
 * perspective camera derives its squash per chip, per frame, from real
 * depth (`chip-spec.ts`'s `chipMetrics` takes that as its own `squash`
 * argument). This constant survives only as a realistic fixed value for
 * `chip-spec.test.ts` to exercise that parameter with.
 */
const TILT_DEG = 38;
export const TILT_SIN = Math.sin((TILT_DEG * Math.PI) / 180);

/**
 * A chip, in world units.
 *
 * Here rather than in `chip-layer.ts` (which still re-exports both, so every
 * existing caller is unchanged) because `chip-space.ts` needs the radius to
 * fix the racetrack room's metres-per-world-unit, and `chip-layer.ts` needs
 * `chip-space.ts` back -- an import cycle whose failure mode is a
 * `const`-in-temporal-dead-zone ReferenceError at module load, dependent on
 * which file the bundler happened to reach first. This file is a leaf and
 * cannot take part in one.
 */
export const CHIP_RADIUS = 0.14;

/**
 * Device pixel ratio ceiling.
 *
 * A modern phone reports 3 or 4, which would have the canvas shading nine to
 * sixteen times the pixels of a CSS-pixel-for-pixel render for a scene whose
 * entire content is soft gradients and painted discs. Two is where the
 * returns stop being visible on this material.
 */
export const MAX_PIXEL_RATIO = 2;
