import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOME_PLOTS, SOIL_TILE, isHomePlotTile, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS, soilTileInCropFieldBeds } from "@/lib/stackacres/world";
import {
  FIELD_ORIGIN,
  fieldMapToWorld,
  fieldWorldToMap,
  homeBedsMapToWorld,
  homePlotTileToMap,
  inHomePlots,
  soilTileToMap,
  worldToMap,
} from "./field";

describe("the Old Fields map is the Crop Fields, tile for tile", () => {
  it("puts the field's corners on the map where oldfields.py draws the field", () => {
    expect(fieldWorldToMap({ x: CROP_FIELD_BEDS.x, y: CROP_FIELD_BEDS.y })).toEqual(FIELD_ORIGIN);
    expect(FIELD_ORIGIN).toEqual({ x: 96, y: 32 });
    expect(CROP_FIELD_BEDS.width).toBe(32 * 16);
  });

  it("round-trips every tile's centre through the map", () => {
    for (let ty = -16; ty < 16; ty++) {
      for (let tx = -16; tx < 16; tx++) {
        const map = soilTileToMap(tx, ty);
        expect(map.x % 16).toBe(0);
        const world = fieldMapToWorld({ x: map.x + 8, y: map.y + 8 });
        expect(world).not.toBeNull();
        expect(soilTileAt(world!.x, world!.y)).toEqual({ tx, ty });
        expect(soilTileInCropFieldBeds(tx, ty)).toBe(true);
      }
    }
  });

  it("says a tap off the field is off the field", () => {
    expect(fieldMapToWorld({ x: FIELD_ORIGIN.x - 1, y: 100 })).toBeNull();
    expect(fieldMapToWorld({ x: FIELD_ORIGIN.x + 32 * 16, y: 100 })).toBeNull();
  });

  it("knows where unmapped land is not", () => {
    expect(worldToMap({ x: 5000, y: 5000 })).toBeNull();
    expect(worldToMap({ x: 0, y: 0 })?.area).toBe("oldfields");
  });
});

describe("the Homestead's grass paddocks", () => {
  const area = JSON.parse(readFileSync("public/stackacres-td/areas/homestead/area.json", "utf8")) as {
    zones: { tag?: string; x: number; y: number; w: number; h: number }[];
  };
  const zones = area.zones.filter((z) => z.tag === "homebeds");

  it("lands each paddock where the rig draws WEST_BED and EAST_BED", () => {
    // homestead.py: WEST_BED (4,15)-(11,20), EAST_BED (19,15)-(26,19), in 16px map tiles.
    expect(homePlotTileToMap(HOME_PLOTS[0].tx0, HOME_PLOTS[0].ty0)).toEqual({ x: 4 * 16, y: 15 * 16 });
    expect(homePlotTileToMap(HOME_PLOTS[0].tx1, HOME_PLOTS[0].ty1)).toEqual({ x: 11 * 16, y: 20 * 16 });
    expect(homePlotTileToMap(HOME_PLOTS[1].tx0, HOME_PLOTS[1].ty0)).toEqual({ x: 19 * 16, y: 15 * 16 });
    expect(homePlotTileToMap(HOME_PLOTS[1].tx1, HOME_PLOTS[1].ty1)).toEqual({ x: 26 * 16, y: 19 * 16 });
  });

  it("keeps every paddock square inside a homebeds zone, so a tap on it reaches the hoe", () => {
    expect(zones).toHaveLength(HOME_PLOTS.length);
    for (const rect of HOME_PLOTS) {
      for (let ty = rect.ty0; ty <= rect.ty1; ty++) {
        for (let tx = rect.tx0; tx <= rect.tx1; tx++) {
          const { x, y } = homePlotTileToMap(tx, ty);
          const inZone = zones.some(
            (z) => x >= z.x && y >= z.y && x + SOIL_TILE <= z.x + z.w && y + SOIL_TILE <= z.y + z.h,
          );
          expect(inZone, `tile ${tx},${ty} at map ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it("round-trips every square's centre through the map", () => {
    for (const rect of HOME_PLOTS) {
      for (let ty = rect.ty0; ty <= rect.ty1; ty++) {
        for (let tx = rect.tx0; tx <= rect.tx1; tx++) {
          const map = homePlotTileToMap(tx, ty);
          const world = homeBedsMapToWorld({ x: map.x + 8, y: map.y + 8 });
          expect(world).not.toBeNull();
          expect(soilTileAt(world!.x, world!.y)).toEqual({ tx, ty });
          expect(isHomePlotTile(tx, ty)).toBe(true);
          expect(inHomePlots(world!)).toBe(true);
        }
      }
    }
  });

  it("says grass off the paddocks, and the path between them, is not workable", () => {
    // One pixel past each edge, and the lane between the two paddocks.
    expect(homeBedsMapToWorld({ x: 4 * 16 - 1, y: 15 * 16 + 8 })).toBeNull();
    expect(homeBedsMapToWorld({ x: 12 * 16, y: 15 * 16 + 8 })).toBeNull();
    expect(homeBedsMapToWorld({ x: 14 * 16 + 8, y: 15 * 16 + 8 })).toBeNull();
    expect(homeBedsMapToWorld({ x: 19 * 16 + 8, y: 20 * 16 })).toBeNull();
  });

  it("never overlaps the Crop Fields' own tiles", () => {
    for (const rect of HOME_PLOTS) {
      for (let ty = rect.ty0; ty <= rect.ty1; ty++) {
        for (let tx = rect.tx0; tx <= rect.tx1; tx++) expect(soilTileInCropFieldBeds(tx, ty)).toBe(false);
      }
    }
  });
});
