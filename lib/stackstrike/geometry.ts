import type { Rect, Vec } from "./types";

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

export function lineOfSight(a: Vec, b: Vec, walls: readonly Rect[]): boolean {
  for (const wall of walls) {
    if (segmentRectHit(a, b, wall) !== null) return false;
  }
  return true;
}

/** True when a circle of this radius can travel a→b without touching a wall. */
export function segmentClear(a: Vec, b: Vec, radius: number, walls: readonly Rect[]): boolean {
  for (const wall of walls) {
    const grown = { x: wall.x - radius, y: wall.y - radius, w: wall.w + radius * 2, h: wall.h + radius * 2 };
    if (segmentRectHit(a, b, grown) !== null) return false;
  }
  return true;
}

/** Pushes a circle out of every rect it overlaps. Mutates and returns `pos`. */
export function resolveCircleAgainstRects(pos: Vec, radius: number, rects: readonly Rect[]): Vec {
  // Two passes: pushing out of one wall can press into the next at a corner.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const rect of rects) {
      const nearestX = Math.max(rect.x, Math.min(pos.x, rect.x + rect.w));
      const nearestY = Math.max(rect.y, Math.min(pos.y, rect.y + rect.h));
      const dx = pos.x - nearestX;
      const dy = pos.y - nearestY;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radius * radius) continue;

      if (distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        pos.x += (dx / dist) * push;
        pos.y += (dy / dist) * push;
        continue;
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
  }
  return pos;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
