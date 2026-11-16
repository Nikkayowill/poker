import { FLASHLIGHT } from "./content";
import { distance, lineOfSight, segmentRectHit } from "./geometry";
import type { Entry, Rect, Vec } from "./types";

/**
 * What the player can see. The scene draws the dark from these polygons and
 * the sim asks `isLit` about enemies, so what is drawn and what counts as
 * seen never disagree.
 */

/** Shortest signed angle from `from` to `to`, in -PI..PI. */
export function angleDiff(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function castRay(origin: Vec, angle: number, range: number, walls: readonly Rect[]): Vec {
  const end = { x: origin.x + Math.cos(angle) * range, y: origin.y + Math.sin(angle) * range };
  let nearest = 1;
  for (const wall of walls) {
    const t = segmentRectHit(origin, end, wall);
    if (t !== null && t < nearest) nearest = t;
  }
  return { x: origin.x + (end.x - origin.x) * nearest, y: origin.y + (end.y - origin.y) * nearest };
}

/** The beam as a fan of points: the origin, then the far edge swept left to right. Walls cut it short. */
export function beamPolygon(
  origin: Vec,
  aim: number,
  walls: readonly Rect[],
  range: number = FLASHLIGHT.range,
  halfAngle: number = FLASHLIGHT.halfAngle,
  rays = 60,
): Vec[] {
  const points: Vec[] = [{ x: origin.x, y: origin.y }];
  for (let n = 0; n <= rays; n += 1) {
    const angle = aim - halfAngle + (halfAngle * 2 * n) / rays;
    points.push(castRay(origin, angle, range, walls));
  }
  return points;
}

/** A full circle of sight around the origin, cut short by walls. */
export function glowPolygon(origin: Vec, walls: readonly Rect[], radius: number = FLASHLIGHT.ambient, rays = 32): Vec[] {
  const points: Vec[] = [];
  for (let n = 0; n < rays; n += 1) {
    points.push(castRay(origin, (n / rays) * Math.PI * 2, radius, walls));
  }
  return points;
}

/** True if a point is inside the beam, or right beside the player, with nothing in the way. */
export function isLit(origin: Vec, aim: number, lightOn: boolean, point: Vec, walls: readonly Rect[]): boolean {
  const dist = distance(origin, point);
  if (dist <= FLASHLIGHT.ambient) return lineOfSight(origin, point, walls);
  if (!lightOn || dist > FLASHLIGHT.range) return false;
  const toPoint = Math.atan2(point.y - origin.y, point.x - origin.x);
  if (Math.abs(angleDiff(aim, toPoint)) > FLASHLIGHT.halfAngle) return false;
  return lineOfSight(origin, point, walls);
}

/** How far a lit doorway reaches. Enemies stepping in are seen inside it, so the player can watch them come. */
export const DOOR_GLOW = 78;

export function nearDoor(point: Vec, entries: readonly Entry[], radius: number = DOOR_GLOW): boolean {
  return entries.some((entry) => distance(entry.pos, point) <= radius);
}
