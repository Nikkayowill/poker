import { describe, expect, it } from "vitest";
import { soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS, soilTileInCropFieldBeds } from "@/lib/stackacres/world";
import { FIELD_ORIGIN, fieldMapToWorld, fieldWorldToMap, soilTileToMap, worldToMap } from "./field";

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
