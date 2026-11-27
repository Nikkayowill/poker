import { describe, expect, it } from "vitest";
import { ARENA, CONTRACTS, DIFFICULTIES } from "./content";
import { distance, lineOfSight } from "./geometry";
import { findPath, navGridFor } from "./pathfinding";
import { buildArena, GUARD_POOL, pickContract } from "./run";
import { createState } from "./sim";
import type { ContractId, DifficultyId } from "./types";
import { distanceToWall } from "./geometry";
import { roomAt } from "./vision";

const DIFFICULTY_IDS = Object.keys(DIFFICULTIES) as DifficultyId[];
const CONTRACT_IDS = Object.keys(CONTRACTS) as ContractId[];
const SEEDS = Array.from({ length: 60 }, (_, index) => index * 7919 + 3);

function onOpenFloor(point: { x: number; y: number }, margin: number): boolean {
  return !ARENA.walls.some((wall) => distanceToWall(point.x, point.y, wall) < margin);
}

describe("a generated run", () => {
  it("is the same for the same seed and differs between seeds", () => {
    expect(buildArena(5, "normal", "standard")).toEqual(buildArena(5, "normal", "standard"));
    const layouts = new Set(SEEDS.map((seed) => JSON.stringify(buildArena(seed, "normal").loot.map((spot) => spot.pos))));
    expect(layouts.size).toBeGreaterThan(20);
    const guardSets = new Set(SEEDS.map((seed) => JSON.stringify(buildArena(seed, "normal").guards.map((guard) => guard.route[0]))));
    expect(guardSets.size).toBeGreaterThan(20);
  });

  it("puts the gold case in more than one place", () => {
    const spots = new Set(SEEDS.map((seed) => JSON.stringify(buildArena(seed).loot.find((spot) => spot.main)?.pos)));
    expect(spots.size).toBeGreaterThanOrEqual(4);
  });

  it("only ever uses open floor that can be walked to from the way in", () => {
    const grid = navGridFor(ARENA);
    for (const seed of SEEDS) {
      for (const spot of buildArena(seed, "hard").loot) {
        expect(onOpenFloor(spot.pos, 22), `${spot.label} seed ${seed}`).toBe(true);
        expect(findPath(grid, ARENA.walls, ARENA.playerSpawn, spot.pos, 14), `${spot.label} seed ${seed}`).not.toBeNull();
      }
    }
    for (const guard of GUARD_POOL) {
      for (const point of guard.route) expect(onOpenFloor(point, 12), JSON.stringify(point)).toBe(true);
    }
  });

  it("posts the number of guards the difficulty and contract call for", () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const contract of CONTRACT_IDS) {
        const expected = Math.max(2, { easy: 4, normal: 7, hard: 10 }[difficulty] + CONTRACTS[contract].guardDelta);
        for (const seed of SEEDS.slice(0, 12)) {
          expect(buildArena(seed, difficulty, contract).guards.length, `${difficulty} ${contract}`).toBe(expected);
        }
      }
    }
  });

  it("never lets a guard see the player at the start, on any seed", () => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const seed of SEEDS) {
        const arena = buildArena(seed, difficulty, "night-shift");
        const state = createState(seed, "vanguard", arena, difficulty);
        for (const enemy of state.enemies) {
          expect(distance(enemy.pos, arena.playerSpawn), `${difficulty} ${seed}`).toBeGreaterThan(110);
          expect(lineOfSight(enemy.pos, arena.playerSpawn, arena.walls) && distance(enemy.pos, arena.playerSpawn) < 150).toBe(false);
        }
      }
    }
  });

  it("always has someone in the room the case is in", () => {
    for (const seed of SEEDS) {
      const arena = buildArena(seed, "easy");
      const main = arena.loot.find((spot) => spot.main);
      const room = roomAt(ARENA, main!.pos)?.id;
      expect(arena.guards.some((guard) => roomAt(ARENA, guard.route[0])?.id === room), `seed ${seed}`).toBe(true);
    }
  });

  it("keeps rooms from filling up with guards", () => {
    for (const seed of SEEDS) {
      const counts = new Map<string, number>();
      for (const guard of buildArena(seed, "normal").guards) {
        const id = roomAt(ARENA, guard.route[0])?.id ?? "?";
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      expect(Math.max(...counts.values()), `seed ${seed}`).toBeLessThanOrEqual(3);
    }
  });

  it("scales side loot with the contract and keeps them apart", () => {
    const rich = buildArena(11, "normal", "rich-pickings").loot.filter((spot) => !spot.main);
    const lean = buildArena(11, "normal", "skeleton-crew").loot.filter((spot) => !spot.main);
    expect(rich.length).toBe(4);
    expect(lean.length).toBe(2);
    for (const a of rich) for (const b of rich) if (a !== b) expect(distance(a.pos, b.pos)).toBeGreaterThanOrEqual(220);
  });

  it("varies the guards' loops and posts between seeds", () => {
    const starts = new Set(SEEDS.map((seed) => JSON.stringify(buildArena(seed, "hard").guards.map((guard) => [guard.route[0], guard.watch ?? null]))));
    expect(starts.size).toBeGreaterThan(40);
  });
});

describe("contracts", () => {
  it("only offers what a level has unlocked", () => {
    for (const seed of SEEDS) {
      expect(["standard", "skeleton-crew"]).toContain(pickContract(seed, 1));
    }
    const seen = new Set(SEEDS.concat(SEEDS.map((n) => n + 1)).map((seed) => pickContract(seed, 10)));
    expect(seen.size).toBe(CONTRACT_IDS.length);
  });

  it("is deterministic for a seed", () => {
    expect(pickContract(42, 6)).toBe(pickContract(42, 6));
  });
});
