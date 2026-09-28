import { describe, expect, it } from "vitest";
import { MAP_COLUMNS, MAP_PLACES, MAP_ROWS } from "./map-places";

describe("the world map's places", () => {
  it("gives every place its own cell, inside the grid", () => {
    const cells = new Set<string>();
    for (const place of MAP_PLACES) {
      expect(place.col).toBeGreaterThanOrEqual(0);
      expect(place.col).toBeLessThan(MAP_COLUMNS);
      expect(place.row).toBeGreaterThanOrEqual(0);
      expect(place.row).toBeLessThan(MAP_ROWS);
      cells.add(`${place.col},${place.row}`);
    }
    expect(cells.size).toBe(MAP_PLACES.length);
  });

  it("puts the Crop Fields and the Homestead side by side, the only two places left", () => {
    // Six districts (and the gates that led to them) were removed 2026-09-28
    // (../story/travelers.ts's own header); the Crop Fields, ground inside
    // the Homestead rather than a district of their own, are all that is
    // still a walk from it.
    const at = (id: string) => MAP_PLACES.find((place) => place.id === id)!;
    expect(MAP_PLACES).toHaveLength(2);
    expect(at("cropfields").row).toBe(at("farmstead").row);
    expect(at("cropfields").col).toBeLessThan(at("farmstead").col);
  });
});
