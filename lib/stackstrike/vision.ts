import { AIM_ASSIST, PLAYER_GLOW, SENSE, SHADOW } from "./content";
import { distance, lineOfSight, segmentRectHit } from "./geometry";
import type { Arena, EnemyState, Rect, Room, Vec } from "./types";

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

/** The room a point is in, or the nearest one when it stands in a doorway. */
export function roomAt(arena: Arena, point: Vec): Room | null {
  let best: Room | null = null;
  let bestDistance = Infinity;
  for (const room of arena.rooms) {
    const { x, y, w, h } = room.rect;
    const dx = Math.max(x - point.x, 0, point.x - (x + w));
    const dy = Math.max(y - point.y, 0, point.y - (y + h));
    const dist = Math.hypot(dx, dy);
    if (dist < bestDistance) {
      best = room;
      bestDistance = dist;
    }
  }
  return best;
}

/**
 * Nudges an aim angle toward a visible enemy that is almost in the sights, so a
 * thumb on a small screen does not have to be perfect. The pull is strongest
 * dead on and fades to nothing at the edge of the cone.
 */
export function assistAim(
  aim: number,
  from: Vec,
  targets: readonly { pos: Vec; radius: number }[],
  walls: readonly Rect[],
  range: number,
): number {
  let best = aim;
  let bestOff = Infinity;
  for (const target of targets) {
    const dist = distance(from, target.pos);
    if (dist > range || dist < 1) continue;
    // A farther enemy covers fewer degrees, so the cone shrinks with distance.
    const cone = Math.min(AIM_ASSIST.maxCone, Math.atan2(target.radius + AIM_ASSIST.slack, dist));
    const angle = Math.atan2(target.pos.y - from.y, target.pos.x - from.x);
    const off = Math.abs(angleDiff(aim, angle));
    if (off > cone || off >= bestOff) continue;
    if (!lineOfSight(from, target.pos, walls)) continue;
    bestOff = off;
    best = aim + angleDiff(aim, angle) * AIM_ASSIST.pull * (1 - off / cone);
  }
  return best;
}

/**
 * The guards the player can make out: everyone within `SENSE.range`, walls or
 * no walls. They are fully clear when close and fade toward the edge of the
 * range, and anyone farther off is not shown at all until the player gets closer.
 */
export function sensedEnemies(player: Vec, enemies: readonly EnemyState[]): { enemy: EnemyState; strength: number }[] {
  const out: { enemy: EnemyState; strength: number }[] = [];
  for (const enemy of enemies) {
    const dist = distance(player, enemy.pos);
    if (dist > SENSE.range) continue;
    const fade = dist <= SENSE.clearRange ? 1 : 1 - (dist - SENSE.clearRange) / (SENSE.range - SENSE.clearRange);
    out.push({ enemy, strength: SENSE.farStrength + (1 - SENSE.farStrength) * fade });
  }
  return out;
}
