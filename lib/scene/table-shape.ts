/**
 * The felt's plan shape: a stadium (a.k.a. "racetrack" or "discorectangle")
 * outline — two straight edges joined by semicircular ends, the shape every
 * real oval poker table is actually cut to.
 *
 * Originally written for the WebGL 3D room's own table mesh, which used to
 * approximate the table as a pure ellipse: circular three.js primitives
 * (torus/cylinder/ring) non-uniformly scaled on X/Z. That has two real
 * defects past just "wrong shape" — an ellipse has no straight run at all
 * (the sides bow continuously), and non-uniformly scaling a torus also
 * scales its tube cross-section, so the rail cushion came out visibly
 * fatter along the long sides than at the ends. A stadium built from a real
 * 2D outline has a uniform-width rail everywhere and a true straight edge
 * along the sides, matching a real table's cut.
 *
 * The 3D room was deleted outright (recoverable from the
 * `archive/webgl-3d-table` git tag, not from this tree) but this module
 * moved to `lib/scene/` rather than going with it: `lib/scene/table-anchors.ts`
 * -- the live racetrack table's own anchor math -- depends on it too. Pure
 * math, no three.js import, so `npm test` reaches it regardless of which
 * renderer is calling in.
 */

export interface StadiumPoint {
  x: number;
  z: number;
}

export const STADIUM_CAP_SEGMENTS = 24;

/**
 * Half the straight run between the two end-cap centres. Zero (not
 * negative) once the shape is rounder than it is long — at that point every
 * "straight edge" has zero length and the outline is just two coincident
 * semicircles, i.e. a circle.
 */
export function stadiumStraightHalf(halfLength: number, halfWidth: number): number {
  return Math.max(0, halfLength - halfWidth);
}

/**
 * Traces the stadium's perimeter counter-clockwise (x right, z "up" in this
 * 2D plan — the same frame seat-layout.ts's seatPosition uses for its own
 * X/Z axes), starting at the near-right corner and sweeping first through
 * the right cap, then the left.
 *
 * Returns only the curved cap points; the two straight edges are the
 * implicit segments between arc index `capSegments` (end of the right cap)
 * and `capSegments + 1` (start of the left cap), and between the last point
 * and the first — a consumer building a THREE.Shape via moveTo/lineTo/
 * closePath gets the straight edges for free from those implicit segments.
 */
export function stadiumOutline(
  halfLength: number,
  halfWidth: number,
  capSegments: number = STADIUM_CAP_SEGMENTS,
): StadiumPoint[] {
  const straightHalf = stadiumStraightHalf(halfLength, halfWidth);
  const points: StadiumPoint[] = [];

  // Right cap: bottom-right corner up through the far-right point to the
  // top-right corner.
  for (let i = 0; i <= capSegments; i += 1) {
    const t = -Math.PI / 2 + (i / capSegments) * Math.PI;
    points.push({
      x: straightHalf + Math.cos(t) * halfWidth,
      z: Math.sin(t) * halfWidth,
    });
  }

  // Left cap: top-left corner down through the far-left point to the
  // bottom-left corner.
  for (let i = 0; i <= capSegments; i += 1) {
    const t = Math.PI / 2 + (i / capSegments) * Math.PI;
    points.push({
      x: -straightHalf + Math.cos(t) * halfWidth,
      z: Math.sin(t) * halfWidth,
    });
  }

  return points;
}

/** Uniformly grows (or shrinks, with a negative `delta`) a stadium's plan
 * by `delta` on every side — the same operation a real cushion's width or
 * an inset ring performs. Because the cap radius IS the half-width, adding
 * `delta` to both half-extents keeps the straight run's length unchanged
 * and simply grows the cap radius, which is the correct offset curve of a
 * stadium (unlike a rounded rectangle with an independent corner radius). */
export function offsetStadium(
  halfLength: number,
  halfWidth: number,
  delta: number,
): { halfLength: number; halfWidth: number } {
  return {
    halfLength: Math.max(0, halfLength + delta),
    halfWidth: Math.max(0, halfWidth + delta),
  };
}
