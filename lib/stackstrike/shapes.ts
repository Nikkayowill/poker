import { poly } from "./geometry";
import type { Disc, Poly, Vec, WallStyle } from "./types";

/**
 * Builders for the map. Curved and slanted walls are strings of short convex
 * pieces, so the sim only ever deals with blocks, discs and convex polygons.
 * Angles are degrees, 0 east, turning clockwise on screen (y runs down).
 */

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Longest stretch of a curved wall made from one piece. Shorter pieces follow the curve more closely. */
const ARC_STEP = 9;
/** Pieces overlap a hair so no crack opens between them. */
const SEAM = 0.6;

/** A band of wall of the given thickness along a circle's edge, from one angle to another. */
export function arcWall(cx: number, cy: number, radius: number, thickness: number, fromDeg: number, toDeg: number, style: WallStyle = "wall"): Poly[] {
  const span = toDeg - fromDeg;
  const pieces = Math.max(1, Math.ceil(Math.abs(span) / ARC_STEP));
  const inner = radius - thickness / 2;
  const outer = radius + thickness / 2;
  const out: Poly[] = [];
  for (let n = 0; n < pieces; n += 1) {
    const a0 = rad(fromDeg + (span * n) / pieces - (n > 0 ? SEAM : 0));
    const a1 = rad(fromDeg + (span * (n + 1)) / pieces + (n < pieces - 1 ? SEAM : 0));
    // The chord cuts inside the arc, so push the outer corners out to keep the band's full thickness.
    const bulge = 1 / Math.cos((a1 - a0) / 2);
    out.push(
      poly(
        [
          { x: cx + Math.cos(a0) * inner, y: cy + Math.sin(a0) * inner },
          { x: cx + Math.cos(a0) * outer * bulge, y: cy + Math.sin(a0) * outer * bulge },
          { x: cx + Math.cos(a1) * outer * bulge, y: cy + Math.sin(a1) * outer * bulge },
          { x: cx + Math.cos(a1) * inner, y: cy + Math.sin(a1) * inner },
        ],
        style,
      ),
    );
  }
  return out;
}

/** A full circle of wall with doorways: each gap is [centre angle, half its width in degrees]. */
export function ringWall(cx: number, cy: number, radius: number, thickness: number, gaps: [number, number][], style: WallStyle = "wall"): Poly[] {
  const norm = (deg: number) => ((deg % 360) + 360) % 360;
  const cuts = gaps.map(([centre, half]) => ({ from: norm(centre - half), to: norm(centre + half) })).sort((a, b) => a.from - b.from);
  if (cuts.length === 0) return arcWall(cx, cy, radius, thickness, 0, 360, style);
  const out: Poly[] = [];
  cuts.forEach((cut, i) => {
    const next = cuts[(i + 1) % cuts.length];
    const start = cut.to;
    let end = next.from;
    if (end <= start) end += 360;
    if (end > start) out.push(...arcWall(cx, cy, radius, thickness, start, end, style));
  });
  return out;
}

/** A straight wall of any angle, `thickness` wide, between two points. */
export function bar(from: Vec, to: Vec, thickness: number, style: WallStyle = "wall"): Poly {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * (thickness / 2);
  const ny = (dx / length) * (thickness / 2);
  return poly(
    [
      { x: from.x + nx, y: from.y + ny },
      { x: to.x + nx, y: to.y + ny },
      { x: to.x - nx, y: to.y - ny },
      { x: from.x - nx, y: from.y - ny },
    ],
    style,
  );
}

/** A block with its corners cut off, so nothing in the room has a sharp edge to catch on. Drawn rounded, blocks like this. */
export function chamfered(x: number, y: number, w: number, h: number, cut: number, style: WallStyle = "desk"): Poly {
  const c = Math.min(cut, w / 2, h / 2);
  return poly(
    [
      { x: x + c, y },
      { x: x + w - c, y },
      { x: x + w, y: y + c },
      { x: x + w, y: y + h - c },
      { x: x + w - c, y: y + h },
      { x: x + c, y: y + h },
      { x, y: y + h - c },
      { x, y: y + c },
    ],
    style,
  );
}

/** A round post. */
export function post(x: number, y: number, r: number, style: WallStyle = "pillar"): Disc {
  return { x, y, r, style };
}

/** A diagonal wedge filling a room corner, so the corner is cut at 45 degrees. `corner` is the sharp corner it fills. */
export function cutCorner(corner: Vec, size: number, toward: Vec, style: WallStyle = "wall"): Poly {
  const sx = Math.sign(toward.x - corner.x) || 1;
  const sy = Math.sign(toward.y - corner.y) || 1;
  return poly(
    [
      { x: corner.x, y: corner.y },
      { x: corner.x + sx * size, y: corner.y },
      { x: corner.x, y: corner.y + sy * size },
    ],
    style,
  );
}
