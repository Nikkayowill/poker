import { cellOf, nearestOpen, type NavGrid } from "./pathfinding";
import type { Vec } from "./types";

/**
 * One map of "how far to the player" for the whole crowd. It is built once from
 * the player's cell and every zombie reads its own cell off it, so forty
 * zombies cost the same to steer as one. The grid is the one the A* uses.
 */

export interface FlowField {
  grid: NavGrid;
  /** Walking distance in cells from each cell to the goal. Infinity where it cannot be reached. */
  dist: Float32Array;
  goal: number;
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Fills `into` (or a fresh field) with the walking distance from every open cell to `goal`. */
export function buildFlow(grid: NavGrid, goal: Vec, into?: FlowField): FlowField {
  const size = grid.cols * grid.rows;
  const dist = into && into.dist.length === size ? into.dist : new Float32Array(size);
  dist.fill(Infinity);
  const start = nearestOpen(grid, cellOf(grid, goal));
  const field: FlowField = { grid, dist, goal: start ?? -1 };
  if (start === null) return field;

  // Queue-based relaxation. On a grid this settles in a few passes over each cell.
  const queue = new Int32Array(size + 1);
  const queued = new Uint8Array(size);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  queued[start] = 1;
  while (head !== tail) {
    const index = queue[head];
    head = (head + 1) % queue.length;
    queued[index] = 0;
    const col = index % grid.cols;
    const row = (index - col) / grid.cols;
    for (const [dc, dr, cost] of STEPS) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
      const next = nr * grid.cols + nc;
      if (grid.blocked[next]) continue;
      // A diagonal may not cut the corner of a wall.
      if (dc !== 0 && dr !== 0 && (grid.blocked[row * grid.cols + nc] || grid.blocked[nr * grid.cols + col])) continue;
      const through = dist[index] + cost;
      if (through < dist[next]) {
        dist[next] = through;
        if (!queued[next]) {
          queued[next] = 1;
          queue[tail] = next;
          tail = (tail + 1) % queue.length;
        }
      }
    }
  }
  return field;
}

/**
 * A unit vector from `from` toward the goal, or null when there is no way
 * there. It steers to the centre of the best neighbouring cell, or out to the
 * nearest open cell when it starts inside the margin kept clear of walls.
 */
export function flowDirection(field: FlowField, from: Vec): Vec | null {
  const { grid, dist } = field;
  const index = cellOf(grid, from);
  if (!Number.isFinite(dist[index])) {
    // Standing in the margin the grid keeps clear of walls (a room corner, say) where every neighbour is
    // blocked too. Head for the nearest open cell, or the zombie would press into the wall for good.
    const open = nearestOpen(grid, index);
    if (open === null || open === index) return null;
    const dx = ((open % grid.cols) + 0.5) * grid.cell - from.x;
    const dy = (Math.floor(open / grid.cols) + 0.5) * grid.cell - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }
  const col = index % grid.cols;
  const row = (index - col) / grid.cols;
  let best = -1;
  let bestDist = dist[index];
  for (const [dc, dr] of STEPS) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
    const next = nr * grid.cols + nc;
    if (grid.blocked[next]) continue;
    if (dc !== 0 && dr !== 0 && (grid.blocked[row * grid.cols + nc] || grid.blocked[nr * grid.cols + col])) continue;
    if (dist[next] < bestDist) {
      bestDist = dist[next];
      best = next;
    }
  }
  if (best < 0) return null;
  const cx = ((best % grid.cols) + 0.5) * grid.cell;
  const cy = (Math.floor(best / grid.cols) + 0.5) * grid.cell;
  const dx = cx - from.x;
  const dy = cy - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}
