/**
 * Tap-to-move. A tap becomes a path over the 16px tile grid (breadth-first,
 * eight directions, no cutting a blocked corner), smoothed so the farmer walks
 * straight wherever the line between two points is clear. A tap on a blocked
 * tile walks to the nearest open tile beside it, so tapping a barn walks you up
 * to the barn.
 *
 * The old plan said "straight line, no A*". In play that meant stopping dead
 * against a signpost, which a young player reads as broken. An area is at most
 * 44 x 32 tiles, so a full search costs nothing.
 *
 * Pure, so it is tested without Phaser (movement.test.ts).
 */

export interface Point {
  x: number;
  y: number;
}

export type Blocked = Set<string>;

export interface Grid {
  width: number;
  height: number;
  tile: number;
  blocked: Blocked;
}

export function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

function tileOf(p: Point, tile: number): [number, number] {
  return [Math.floor(p.x / tile), Math.floor(p.y / tile)];
}

function open(grid: Grid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height && !grid.blocked.has(tileKey(tx, ty));
}

const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Every tile along the segment, sampled at quarter-tile steps, is open. */
export function lineClear(grid: Grid, a: Point, b: Point): boolean {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(length / (grid.tile / 4)));
  for (let i = 0; i <= n; i++) {
    const [tx, ty] = tileOf({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, grid.tile);
    if (!open(grid, tx, ty)) return false;
  }
  return true;
}

/** Waypoints from `from` to `to` (the last one is the destination), or [] when nothing is reachable. */
export function findPath(grid: Grid, from: Point, to: Point): Point[] {
  const { tile } = grid;
  const [sx, sy] = tileOf(from, tile);
  const [gx, gy] = tileOf(to, tile);
  const centre = (tx: number, ty: number): Point => ({ x: tx * tile + tile / 2, y: ty * tile + tile / 2 });

  const cameFrom = new Map<string, string | null>([[tileKey(sx, sy), null]]);
  const queue: [number, number][] = [[sx, sy]];
  let best: [number, number] = [sx, sy];
  let bestDist = Math.hypot(gx - sx, gy - sy);
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    const dist = Math.hypot(gx - x, gy - y);
    if (dist < bestDist) {
      best = [x, y];
      bestDist = dist;
    }
    if (x === gx && y === gy) break;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(grid, nx, ny) || cameFrom.has(tileKey(nx, ny))) continue;
      if (dx && dy && (!open(grid, x + dx, y) || !open(grid, x, y + dy))) continue;
      cameFrom.set(tileKey(nx, ny), tileKey(x, y));
      queue.push([nx, ny]);
    }
  }

  const reachedGoal = best[0] === gx && best[1] === gy;
  const tiles: Point[] = [];
  for (let key: string | null = tileKey(best[0], best[1]); key; key = cameFrom.get(key) ?? null) {
    const [tx, ty] = key.split(",").map(Number);
    tiles.unshift(centre(tx, ty));
  }
  tiles.shift();
  if (reachedGoal) {
    tiles.pop();
    tiles.push({ x: to.x, y: to.y });
  }
  if (tiles.length === 0) return reachedGoal ? [{ x: to.x, y: to.y }] : [];

  const smoothed: Point[] = [];
  let anchor = from;
  let i = 0;
  while (i < tiles.length) {
    let j = tiles.length - 1;
    while (j > i && !lineClear(grid, anchor, tiles[j])) j--;
    smoothed.push(tiles[j]);
    anchor = tiles[j];
    i = j + 1;
  }
  return smoothed;
}

/** Move `distance` along the waypoints, returning the new position and the waypoints still ahead. */
export function advance(from: Point, path: Point[], distance: number): { at: Point; path: Point[] } {
  let at = from;
  let left = distance;
  const rest = path.slice();
  while (rest.length && left > 0) {
    const next = rest[0];
    const gap = Math.hypot(next.x - at.x, next.y - at.y);
    if (gap <= left) {
      at = next;
      left -= gap;
      rest.shift();
    } else {
      at = { x: at.x + ((next.x - at.x) * left) / gap, y: at.y + ((next.y - at.y) * left) / gap };
      left = 0;
    }
  }
  return { at, path: rest };
}
