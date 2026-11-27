import type { Disc, Poly, Rect, Vec, Wall } from "./types";

/**
 * Fraction (0..1) along a→b where the segment first enters the rect, or null
 * if it never does. A segment that starts inside returns 0.
 */
export function segmentRectHit(a: Vec, b: Vec, rect: Rect): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let tMin = 0;
  let tMax = 1;

  const slabs: [number, number, number, number][] = [
    [a.x, dx, rect.x, rect.x + rect.w],
    [a.y, dy, rect.y, rect.y + rect.h],
  ];
  for (const [origin, delta, lo, hi] of slabs) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < lo || origin > hi) return null;
      continue;
    }
    let t1 = (lo - origin) / delta;
    let t2 = (hi - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** Fraction along a→b of the first contact with a circle, or null. */
export function segmentCircleHit(a: Vec, b: Vec, center: Vec, radius: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  const qa = dx * dx + dy * dy;
  if (qa < 1e-9) return null;
  const qb = 2 * (fx * dx + fy * dy);
  const disc = qb * qb - 4 * qa * c;
  if (disc < 0) return null;
  const t = (-qb - Math.sqrt(disc)) / (2 * qa);
  return t >= 0 && t <= 1 ? t : null;
}

export function isDisc(wall: Wall): wall is Disc {
  return "r" in wall;
}

export function isPoly(wall: Wall): wall is Poly {
  return "points" in wall;
}

/** Shoelace area, positive when the points run the way `poly()` winds them. */
function area(points: readonly Vec[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** A convex shape wound the way every routine here expects, with its bounds worked out once. */
export function poly(points: readonly Vec[], style?: Poly["style"]): Poly {
  const wound = area(points) < 0 ? [...points].reverse() : [...points];
  const shape: Poly = { points: wound.map((p) => ({ x: p.x, y: p.y })), style };
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  boundsCache.set(shape, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  return shape;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boundsCache = new WeakMap<Poly, Bounds>();

function polyBounds(shape: Poly): Bounds {
  let bounds = boundsCache.get(shape);
  if (!bounds) {
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    bounds = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    boundsCache.set(shape, bounds);
  }
  return bounds;
}

/** The smallest block that holds a wall. */
export function wallBounds(wall: Wall): Rect {
  if (isDisc(wall)) return { x: wall.x - wall.r, y: wall.y - wall.r, w: wall.r * 2, h: wall.r * 2 };
  if (isPoly(wall)) {
    const b = polyBounds(wall);
    return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }
  return wall;
}

/** Fraction along a→b where the segment first enters a convex polygon, or null. Starting inside gives 0. */
export function segmentPolyHit(a: Vec, b: Vec, shape: Poly): number | null {
  const bounds = polyBounds(shape);
  if (Math.max(a.x, b.x) < bounds.x0 || Math.min(a.x, b.x) > bounds.x1 || Math.max(a.y, b.y) < bounds.y0 || Math.min(a.y, b.y) > bounds.y1) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let tMin = 0;
  let tMax = 1;
  const pts = shape.points;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    // Inward normal of the edge: the inside is on its left.
    const nx = -(q.y - p.y);
    const ny = q.x - p.x;
    const start = (a.x - p.x) * nx + (a.y - p.y) * ny;
    const along = dx * nx + dy * ny;
    if (Math.abs(along) < 1e-9) {
      if (start < 0) return null;
      continue;
    }
    const t = -start / along;
    if (along > 0) tMin = Math.max(tMin, t);
    else tMax = Math.min(tMax, t);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** Fraction along a→b of the first contact with this wall, or null. */
export function segmentWallHit(a: Vec, b: Vec, wall: Wall): number | null {
  if (isDisc(wall)) return segmentCircleHit(a, b, wall, wall.r);
  if (isPoly(wall)) return segmentPolyHit(a, b, wall);
  return segmentRectHit(a, b, wall);
}

export function lineOfSight(a: Vec, b: Vec, walls: readonly Wall[]): boolean {
  for (const wall of walls) {
    if (segmentWallHit(a, b, wall) !== null) return false;
  }
  return true;
}

function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function crosses(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Shortest gap between two segments, zero when they cross. */
function segmentGap(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (crosses(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Distance from a point to the nearest part of a wall, zero inside it. */
export function distanceToWall(x: number, y: number, wall: Wall): number {
  if (isDisc(wall)) return Math.max(0, Math.hypot(x - wall.x, y - wall.y) - wall.r);
  if (isPoly(wall)) {
    const p = { x, y };
    const pts = wall.points;
    let inside = true;
    let best = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const from = pts[i];
      const to = pts[(i + 1) % pts.length];
      if ((to.x - from.x) * (y - from.y) - (to.y - from.y) * (x - from.x) < 0) inside = false;
      best = Math.min(best, pointSegmentDistance(p, from, to));
    }
    return inside ? 0 : best;
  }
  const nx = Math.max(wall.x, Math.min(x, wall.x + wall.w));
  const ny = Math.max(wall.y, Math.min(y, wall.y + wall.h));
  return Math.hypot(x - nx, y - ny);
}

/** True when a circle of this radius can travel a→b without touching a wall. */
export function segmentClear(a: Vec, b: Vec, radius: number, walls: readonly Wall[]): boolean {
  for (const wall of walls) {
    if (isDisc(wall)) {
      if (segmentCircleHit(a, b, wall, wall.r + radius) !== null) return false;
    } else if (isPoly(wall)) {
      if (segmentPolyHit(a, b, wall) !== null) return false;
      const pts = wall.points;
      for (let i = 0; i < pts.length; i += 1) {
        if (segmentGap(a, b, pts[i], pts[(i + 1) % pts.length]) < radius) return false;
      }
    } else {
      const grown = { x: wall.x - radius, y: wall.y - radius, w: wall.w + radius * 2, h: wall.h + radius * 2 };
      if (segmentRectHit(a, b, grown) !== null) return false;
    }
  }
  return true;
}

function pushOutOfDisc(pos: Vec, radius: number, disc: Disc): void {
  const dx = pos.x - disc.x;
  const dy = pos.y - disc.y;
  const dist = Math.hypot(dx, dy);
  const need = radius + disc.r;
  if (dist >= need) return;
  if (dist < 1e-9) {
    pos.x = disc.x + need;
    return;
  }
  pos.x = disc.x + (dx / dist) * need;
  pos.y = disc.y + (dy / dist) * need;
}

function pushOutOfPoly(pos: Vec, radius: number, shape: Poly): void {
  const pts = shape.points;
  let inside = true;
  let shallow = -Infinity;
  let shallowEdge = 0;
  let nearest = Infinity;
  let nearestPoint: Vec = pts[0];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const length = Math.hypot(ex, ey) || 1;
    // Signed distance in from this edge: negative means outside it.
    const depth = (-ey * (pos.x - p.x) + ex * (pos.y - p.y)) / length;
    if (depth < 0) inside = false;
    if (depth > shallow) {
      shallow = depth;
      shallowEdge = i;
    }
    const t = Math.max(0, Math.min(1, ((pos.x - p.x) * ex + (pos.y - p.y) * ey) / (length * length)));
    const cx = p.x + ex * t;
    const cy = p.y + ey * t;
    const d = Math.hypot(pos.x - cx, pos.y - cy);
    if (d < nearest) {
      nearest = d;
      nearestPoint = { x: cx, y: cy };
    }
  }
  if (inside) {
    // Centre is in the shape: leave by the nearest face.
    const p = pts[shallowEdge];
    const q = pts[(shallowEdge + 1) % pts.length];
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = (q.y - p.y) / length;
    const ny = -(q.x - p.x) / length;
    pos.x += nx * (shallow + radius);
    pos.y += ny * (shallow + radius);
    return;
  }
  if (nearest >= radius || nearest < 1e-9) return;
  pos.x += ((pos.x - nearestPoint.x) / nearest) * (radius - nearest);
  pos.y += ((pos.y - nearestPoint.y) / nearest) * (radius - nearest);
}

/** Pushes a circle out of every wall it overlaps. Mutates and returns `pos`. */
export function resolveCircleAgainstWalls(pos: Vec, radius: number, walls: readonly Wall[]): Vec {
  // Two passes: pushing out of one wall can press into the next at a corner.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const wall of walls) {
      if (isDisc(wall)) {
        pushOutOfDisc(pos, radius, wall);
        continue;
      }
      if (isPoly(wall)) {
        pushOutOfPoly(pos, radius, wall);
        continue;
      }
      pushOutOfRect(pos, radius, wall);
    }
  }
  return pos;
}

function pushOutOfRect(pos: Vec, radius: number, rect: Rect): void {
  const nearestX = Math.max(rect.x, Math.min(pos.x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(pos.y, rect.y + rect.h));
  const dx = pos.x - nearestX;
  const dy = pos.y - nearestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= radius * radius) return;

  if (distSq > 1e-9) {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    pos.x += (dx / dist) * push;
    pos.y += (dy / dist) * push;
    return;
  }
  // Centre is inside the rect: leave by the nearest face.
  const left = pos.x - rect.x;
  const right = rect.x + rect.w - pos.x;
  const top = pos.y - rect.y;
  const bottom = rect.y + rect.h - pos.y;
  const least = Math.min(left, right, top, bottom);
  if (least === left) pos.x = rect.x - radius;
  else if (least === right) pos.x = rect.x + rect.w + radius;
  else if (least === top) pos.y = rect.y - radius;
  else pos.y = rect.y + rect.h + radius;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
