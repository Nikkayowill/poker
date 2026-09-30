import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHoeableMapTile, isWildMapTile, isWildSoilTile, mapToSoilTile, soilToMapTile } from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";
import { SOIL_TILE, soilTileAt } from "@/lib/stackacres/soil";
import { CROP_FIELD_BEDS, soilTileInCropFieldBeds } from "@/lib/stackacres/world";
import {
  FIELD_ORIGIN,
  fieldMapToWorld,
  fieldWorldToMap,
  isBedSquare,
  mapToSoilWorld,
  soilTileToMap,
  soilWorldToMap,
  worldToMap,
} from "./field";

interface AreaJson {
  width: number;
  height: number;
  tile: number;
  exits: { to: string }[];
  zones: { tag?: string; x: number; y: number; w: number; h: number }[];
}

const area = JSON.parse(readFileSync("public/stackacres-td/areas/homestead/area.json", "utf8")) as AreaJson;

describe("one soil grid for the whole Homestead", () => {
  it("round-trips every square on the map", () => {
    for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
      for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) {
        const { tx, ty } = mapToSoilTile(mx, my);
        expect(soilToMapTile(tx, ty)).toEqual({ mx, my });
        expect(soilTileToMap(tx, ty)).toEqual({ x: mx * SOIL_TILE, y: my * SOIL_TILE });
      }
    }
  });

  it("names the same square from a pixel anywhere inside it", () => {
    const { tx, ty } = mapToSoilTile(20, 50);
    for (const [dx, dy] of [[0, 0], [15, 0], [0, 15], [15, 15], [8, 8]]) {
      const world = mapToSoilWorld({ x: 20 * SOIL_TILE + dx, y: 50 * SOIL_TILE + dy });
      expect(soilTileAt(world.x, world.y)).toEqual({ tx, ty });
    }
  });

  it("is the grid the map file itself is drawn on", () => {
    expect(area.width).toBe(HOMESTEAD_MAP_WIDTH);
    expect(area.height).toBe(HOMESTEAD_MAP_HEIGHT);
    expect(area.tile).toBe(SOIL_TILE);
  });
});

describe("the Crop Fields are the wild land round the yard", () => {
  it("keep the shared grid where the map is drawn", () => {
    expect(fieldWorldToMap({ x: CROP_FIELD_BEDS.x, y: CROP_FIELD_BEDS.y })).toEqual(FIELD_ORIGIN);
    expect(FIELD_ORIGIN).toEqual({ x: 16 * SOIL_TILE, y: 6 * SOIL_TILE });
  });

  it("round-trips every old field square through the map", () => {
    for (let ty = -16; ty < 16; ty++) {
      for (let tx = -16; tx < 16; tx++) {
        const map = soilTileToMap(tx, ty);
        const world = fieldMapToWorld({ x: map.x + 8, y: map.y + 8 });
        expect(world).not.toBeNull();
        expect(soilTileAt(world!.x, world!.y)).toEqual({ tx, ty });
        expect(soilTileInCropFieldBeds(tx, ty)).toBe(true);
      }
    }
  });

  it("says a map pixel off the old field is off it", () => {
    expect(fieldMapToWorld({ x: FIELD_ORIGIN.x - 1, y: FIELD_ORIGIN.y + 8 })).toBeNull();
    expect(fieldMapToWorld({ x: FIELD_ORIGIN.x + CROP_FIELD_BEDS.width, y: FIELD_ORIGIN.y + 8 })).toBeNull();
  });

  it("is ground the hoe works, every wild square of it", () => {
    let wild = 0;
    for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
      for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) {
        if (!isWildMapTile(mx, my)) continue;
        wild++;
        expect(isHoeableMapTile(mx, my), `wild ${mx},${my}`).toBe(true);
      }
    }
    expect(wild).toBeGreaterThan(500);
  });

  it("rings the yard: wild land to the west, the east and the south", () => {
    const some = (x0: number, y0: number, x1: number, y1: number) => {
      for (let my = y0; my <= y1; my++) for (let mx = x0; mx <= x1; mx++) if (isWildMapTile(mx, my)) return true;
      return false;
    };
    expect(some(3, 10, 13, 40)).toBe(true);
    expect(some(50, 10, 60, 40)).toBe(true);
    expect(some(15, 32, 48, 40)).toBe(true);
  });

  it("leaves the yard out of it", () => {
    expect(isWildMapTile(31, 21)).toBe(false);
    expect(isWildMapTile(28, 24)).toBe(false);
    expect(isWildSoilTile(mapToSoilTile(28, 24).tx, mapToSoilTile(28, 24).ty)).toBe(false);
  });

  it("leaves nothing walking off to a separate Crop Fields map", () => {
    expect(area.exits.map((e) => e.to)).not.toContain("oldfields");
  });
});

describe("where a bed may go", () => {
  it("covers a good share of the farm, and not all of it", () => {
    let grass = 0;
    for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my++) {
      for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) if (isHoeableMapTile(mx, my)) grass++;
    }
    const share = grass / (HOMESTEAD_MAP_WIDTH * HOMESTEAD_MAP_HEIGHT);
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.9);
  });

  it("keeps the hen pen for the hens", () => {
    const pen = area.zones.find((z) => z.tag === "pen:henhaven");
    expect(pen).toBeDefined();
    const mx = Math.floor((pen!.x + pen!.w / 2) / SOIL_TILE);
    const my = Math.floor((pen!.y + pen!.h / 2) / SOIL_TILE);
    expect(isHoeableMapTile(mx, my)).toBe(false);
  });

  it("never lets the edge of the world be dug", () => {
    for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx++) {
      expect(isHoeableMapTile(mx, 0)).toBe(false);
      expect(isHoeableMapTile(mx, HOMESTEAD_MAP_HEIGHT - 1)).toBe(false);
    }
    expect(isHoeableMapTile(-1, 5)).toBe(false);
    expect(isHoeableMapTile(HOMESTEAD_MAP_WIDTH, 5)).toBe(false);
  });
});

describe("worldToMap", () => {
  it("puts any bed square on the Homestead", () => {
    const yard = mapToSoilTile(28, 24);
    expect(isBedSquare(yard.tx, yard.ty)).toBe(true);
    const world = { x: yard.tx * SOIL_TILE + 8, y: yard.ty * SOIL_TILE + 8 };
    expect(worldToMap(world)).toEqual({ area: "homestead", ...soilWorldToMap(world) });
    expect(worldToMap({ x: 0, y: 0 })?.area).toBe("homestead");
  });

  it("knows where unmapped land is not", () => {
    expect(worldToMap({ x: 5000, y: 5000 })).toBeNull();
  });
});
