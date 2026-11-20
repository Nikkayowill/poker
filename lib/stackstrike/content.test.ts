import { describe, expect, it } from "vitest";
import { ARENA, DIFFICULTIES, ENEMIES, OPERATORS, SHADOW, WEAPONS } from "./content";
import { distanceToWall, lineOfSight } from "./geometry";
import { buildNavGrid, findPath } from "./pathfinding";
import type { Vec } from "./types";
import { lightAt } from "./vision";

function touchesWall(point: Vec, radius: number): boolean {
  return ARENA.walls.some((wall) => distanceToWall(point.x, point.y, wall) < radius);
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

  const spots = (): { x: number; y: number }[] => [
    ARENA.playerSpawn,
    ...ARENA.guards.flatMap((guard) => guard.route),
    ...ARENA.loot.map((spot) => spot.pos),
  ];

  it("keeps guard routes, loot and the player start out of the walls", () => {
    for (const point of spots()) expect(touchesWall(point, 16), `${point.x},${point.y}`).toBe(false);
  });

  it("starts the player where no guard can see them", () => {
    const range = Math.max(...Object.values(ENEMIES).map((def) => def.detectionRange));
    for (const guard of ARENA.guards) {
      const start = guard.route[0];
      const near = Math.hypot(start.x - ARENA.playerSpawn.x, start.y - ARENA.playerSpawn.y) < range;
      expect(near && lineOfSight(start, ARENA.playerSpawn, ARENA.walls), `${start.x},${start.y}`).toBe(false);
    }
  });

  it("puts the gold case a long way from the way out", () => {
    const gold = ARENA.loot.find((spot) => spot.main);
    expect(gold).toBeDefined();
    const zone = ARENA.exit.zone;
    const dist = Math.hypot((gold?.pos.x ?? 0) - (zone.x + zone.w / 2), (gold?.pos.y ?? 0) - (zone.y + zone.h / 2));
    expect(dist).toBeGreaterThan(900);
    expect(ARENA.loot.filter((spot) => spot.main)).toHaveLength(1);
  });

  it("has guards on every difficulty, more of them the harder it is", () => {
    const count = (tier: number): number => ARENA.guards.filter((guard) => guard.tier <= tier).length;
    expect(count(1)).toBeGreaterThanOrEqual(3);
    expect(count(2)).toBeGreaterThan(count(1));
    expect(count(3)).toBeGreaterThan(count(2));
    for (const difficulty of Object.values(DIFFICULTIES)) expect(count(difficulty.tier)).toBeGreaterThan(0);
  });

  it("gives every post a way to face, and every roamer a loop of at least two stops", () => {
    for (const guard of ARENA.guards) {
      if (guard.route.length === 1) expect(guard.watch, "post").toBeDefined();
      else expect(guard.watch, "roamer").toBeUndefined();
      expect(ENEMIES[guard.defId]).toBeDefined();
    }
  });

  it("covers every room with at least one guard on hard", () => {
    for (const { id, rect } of ARENA.rooms) {
      const inside = ARENA.guards.some((guard) =>
        guard.route.some((point) => point.x > rect.x && point.x < rect.x + rect.w && point.y > rect.y && point.y < rect.y + rect.h),
      );
      expect(inside, id).toBe(true);
    }
  });

  it("keeps the dark corners on open floor, clear of every wall", () => {
    for (const corner of ARENA.corners) {
      expect(touchesWall(corner, 8), `corner ${corner.x},${corner.y}`).toBe(false);
    }
  });

  it("puts every corner, guard stop, loot and the exit within reach of the player start", () => {
    const grid = buildNavGrid(ARENA);
    for (const goal of [...ARENA.corners, ...spots(), { x: ARENA.exit.zone.x + 30, y: ARENA.exit.zone.y + 60 }]) {
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
      const hides = inside.filter((corner) => lightAt(corner, ARENA) < SHADOW.darkBelow);
      expect(hides.length, id).toBeGreaterThanOrEqual(1);
    }
  });

  it("lights the player's own start, and leaves most of the building dark", () => {
    expect(lightAt(ARENA.playerSpawn, ARENA)).toBeGreaterThanOrEqual(SHADOW.darkBelow);
    let dark = 0;
    let total = 0;
    for (let x = 60; x < ARENA.width - 60; x += 40) {
      for (let y = 60; y < ARENA.height - 60; y += 40) {
        total += 1;
        if (lightAt({ x, y }, ARENA) < SHADOW.darkBelow) dark += 1;
      }
    }
    expect(dark / total).toBeGreaterThan(0.35);
    expect(dark / total).toBeLessThan(0.85);
  });

  it("keeps every light on open floor", () => {
    for (const light of ARENA.lights) {
      const inside = ARENA.walls.some((wall) => distanceToWall(light.pos.x, light.pos.y, wall) === 0);
      expect(inside, `${light.pos.x},${light.pos.y}`).toBe(false);
    }
  });
});

describe("content tables", () => {
  it("every operator weapon exists", () => {
    for (const operator of Object.values(OPERATORS)) {
      for (const id of operator.startingWeapons) expect(WEAPONS[id]).toBeDefined();
    }
  });
});
