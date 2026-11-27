import { describe, expect, it } from "vitest";
import { buildFlow, flowDirection } from "./flow";
import { buildNavGrid } from "./pathfinding";
import type { Arena } from "./types";

function arena(walls: Arena["walls"]): Arena {
  return { width: 600, height: 600, walls, rooms: [], lights: [], ambient: 1, spawns: [], playerSpawn: { x: 300, y: 300 } };
}

describe("flow field", () => {
  it("grows with distance from the goal in the open", () => {
    const field = buildFlow(buildNavGrid(arena([])), { x: 300, y: 300 });
    const at = (x: number, y: number) => field.dist[Math.floor(y / field.grid.cell) * field.grid.cols + Math.floor(x / field.grid.cell)];
    expect(at(300, 300)).toBe(0);
    expect(at(400, 300)).toBeGreaterThan(at(340, 300));
    expect(at(500, 500)).toBeGreaterThan(at(400, 400));
  });

  it("points straight at the goal in the open", () => {
    const field = buildFlow(buildNavGrid(arena([])), { x: 500, y: 300 });
    const way = flowDirection(field, { x: 100, y: 300 });
    expect(way?.x).toBeGreaterThan(0.9);
    expect(Math.abs(way?.y ?? 1)).toBeLessThan(0.4);
  });

  it("leads round a wall instead of into it", () => {
    // A wall from the top down to y 480; the way round is at the bottom.
    const field = buildFlow(buildNavGrid(arena([{ x: 280, y: 0, w: 40, h: 480 }])), { x: 500, y: 100 });
    const way = flowDirection(field, { x: 100, y: 100 });
    expect(way?.y).toBeGreaterThan(0.3);
  });

  it("cannot reach a sealed-off pocket", () => {
    const walls = [
      { x: 100, y: 100, w: 200, h: 24 },
      { x: 100, y: 276, w: 200, h: 24 },
      { x: 100, y: 100, w: 24, h: 200 },
      { x: 276, y: 100, w: 24, h: 200 },
    ];
    const field = buildFlow(buildNavGrid(arena(walls)), { x: 500, y: 500 });
    expect(flowDirection(field, { x: 200, y: 200 })).toBeNull();
  });

  it("steers a zombie wedged in the clear margin of a room corner back out to open floor", () => {
    // A room corner: both walls are within a zombie's reach of this point, so its own cell and its neighbours are all blocked.
    const walls = [
      { x: 0, y: 0, w: 600, h: 32 },
      { x: 0, y: 0, w: 32, h: 600 },
    ];
    const grid = buildNavGrid(arena(walls));
    const field = buildFlow(grid, { x: 400, y: 400 });
    const corner = { x: 36, y: 36 };
    expect(grid.blocked[Math.floor(corner.y / grid.cell) * grid.cols + Math.floor(corner.x / grid.cell)]).toBe(1);
    const way = flowDirection(field, corner);
    expect(way).not.toBeNull();
    // Out of the corner means away from both walls.
    expect(way?.x).toBeGreaterThan(0);
    expect(way?.y).toBeGreaterThan(0);
  });

  it("reuses the array it is handed", () => {
    const grid = buildNavGrid(arena([]));
    const first = buildFlow(grid, { x: 100, y: 100 });
    const second = buildFlow(grid, { x: 500, y: 500 }, first);
    expect(second.dist).toBe(first.dist);
    expect(second.dist[Math.floor(500 / grid.cell) * grid.cols + Math.floor(500 / grid.cell)]).toBe(0);
  });
});
