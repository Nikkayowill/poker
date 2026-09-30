import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP_COLUMNS, MAP_PLACES, MAP_ROWS } from "./map-places";

const at = (id: string) => MAP_PLACES.find((place) => place.id === id)!;

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

  it("lists the Homestead, its Crop Fields, the City and the Far Field", () => {
    expect(MAP_PLACES.map((place) => place.id).sort()).toEqual(["city", "cropfields", "farfield", "farmstead"]);
  });

  it("lays the City west and the Far Field east of the Homestead, the Crop Fields south", () => {
    expect(at("city").row).toBe(at("farmstead").row);
    expect(at("city").col).toBeLessThan(at("farmstead").col);
    expect(at("farfield").row).toBe(at("farmstead").row);
    expect(at("farfield").col).toBeGreaterThan(at("farmstead").col);
    expect(at("cropfields").col).toBe(at("farmstead").col);
    expect(at("cropfields").row).toBeGreaterThan(at("farmstead").row);
  });

  it("only offers areas the Homestead has an exit to", () => {
    const area = JSON.parse(readFileSync("public/stackacres-td/areas/homestead/area.json", "utf8")) as {
      exits: { to: string }[];
    };
    const exits = area.exits.map((exit) => exit.to);
    expect(exits).toContain("city");
    expect(exits).toContain("empire");
  });
});
