import { describe, expect, it } from "vitest";
import { ARENA, ENEMIES, OPERATORS, SHADOW, WEAPONS, waveComposition } from "./content";
import { lineOfSight } from "./geometry";
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
  it("is a compound of rooms with plenty of dark corners", () => {
    expect(ARENA.rooms.length).toBeGreaterThanOrEqual(6);
    expect(ARENA.corners.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps every room small enough to see whole on a phone screen", () => {
    // The phone view is about 500 tall and 2:1, so a room that fits 1000 x 480 is all on screen at once.
    for (const { id, rect } of ARENA.rooms) {
      expect(rect.h, id).toBeLessThanOrEqual(430);
      expect(rect.w, id).toBeLessThanOrEqual(1000);
    }
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

  it("gives no door a clear view of the player start", () => {
    for (const entry of ARENA.entries) {
      expect(lineOfSight(entry.pos, ARENA.playerSpawn, ARENA.walls), entry.id).toBe(false);
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

  it("puts the middle of every room within reach, so no room is a dead pocket", () => {
    const grid = buildNavGrid(ARENA);
    for (const { id, rect } of ARENA.rooms) {
      const goal = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
      // Cover can sit on the exact middle: try a spot beside it.
      const spots = [goal, { x: goal.x - 60, y: goal.y }, { x: goal.x + 60, y: goal.y }, { x: goal.x, y: goal.y + 60 }];
      const reachable = spots.some((spot) => !touchesWall(spot, 16) && findPath(grid, ARENA.walls, ARENA.playerSpawn, spot, 14) !== null);
      expect(reachable, id).toBe(true);
    }
  });

  it("has a dark corner to hide in, in every room", () => {
    for (const { id, rect } of ARENA.rooms) {
      const inside = ARENA.corners.filter(
        (corner) => corner.x > rect.x && corner.x < rect.x + rect.w && corner.y > rect.y && corner.y < rect.y + rect.h,
      );
      const hides = inside.filter((corner) => coverAt(corner, ARENA.walls) >= SHADOW.hiddenAt);
      expect(hides.length, id).toBeGreaterThanOrEqual(1);
    }
  });

  it("the open middle of the player's own room hides nobody", () => {
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
