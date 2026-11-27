import { distanceToWall, segmentClear } from "./geometry";
import type { Arena, Vec, Wall } from "./types";

/**
 * Grid A* for enemies. The arena is cut into square cells; a cell is blocked
 * when its centre is too close to a wall for the widest enemy to stand in it.
 * Paths come back as world positions with unneeded corners pulled out, so
 * enemies walk straight lines between a few waypoints rather than a staircase.
 */

export interface NavGrid {
  cell: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
}

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

export function buildNavGrid(arena: Arena, cell = 20, clearance = 18): NavGrid {
  const cols = Math.ceil(arena.width / cell);
  const rows = Math.ceil(arena.height / cell);
  const blocked = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = (col + 0.5) * cell;
      const cy = (row + 0.5) * cell;
      if (arena.walls.some((wall) => distanceToWall(cx, cy, wall) < clearance)) blocked[row * cols + col] = 1;
    }
  }
  return { cell, cols, rows, blocked };
}

const gridCache = new WeakMap<Arena, NavGrid>();

export function navGridFor(arena: Arena): NavGrid {
  let grid = gridCache.get(arena);
  if (!grid) {
    grid = buildNavGrid(arena);
    gridCache.set(arena, grid);
  }
  return grid;
}

export function cellOf(grid: NavGrid, p: Vec): number {
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor(p.x / grid.cell)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(p.y / grid.cell)));
  return row * grid.cols + col;
}

/** The point itself if its cell is open, else the nearest open cell within a few steps. */
export function nearestOpen(grid: NavGrid, index: number): number | null {
  if (!grid.blocked[index]) return index;
  const col0 = index % grid.cols;
  const row0 = Math.floor(index / grid.cols);
  for (let radius = 1; radius <= 4; radius += 1) {
    let best: number | null = null;
    let bestDist = Infinity;
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        const col = col0 + dc;
        const row = row0 + dr;
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
        const candidate = row * grid.cols + col;
        const dist = Math.hypot(dc, dr);
        if (!grid.blocked[candidate] && dist < bestDist) {
          best = candidate;
          bestDist = dist;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** Binary min-heap keyed on score, holding cell indices. */
class Heap {
  private items: number[] = [];
  constructor(private readonly score: Float32Array) {}
  get size(): number {
    return this.items.length;
  }
  push(index: number): void {
    const items = this.items;
    items.push(index);
    let child = items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.score[items[parent]] <= this.score[items[child]]) break;
      [items[parent], items[child]] = [items[child], items[parent]];
      child = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as number;
    if (items.length > 0) {
      items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < items.length && this.score[items[left]] < this.score[items[smallest]]) smallest = left;
        if (right < items.length && this.score[items[right]] < this.score[items[smallest]]) smallest = right;
        if (smallest === parent) break;
        [items[parent], items[smallest]] = [items[smallest], items[parent]];
        parent = smallest;
      }
    }
    return top;
  }
}

/**
 * Waypoints from `from` to `to`, or null if no route exists. `radius` is the
 * body size used to pull corners straight, so a smoothed path never grazes a
 * wall the enemy would catch on.
 */
export function findPath(grid: NavGrid, walls: readonly Wall[], from: Vec, to: Vec, radius: number): Vec[] | null {
  const start = nearestOpen(grid, cellOf(grid, from));
  const goal = nearestOpen(grid, cellOf(grid, to));
  if (start === null || goal === null) return null;

  const size = grid.cols * grid.rows;
  const g = new Float32Array(size).fill(Infinity);
  const f = new Float32Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const goalCol = goal % grid.cols;
  const goalRow = Math.floor(goal / grid.cols);
  const heuristic = (index: number): number => {
    const dx = Math.abs((index % grid.cols) - goalCol);
    const dy = Math.abs(Math.floor(index / grid.cols) - goalRow);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  const open = new Heap(f);
  g[start] = 0;
  f[start] = heuristic(start);
  open.push(start);

  let reached = false;
  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goal) {
      reached = true;
      break;
    }
    const col = current % grid.cols;
    const row = Math.floor(current / grid.cols);
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      const next = nr * grid.cols + nc;
      if (grid.blocked[next] || closed[next]) continue;
      // No squeezing diagonally between two blocked corners.
      if (dc !== 0 && dr !== 0 && (grid.blocked[row * grid.cols + nc] || grid.blocked[nr * grid.cols + col])) continue;
      const tentative = g[current] + cost;
      if (tentative < g[next]) {
        g[next] = tentative;
        f[next] = tentative + heuristic(next);
        parent[next] = current;
        open.push(next);
      }
    }
  }
  if (!reached) return null;

  const cells: Vec[] = [];
  for (let at = goal; at !== -1; at = parent[at]) {
    cells.push({ x: ((at % grid.cols) + 0.5) * grid.cell, y: (Math.floor(at / grid.cols) + 0.5) * grid.cell });
  }
  cells.reverse();
  // The real end point replaces the last cell centre when it is reachable from there.
  cells.push({ x: to.x, y: to.y });

  // String-pull: from each anchor, jump to the farthest waypoint still in the clear.
  const route: Vec[] = [];
  let anchor: Vec = from;
  let i = 0;
  while (i < cells.length) {
    let far = i;
    for (let j = cells.length - 1; j > i; j -= 1) {
      if (segmentClear(anchor, cells[j], radius, walls)) {
        far = j;
        break;
      }
    }
    route.push(cells[far]);
    anchor = cells[far];
    i = far + 1;
  }
  return route;
}
