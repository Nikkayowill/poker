import { describe, expect, it } from "vitest";
import { cropFieldObstacleOnMapTile, cropFieldObstaclePlacements } from "./crop-field-obstacles";
import { isHoeableMapTile, isWildMapTile } from "./hoeable";
import { LAND_OBSTACLES } from "./land-clearing";

describe("the Crop Fields' overgrowth", () => {
  const placements = cropFieldObstaclePlacements();

  it("seats every obstacle on the list", () => {
    expect(placements.map((p) => p.id).sort()).toEqual(LAND_OBSTACLES.cropfields.map((o) => o.id).sort());
  });

  it("stands only on hoeable grass out in the wild land", () => {
    for (const p of placements) {
      expect(isHoeableMapTile(p.tx, p.ty)).toBe(true);
      expect(isWildMapTile(p.tx, p.ty)).toBe(true);
    }
  });

  it("puts no two on one square, and finds each by its square", () => {
    expect(new Set(placements.map((p) => `${p.tx},${p.ty}`)).size).toBe(placements.length);
    for (const p of placements) expect(cropFieldObstacleOnMapTile(p.tx, p.ty)?.id).toBe(p.id);
  });

  it("deals the same field every time", () => {
    expect(cropFieldObstaclePlacements()).toBe(placements);
  });

  // Players' cleared obstacles are saved by id, so a re-export that changes the wild or walkable tiles
  // would move every one of them. If this fails after touching the Homestead, the map change did that.
  it("keeps every obstacle where live farms already have it", () => {
    expect(placements.slice(0, 3).map((p) => [p.id, p.tx, p.ty])).toEqual([
      ["cropfields-01", 20, 42],
      ["cropfields-02", 56, 12],
      ["cropfields-03", 8, 8],
    ]);
    expect(placements.reduce((sum, p, i) => sum + (i + 1) * (p.tx * 100 + p.ty), 0)).toBe(41977375);
  });
});
