import { describe, expect, it } from "vitest";
import { segmentClear } from "./geometry";
import { buildNavGrid, findPath } from "./pathfinding";
import type { Arena } from "./types";

function arena(walls: Arena["walls"]): Arena {
  return { width: 800, height: 800, walls, rooms: [], corners: [], patrol: [], playerSpawn: { x: 400, y: 400 }, entries: [] };
}

describe("findPath", () => {
  it("goes straight when nothing is in the way", () => {
    const a = arena([]);
    const path = findPath(buildNavGrid(a), a.walls, { x: 100, y: 100 }, { x: 600, y: 600 }, 14);
    expect(path).toEqual([{ x: 600, y: 600 }]);
  });

  it("routes round a wall and never cuts through it", () => {
    const a = arena([{ x: 380, y: 100, w: 40, h: 600 }]);
    const from = { x: 100, y: 400 };
    const path = findPath(buildNavGrid(a), a.walls, from, { x: 700, y: 400 }, 14);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);

    let anchor = from;
    for (const point of path!) {
      expect(segmentClear(anchor, point, 14, a.walls)).toBe(true);
      anchor = point;
    }
    expect(anchor).toEqual({ x: 700, y: 400 });
  });

  it("returns null when the goal is sealed off", () => {
    const a = arena([
      { x: 500, y: 500, w: 200, h: 40 },
      { x: 500, y: 700, w: 200, h: 40 },
      { x: 500, y: 500, w: 40, h: 240 },
      { x: 660, y: 500, w: 40, h: 240 },
    ]);
    expect(findPath(buildNavGrid(a), a.walls, { x: 100, y: 100 }, { x: 600, y: 620 }, 14)).toBeNull();
  });

  it("starts from a point that sits inside a blocked cell", () => {
    const a = arena([{ x: 380, y: 380, w: 40, h: 40 }]);
    const path = findPath(buildNavGrid(a), a.walls, { x: 395, y: 395 }, { x: 700, y: 700 }, 14);
    expect(path).not.toBeNull();
  });
});
