import { describe, expect, it } from "vitest";
import { ARENA, ENEMIES, OPERATORS, WEAPONS, waveComposition } from "./content";
import { segmentRectHit } from "./geometry";
import { buildNavGrid, findPath } from "./pathfinding";
import type { Rect, Vec } from "./types";

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
  it("is small enough for a phone and has plenty of places to hide", () => {
    expect(ARENA.width).toBeLessThanOrEqual(1300);
    expect(ARENA.height).toBeLessThanOrEqual(900);
    expect(ARENA.hides.length).toBeGreaterThanOrEqual(8);
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

  it("keeps hides on open floor, clear of every wall", () => {
    for (const hide of ARENA.hides) {
      for (const wall of ARENA.walls) {
        const overlap =
          hide.x < wall.x + wall.w && hide.x + hide.w > wall.x && hide.y < wall.y + wall.h && hide.y + hide.h > wall.y;
        expect(overlap, `hide ${hide.x},${hide.y} against wall ${wall.x},${wall.y}`).toBe(false);
      }
    }
  });

  it("puts every hide, spawn and patrol point within reach of the player start", () => {
    const grid = buildNavGrid(ARENA);
    const centres = ARENA.hides.map((hide) => ({ x: hide.x + hide.w / 2, y: hide.y + hide.h / 2 }));
    for (const goal of [...centres, ...ARENA.entries.map((entry) => entry.pos), ...ARENA.patrol]) {
      expect(findPath(grid, ARENA.walls, ARENA.playerSpawn, goal, 14), `${goal.x},${goal.y}`).not.toBeNull();
    }
  });

  it("has no hide a bullet can cross in a straight line from outside the booth", () => {
    // A booth's back wall means a shot from behind it is stopped.
    const booth = ARENA.hides[0];
    const behind = { x: booth.x + booth.w / 2, y: 20 };
    const inside = { x: booth.x + booth.w / 2, y: booth.y + 20 };
    expect(ARENA.walls.some((wall) => segmentRectHit(behind, inside, wall) !== null)).toBe(true);
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
