import { describe, expect, it } from "vitest";
import { FARM_PATHS, ALL_FARM_PATHS } from "./paths";
import {
  ARTERIAL_ROAD_MIN_WIDTH,
  EDGE_WOBBLE_FRACTION,
  ROAD_TILE,
  SERVICE_PATH_WIDTH,
  TRACK_MIN_WIDTH,
  edgeWobblePhase,
  featherReach,
  roadEdgeWobble,
  roadWidth,
  tilesWide,
} from "./roads";
import { STACKACRES_TILE, seededRandom } from "./world";

describe("road tiers", () => {
  it("restates the art tile, and sizes the tiers in tiles the way a cozy farm does", () => {
    expect(ROAD_TILE).toBe(STACKACRES_TILE);
    // Two to three tiles wide is what gives a main road its weight on a phone.
    expect(tilesWide(ARTERIAL_ROAD_MIN_WIDTH)).toBeGreaterThanOrEqual(2);
    expect(tilesWide(ARTERIAL_ROAD_MIN_WIDTH)).toBeLessThanOrEqual(3);
    expect(ARTERIAL_ROAD_MIN_WIDTH).toBe(40);
    expect(TRACK_MIN_WIDTH).toBeLessThan(ARTERIAL_ROAD_MIN_WIDTH);
    expect(SERVICE_PATH_WIDTH).toBeLessThan(TRACK_MIN_WIDTH);
    expect(tilesWide(SERVICE_PATH_WIDTH)).toBe(1);
  });

  it("holds a main road to its floor however thin it was asked for, and leaves a service path alone", () => {
    expect(roadWidth("arterial", 18)).toBe(ARTERIAL_ROAD_MIN_WIDTH);
    expect(roadWidth("arterial", 48)).toBe(48);
    expect(roadWidth("track", 15)).toBe(TRACK_MIN_WIDTH);
    expect(roadWidth("track", 30)).toBe(30);
    expect(roadWidth("service", 12)).toBe(12);
  });

  it("evaluates every main road axis on the farm at the arterial floor or wider", () => {
    for (const spec of FARM_PATHS) {
      if (spec.tier === "arterial") expect(spec.width, spec.key).toBeGreaterThanOrEqual(ARTERIAL_ROAD_MIN_WIDTH);
      if (spec.tier === "track") expect(spec.width, spec.key).toBeGreaterThanOrEqual(TRACK_MIN_WIDTH);
    }
    // Every main road on the map, in FARM_PATHS' own order. Written out rather
    // than counted, because the ORDER is load-bearing: the renderer's junction
    // repaint runs down this list, so a branch listed before the trunk it
    // forks off paints the junction the wrong way round.
    const arterial = FARM_PATHS.filter((p) => p.tier === "arterial").map((p) => p.key);
    expect(arterial).toEqual([
      "lane", "yardRoad",
      "meadowSpur", "henhavenSpur", "oxfieldsSpur",
      "wallowSpur", "mineSpur", "townsquareSpur",
      "coastSpur", "oakSpur",
    ]);
    // The generated spurs are the narrowest thing on the map: one tile.
    for (const spur of ALL_FARM_PATHS.filter((p) => p.key.startsWith("spur-"))) {
      expect(spur.tier).toBe("service");
      expect(spur.width).toBe(SERVICE_PATH_WIDTH);
    }
  });
});

describe("road edge wobble", () => {
  it("never pinches or swells the edge more than the fraction of the half-width", () => {
    const phase = edgeWobblePhase(seededRandom(7));
    for (const width of [16, 24, 40, 48]) {
      const limit = (width / 2) * EDGE_WOBBLE_FRACTION + 1e-9;
      for (let s = 0; s < 1000; s += 0.5) {
        const w = roadEdgeWobble(s, width, phase.left);
        expect(Math.abs(w)).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("is deterministic for a phase, and differs between the two sides", () => {
    const phase = edgeWobblePhase(seededRandom(11));
    expect(roadEdgeWobble(37, 40, phase.left)).toBe(roadEdgeWobble(37, 40, phase.left));
    let same = 0;
    for (let s = 0; s < 200; s += 1) {
      if (Math.abs(roadEdgeWobble(s, 40, phase.left) - roadEdgeWobble(s, 40, phase.right)) < 1e-6) same += 1;
    }
    expect(same).toBeLessThan(5);
  });

  it("actually wanders: a wide road's edge is not a ruler line", () => {
    const phase = edgeWobblePhase(seededRandom(3));
    let min = Infinity;
    let max = -Infinity;
    for (let s = 0; s < 400; s += 1) {
      const w = roadEdgeWobble(s, ARTERIAL_ROAD_MIN_WIDTH, phase.left);
      min = Math.min(min, w);
      max = Math.max(max, w);
    }
    expect(max - min).toBeGreaterThan(2);
  });

  it("feathers wider with the road, with a floor for a service path", () => {
    expect(featherReach(SERVICE_PATH_WIDTH)).toBe(6);
    expect(featherReach(ARTERIAL_ROAD_MIN_WIDTH)).toBe(8);
    expect(featherReach(48)).toBeGreaterThan(featherReach(40));
  });
});
