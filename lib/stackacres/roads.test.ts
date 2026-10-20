import { describe, expect, it } from "vitest";
import { FARM_PATHS, ALL_FARM_PATHS } from "./paths";
import {
  ARTERIAL_ROAD_MIN_WIDTH,
  SERVICE_PATH_WIDTH,
  TRACK_MIN_WIDTH,
  roadWidth,
} from "./roads";

describe("road tiers", () => {

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
    // Only the yard's own two are arterial now. The grid roads are one cell
    // (32) wide on purpose, the bench's own road width, so they are tracks.
    expect(arterial).toEqual(["lane", "yardRoad"]);
    const tracks = FARM_PATHS.filter((p) => p.tier === "track").map((p) => p.key);
    expect(tracks).toEqual([
      "midRoad", "northRoadEast", "northRoadWest",
      "southRoadEast", "southRoadWest", "eastRoad", "foldRoad", "meadowSpur",
    ]);
    for (const spec of FARM_PATHS) if (spec.tier === "track") expect(spec.width).toBe(32);
    // The generated spurs are the narrowest thing on the map: one tile.
    for (const spur of ALL_FARM_PATHS.filter((p) => p.key.startsWith("spur-"))) {
      expect(spur.tier).toBe("service");
      expect(spur.width).toBe(SERVICE_PATH_WIDTH);
    }
  });
});

