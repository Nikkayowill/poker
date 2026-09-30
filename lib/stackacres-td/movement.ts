/**
 * How the farmer walks: tap-to-move, and the thumb stick at the end of this file.
 *
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

/**
 * Breadth-first over the tiles from (sx, sy) toward (gx, gy): the tiles walked, start first, to the goal
 * or, when it can't be reached, to the open tile nearest it.
 */
function searchTiles(grid: Grid, sx: number, sy: number, gx: number, gy: number): { tiles: [number, number][]; reachedGoal: boolean } {
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
  const tiles: [number, number][] = [];
  for (let key: string | null = tileKey(best[0], best[1]); key; key = cameFrom.get(key) ?? null) {
    const [tx, ty] = key.split(",").map(Number);
    tiles.unshift([tx, ty]);
  }
  return { tiles, reachedGoal: best[0] === gx && best[1] === gy };
}

/** The tiles, one step at a time, from `from` to `to` (the start left out), or null when `to` can't be reached. */
export function tilePath(grid: Grid, from: [number, number], to: [number, number]): [number, number][] | null {
  if (!open(grid, to[0], to[1])) return null;
  const { tiles, reachedGoal } = searchTiles(grid, from[0], from[1], to[0], to[1]);
  return reachedGoal ? tiles.slice(1) : null;
}

/** Waypoints from `from` to `to` (the last one is the destination), or [] when nothing is reachable. */
export function findPath(grid: Grid, from: Point, to: Point): Point[] {
  const { tile } = grid;
  const [sx, sy] = tileOf(from, tile);
  const [gx, gy] = tileOf(to, tile);
  const centre = (tx: number, ty: number): Point => ({ x: tx * tile + tile / 2, y: ty * tile + tile / 2 });

  const { tiles: walked, reachedGoal } = searchTiles(grid, sx, sy, gx, gy);
  const tiles: Point[] = walked.map(([tx, ty]) => centre(tx, ty));
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

// ------------------------------------------------------------------ the joystick

/**
 * The thumb stick in the bottom-right corner walks the farmer directly, beside tap-to-move.
 *
 * A stick moves him a few pixels at a time wherever he is, not tile centre to tile centre,
 * so he needs a body: a small box around his feet, about the width of his shadow.
 */
export const FOOT = { halfWidth: 5, halfHeight: 3 };

/** Under this share of the stick's reach, a resting thumb doesn't walk him. */
export const STICK_DEAD_ZONE = 0.2;

/**
 * How far sideways he is nudged round a corner he is a few pixels off, so a gateway doesn't catch
 * him on its post -- a full tile plus his own half-width, so the search always reaches past a
 * single blocked tile beside him no matter where in it his feet happen to have landed. The old
 * value (7px, under half a tile) could leave him permanently boxed against a one-tile obstacle:
 * decorative props beside a building routinely sat him a few px into a blocked tile's neighbour,
 * and 7px was never enough to slide him clear of it, while tap-to-move's tile-level pathfinding
 * routed around the same obstacle with no trouble (Kayo, 2026-09-24: "hard to walk behind
 * buildings" -- reproduced with the joystick specifically, not with tap-to-move).
 */
const CORNER_ASSIST = (grid: Grid) => grid.tile + FOOT.halfWidth;
/** The longest single move before collision is checked again, well under a tile. */
const SUBSTEP = 4;

/**
 * A thumb `dx, dy` css px from the stick's centre, with `radius` the knob's full reach,
 * as a direction at full walking speed; null inside the dead zone.
 *
 * Digital, not analog: a real walk cycle has one cadence, so a stick that throttled speed
 * continuously between "just past the dead zone" and "full push" left his legs moving at
 * whatever fraction the thumb happened to land on, with no stride ever actually landing --
 * he read as gliding rather than walking (Kayo, 2026-09-24). Past the dead zone he always
 * walks at full speed; the stick only ever picks a direction.
 */
export function stickVector(dx: number, dy: number, radius: number): Point | null {
  const reach = Math.hypot(dx, dy) / radius;
  if (reach < STICK_DEAD_ZONE) return null;
  const length = Math.hypot(dx, dy);
  return { x: dx / length, y: dy / length };
}

/** Every tile under his feet at `p` is open. */
export function footClear(grid: Grid, p: Point): boolean {
  const { halfWidth: w, halfHeight: h } = FOOT;
  for (const [x, y] of [[p.x - w, p.y - h], [p.x + w, p.y - h], [p.x - w, p.y + h], [p.x + w, p.y + h]]) {
    const [tx, ty] = tileOf({ x, y }, grid.tile);
    if (!open(grid, tx, ty)) return false;
  }
  return true;
}

/**
 * One step of `distance` px along the unit vector `dir`: straight on if his feet fit, sliding along a wall
 * if only one axis is blocked, or nudged round a corner he is nearly past.
 */
function stepOnce(grid: Grid, from: Point, dir: Point, distance: number): Point {
  // A tap walk can leave his feet overlapping a building's edge; he may always walk back out of it.
  const stuck = !footClear(grid, from);
  const fits = (p: Point) => footClear(grid, p) || (stuck && open(grid, ...tileOf(p, grid.tile)));

  const straight = { x: from.x + dir.x * distance, y: from.y + dir.y * distance };
  if (fits(straight)) return straight;
  // Close the last few pixels to the wall rather than stopping a step short of it.
  for (let part = distance / 2; part >= 0.25; part /= 2) {
    const shorter = { x: from.x + dir.x * part, y: from.y + dir.y * part };
    if (fits(shorter)) return shorter;
  }

  const alongX = { x: straight.x, y: from.y };
  const alongY = { x: from.x, y: straight.y };
  const [first, second] = Math.abs(dir.x) >= Math.abs(dir.y) ? [alongX, alongY] : [alongY, alongX];
  // Only slide along an axis he is really pushing on, so a nearly-straight push doesn't creep him sideways.
  if (Math.abs(first === alongX ? dir.x : dir.y) > 0.25 && fits(first)) return first;
  if (Math.abs(second === alongX ? dir.x : dir.y) > 0.25 && fits(second)) return second;

  // Pushing mostly one way into a corner: find the nearest sideways offset that would let him through.
  const horizontal = Math.abs(dir.x) > Math.abs(dir.y);
  const forward = horizontal ? { x: Math.sign(dir.x) * distance, y: 0 } : { x: 0, y: Math.sign(dir.y) * distance };
  const assist = CORNER_ASSIST(grid);
  for (let offset = 1; offset <= assist; offset++) {
    for (const side of [-1, 1]) {
      const shifted = horizontal ? { x: from.x, y: from.y + side * offset } : { x: from.x + side * offset, y: from.y };
      if (!fits(shifted) || !fits({ x: shifted.x + forward.x, y: shifted.y + forward.y })) continue;
      const nudge = Math.min(distance, offset) * side;
      return horizontal ? { x: from.x, y: from.y + nudge } : { x: from.x + nudge, y: from.y };
    }
  }
  return from;
}

/** Walk `distance` px along `dir` (any length; only its direction counts) through the grid's open tiles. */
export function steer(grid: Grid, from: Point, dir: Point, distance: number): Point {
  const length = Math.hypot(dir.x, dir.y);
  if (length === 0 || distance <= 0) return from;
  const unit = { x: dir.x / length, y: dir.y / length };
  let at = from;
  for (let left = distance; left > 0; left -= SUBSTEP) at = stepOnce(grid, at, unit, Math.min(SUBSTEP, left));
  return at;
}

/**
 * Where to stand to work a prop at `at` (a tree, a stone, a signpost): one of its four sides, picked
 * as whichever is open ground and nearest wherever he already is (`from`), so he approaches -- and so
 * faces it -- from whatever side he is already on, rather than always being walked round to the same
 * fixed side. Falls back to the first candidate when his feet wouldn't fit on any of them (an object
 * boxed in on three sides still gets stood next to on the one side that is open).
 */
export function approachSpot(grid: Grid, from: Point, at: Point, w: number, h: number): { anchor: Point; face: Point } {
  const dx = w / 2 + 8;
  const dy = Math.min(h / 4, 20) + 8;
  const candidates: Point[] = [
    { x: at.x, y: at.y + dy },
    { x: at.x, y: at.y - dy },
    { x: at.x - dx, y: at.y },
    { x: at.x + dx, y: at.y },
  ];
  const open = candidates.filter((p) => footClear(grid, p));
  const pool = open.length ? open : candidates;
  let anchor = pool[0];
  let nearest = Infinity;
  for (const p of pool) {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < nearest) {
      nearest = d;
      anchor = p;
    }
  }
  return { anchor, face: at };
}
