import { PLAYER_GLOW, SHADOW } from "./content";
import { segmentRectHit } from "./geometry";
import type { Rect, Vec } from "./types";

/**
 * Light and sight shapes. The scene draws the dark and the enemies' flashlight
 * beams from these polygons, cut short by walls the same way the sim's line
 * of sight is, so what is drawn and what counts as seen agree.
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

/** A flashlight beam as a fan of points: the origin, then the far edge swept left to right. Walls cut it short. */
export function beamPolygon(
  origin: Vec,
  aim: number,
  walls: readonly Rect[],
  range: number,
  halfAngle: number,
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
export function glowPolygon(origin: Vec, walls: readonly Rect[], radius: number = PLAYER_GLOW.radius, rays = 32): Vec[] {
  const points: Vec[] = [];
  for (let n = 0; n < rays; n += 1) {
    points.push(castRay(origin, (n / rays) * Math.PI * 2, radius, walls));
  }
  return points;
}

/** How far a lit doorway reaches. Enemies stepping in are seen inside it, so the player can watch them come. */
export const DOOR_GLOW = 78;

/**
 * How boxed in a point is: rays are cast all round it and the share that hit a
 * wall within `reach` is returned. A corner or an alcove scores high, a flat
 * wall about a third, open floor zero. This is what "hugging a dark corner"
 * means to the sim.
 */
export function coverAt(point: Vec, walls: readonly Rect[], reach: number = SHADOW.reach, rays = 8): number {
  let blocked = 0;
  for (let n = 0; n < rays; n += 1) {
    const angle = (n / rays) * Math.PI * 2;
    const end = { x: point.x + Math.cos(angle) * reach, y: point.y + Math.sin(angle) * reach };
    if (walls.some((wall) => segmentRectHit(point, end, wall) !== null)) blocked += 1;
  }
  return blocked / rays;
}
