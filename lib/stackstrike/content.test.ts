import { describe, expect, it } from "vitest";
import { ARENA, BARRELS, DIFFICULTIES, ENEMIES, HORDE, LEVELING, OPERATORS, PERKS, PICKUPS, WEAPONS } from "./content";
import { buildFlow } from "./flow";
import { distanceToWall } from "./geometry";
import { buildNavGrid } from "./pathfinding";
import type { Vec } from "./types";

function touchesWall(point: Vec, radius: number): boolean {
  return ARENA.walls.some((wall) => distanceToWall(point.x, point.y, wall) < radius);
}

describe("arena", () => {
  it("is a compound of rooms", () => {
    expect(ARENA.rooms.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps every room small enough to see whole on a phone screen", () => {
    // The phone view is about 500 tall and 2:1, so a room that fits 1000 x 480 is all on screen at once.
    for (const { id, rect } of ARENA.rooms) {
      expect(rect.h, id).toBeLessThanOrEqual(430);
      expect(rect.w, id).toBeLessThanOrEqual(1000);
    }
  });

  it("keeps the player start and every spawn out of the walls", () => {
    for (const point of [ARENA.playerSpawn, ...ARENA.spawns]) expect(touchesWall(point, 22), `${point.x},${point.y}`).toBe(false);
  });

  it("can be walked from the player start to every spawn, so no zombie is stuck behind a wall", () => {
    const field = buildFlow(buildNavGrid(ARENA), ARENA.playerSpawn);
    const grid = field.grid;
    for (const spawn of ARENA.spawns) {
      const cell = Math.floor(spawn.y / grid.cell) * grid.cols + Math.floor(spawn.x / grid.cell);
      expect(Number.isFinite(field.dist[cell]), `${spawn.x},${spawn.y}`).toBe(true);
    }
  });

  it("has spawns in every room, so a crowd can come from any side", () => {
    for (const { id, rect } of ARENA.rooms) {
      const inside = ARENA.spawns.some((spawn) => spawn.x > rect.x && spawn.x < rect.x + rect.w && spawn.y > rect.y && spawn.y < rect.y + rect.h);
      expect(inside, id).toBe(true);
    }
  });

  it("starts the player a long way from some spawn, so the first zombies do not land on top of them", () => {
    const far = ARENA.spawns.filter((spawn) => Math.hypot(spawn.x - ARENA.playerSpawn.x, spawn.y - ARENA.playerSpawn.y) >= HORDE.spawnMinDistance);
    expect(far.length).toBeGreaterThanOrEqual(4);
  });

  it("puts every barrel on open floor, clear of the start and of the spawns", () => {
    const spots = ARENA.barrels ?? [];
    expect(spots.length).toBeGreaterThanOrEqual(6);
    for (const spot of spots) {
      expect(touchesWall(spot, BARRELS.radius + 18), `${spot.x},${spot.y}`).toBe(false);
      expect(Math.hypot(spot.x - ARENA.playerSpawn.x, spot.y - ARENA.playerSpawn.y), `${spot.x},${spot.y}`).toBeGreaterThan(BARRELS.blastRadius * 0.6);
      for (const spawn of ARENA.spawns) expect(Math.hypot(spot.x - spawn.x, spot.y - spawn.y), `${spot.x},${spot.y}`).toBeGreaterThan(40);
    }
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

  it("makes every zombie slower than the player, so running away works", () => {
    const player = OPERATORS.vanguard.moveSpeed;
    for (const def of Object.values(ENEMIES)) {
      for (const difficulty of Object.values(DIFFICULTIES)) {
        expect(def.moveSpeed * difficulty.speed, `${def.id} on ${difficulty.id}`).toBeLessThan(player);
      }
    }
  });

  it("does not let one bullet kill a brute, and lets the pistol kill a walker in a few shots", () => {
    expect(Math.ceil(ENEMIES.brute.health / WEAPONS.pistol.damage)).toBeGreaterThan(10);
    const shots = Math.ceil(ENEMIES.walker.health / WEAPONS.pistol.damage);
    expect(shots).toBeGreaterThanOrEqual(2);
    expect(shots).toBeLessThanOrEqual(3);
  });

  it("gives the riot zombie real armor and keeps it a step slower than the player", () => {
    expect(ENEMIES.armored.armor).toBeLessThan(1);
    expect(ENEMIES.armored.health).toBeGreaterThan(ENEMIES.walker.health * 2);
    expect(ENEMIES.armored.moveSpeed).toBeLessThan(ENEMIES.runner.moveSpeed);
  });

  it("gives the bloater a burst a player can step clear of, and that never one-shots them", () => {
    const burst = ENEMIES.bloater.burst;
    expect(burst).toBeDefined();
    expect(burst?.radius ?? 0).toBeGreaterThan(60);
    expect(burst?.damage ?? 999).toBeLessThan(OPERATORS.vanguard.maxHealth / 3);
  });

  it("lets a point-blank shotgun blast kill a walker outright", () => {
    expect(WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets).toBeGreaterThan(ENEMIES.walker.health * 2);
  });

  it("has harder difficulties bring more, faster, harder-hitting zombies", () => {
    const { easy, normal, hard } = DIFFICULTIES;
    expect(easy.horde).toBeLessThan(normal.horde);
    expect(normal.horde).toBeLessThan(hard.horde);
    expect(easy.damage).toBeLessThan(hard.damage);
    expect(easy.speed).toBeLessThan(hard.speed);
  });

  it("offers more than three perk cards, all with a way to get them", () => {
    expect(Object.keys(PERKS).length).toBeGreaterThan(6);
    for (const perk of Object.values(PERKS)) {
      expect(perk.max, perk.id).toBeGreaterThan(0);
      expect(perk.name.length, perk.id).toBeGreaterThan(0);
    }
    expect(LEVELING.redraws).toBe(3);
  });

  it("weights pickups to sum above zero, with health the most common", () => {
    const weights = PICKUPS.weights;
    expect(weights.health).toBeGreaterThan(weights.bomb);
    for (const [kind, weight] of Object.entries(weights)) {
      expect(weight, kind).toBeGreaterThan(0);
      if (kind !== "health") expect(weights.health, kind).toBeGreaterThan(weight);
    }
  });
});
