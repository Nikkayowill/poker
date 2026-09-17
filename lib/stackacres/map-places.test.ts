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

  it("puts the Homestead in the middle, with every walk out of it on the right side", () => {
    const at = (id: string) => MAP_PLACES.find((place) => place.id === id)!;
    const home = at("farmstead");
    // The Homestead's own exits (areas/homestead/area.json): north to the Crop
    // Fields, north-east to the Mine, west to the Oak, east to Town Square and
    // the Fold, south to the Coast. The Pasture is reached through the Fold.
    expect(at("cropfields").row).toBeLessThan(home.row);
    expect(at("mine").row).toBeLessThan(home.row);
    expect(at("mine").col).toBeGreaterThan(home.col);
    expect(at("oak").col).toBeLessThan(home.col);
    expect(at("townsquare").col).toBeGreaterThan(home.col);
    expect(at("coast").row).toBeGreaterThan(home.row);
    expect(at("wallow").col).toBeGreaterThan(home.col);
    expect(at("oxfields").col).toBeGreaterThan(at("wallow").col);
  });
});
