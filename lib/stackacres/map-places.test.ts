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

  it("puts the Crop Fields north of the Homestead", () => {
    const at = (id: string) => MAP_PLACES.find((place) => place.id === id)!;
    expect(MAP_PLACES.map((place) => place.id).sort()).toEqual(["cropfields", "farmstead"]);
    expect(at("cropfields").row).toBeLessThan(at("farmstead").row);
  });
});
