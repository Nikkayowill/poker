import { describe, expect, it } from "vitest";
import { ARENA, ENEMIES, OPERATORS, SHADOW, WEAPONS, waveComposition } from "./content";
import { buildNavGrid, findPath } from "./pathfinding";
import type { Rect, Vec } from "./types";
import { coverAt } from "./vision";

function touchesWall(point: Vec, radius: number): boolean {
  return ARENA.walls.some(
    (wall: Rect) =>
      point.x > wall.x - radius &&
      point.x < wall.x + wall.w + radius &&
      point.y > wall.y - radius &&
      point.y < wall.y + wall.h + radius,
  );
}

describe("arena", () => {
  it("is small enough for a phone and has plenty of dark corners", () => {
    expect(ARENA.width).toBeLessThanOrEqual(1300);
    expect(ARENA.height).toBeLessThanOrEqual(900);
    expect(ARENA.corners.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps spawns, patrol points and the player start out of the walls", () => {
    for (const point of [ARENA.playerSpawn, ...ARENA.entries.map((entry) => entry.pos), ...ARENA.patrol]) {
      expect(touchesWall(point, 16), `${point.x},${point.y}`).toBe(false);
    }
  });

  it("starts the player out of range of every door, so nobody steps in already watching them", () => {
    for (const entry of ARENA.entries) {
      const dist = Math.hypot(entry.pos.x - ARENA.playerSpawn.x, entry.pos.y - ARENA.playerSpawn.y);
      expect(dist, entry.id).toBeGreaterThan(Math.max(...Object.values(ENEMIES).map((def) => def.detectionRange)) - 30);
    }
  });

  it("keeps the dark corners on open floor, clear of every wall", () => {
    for (const corner of ARENA.corners) {
      expect(touchesWall(corner, 8), `corner ${corner.x},${corner.y}`).toBe(false);
    }
  });

  it("puts every corner, spawn and patrol point within reach of the player start", () => {
    const grid = buildNavGrid(ARENA);
    for (const goal of [...ARENA.corners, ...ARENA.entries.map((entry) => entry.pos), ...ARENA.patrol]) {
      expect(findPath(grid, ARENA.walls, ARENA.playerSpawn, goal, 14), `${goal.x},${goal.y}`).not.toBeNull();
    }
  });

  it("has a real dark corner in every booth", () => {
    // The back corner of each booth, where a 14-radius player can stand: boxed in on three sides.
    const backCorners = [
      { x: 148, y: 138 },
      { x: 998, y: 138 },
      { x: 148, y: 662 },
      { x: 998, y: 662 },
    ];
    for (const corner of backCorners) {
      expect(touchesWall(corner, 13), `${corner.x},${corner.y} is inside a wall`).toBe(false);
      expect(coverAt(corner, ARENA.walls), `booth ${corner.x},${corner.y}`).toBeGreaterThanOrEqual(SHADOW.hiddenAt);
    }
  });

  it("the open middle of the room hides nobody", () => {
    expect(coverAt(ARENA.playerSpawn, ARENA.walls)).toBeLessThan(SHADOW.hiddenAt);
  });
});

describe("content tables", () => {
  it("every operator weapon exists", () => {
    for (const operator of Object.values(OPERATORS)) {
      for (const id of operator.startingWeapons) expect(WEAPONS[id]).toBeDefined();
    }
  });

  it("every wave names enemies that exist", () => {
    for (let wave = 1; wave <= 30; wave += 1) {
      for (const row of waveComposition(wave)) expect(ENEMIES[row.defId]).toBeDefined();
    }
  });
});
