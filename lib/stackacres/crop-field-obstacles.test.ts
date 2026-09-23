import { describe, expect, it } from "vitest";
import { cropFieldObstacleOnMapTile, cropFieldObstaclePlacements } from "./crop-field-obstacles";
import { FIELD_MAP_TILE, isHoeableMapTile } from "./hoeable";
import { LAND_OBSTACLES } from "./land-clearing";

describe("the Crop Fields' overgrowth", () => {
  const placements = cropFieldObstaclePlacements();

  it("seats every obstacle on the list", () => {
    expect(placements.map((p) => p.id).sort()).toEqual(LAND_OBSTACLES.cropfields.map((o) => o.id).sort());
  });

  it("stands only on hoeable grass inside the field", () => {
    for (const p of placements) {
      expect(isHoeableMapTile(p.tx, p.ty)).toBe(true);
      expect(p.tx).toBeGreaterThanOrEqual(FIELD_MAP_TILE.tx);
      expect(p.ty).toBeGreaterThanOrEqual(FIELD_MAP_TILE.ty);
      expect(p.tx).toBeLessThan(FIELD_MAP_TILE.tx + 32);
      expect(p.ty).toBeLessThan(FIELD_MAP_TILE.ty + 32);
    }
  });

  it("puts no two on one square, and finds each by its square", () => {
    expect(new Set(placements.map((p) => `${p.tx},${p.ty}`)).size).toBe(placements.length);
    for (const p of placements) expect(cropFieldObstacleOnMapTile(p.tx, p.ty)?.id).toBe(p.id);
  });

  it("deals the same field every time", () => {
    expect(cropFieldObstaclePlacements()).toBe(placements);
  });
});
