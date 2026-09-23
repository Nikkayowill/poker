import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHoeableMapTile, isHoeableSoilTile, mapToSoilTile, soilToMapTile } from "@/lib/stackacres/hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "@/lib/stackacres/homestead-ground";
import { SOIL_TILE, homeStarterSoilTiles, soilTileAt } from "@/lib/stackacres/soil";
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

describe("the Crop Fields are the north half of the Homestead", () => {
  it("sit where homestead.py draws them, so no bed dug out there moved", () => {
    expect(fieldWorldToMap({ x: CROP_FIELD_BEDS.x, y: CROP_FIELD_BEDS.y })).toEqual(FIELD_ORIGIN);
    expect(FIELD_ORIGIN).toEqual({ x: 6 * SOIL_TILE, y: 2 * SOIL_TILE });
    const field = area.zones.find((z) => z.tag === "field");
    expect(field).toMatchObject({ x: FIELD_ORIGIN.x, y: FIELD_ORIGIN.y, w: CROP_FIELD_BEDS.width, h: CROP_FIELD_BEDS.height });
  });

  it("round-trips every field square through the map", () => {
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

  it("says a map pixel off the field is off the field", () => {
    expect(fieldMapToWorld({ x: FIELD_ORIGIN.x - 1, y: FIELD_ORIGIN.y + 8 })).toBeNull();
    expect(fieldMapToWorld({ x: FIELD_ORIGIN.x + CROP_FIELD_BEDS.width, y: FIELD_ORIGIN.y + 8 })).toBeNull();
  });

  it("is ground the hoe works, all of it", () => {
    for (let ty = -16; ty < 16; ty++) {
      for (let tx = -16; tx < 16; tx++) expect(isHoeableSoilTile(tx, ty)).toBe(true);
    }
  });

  it("leaves nothing walking off to a separate Crop Fields map", () => {
    expect(area.exits.map((e) => e.to)).not.toContain("oldfields");
  });
});

describe("where a bed may go", () => {
  it("stands the six free starter beds on real grass, not on the road", () => {
    for (const tile of homeStarterSoilTiles()) {
      const { mx, my } = soilToMapTile(tile.tx, tile.ty);
      expect(isHoeableMapTile(mx, my), `starter bed at map ${mx},${my}`).toBe(true);
      expect(isBedSquare(tile.tx, tile.ty)).toBe(true);
    }
  });

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
    const [starter] = homeStarterSoilTiles();
    const world = { x: starter.tx * SOIL_TILE + 8, y: starter.ty * SOIL_TILE + 8 };
    expect(worldToMap(world)).toEqual({ area: "homestead", ...soilWorldToMap(world) });
    expect(worldToMap({ x: 0, y: 0 })?.area).toBe("homestead");
  });

  it("knows where unmapped land is not", () => {
    expect(worldToMap({ x: 5000, y: 5000 })).toBeNull();
  });
});

describe("the beds already dug by the house (20260923120000_stackacres_one_soil_grid.sql)", () => {
  // The two paddocks the hoe used to be confined to, on the grid they used to
  // have, and the same shift the migration applies to every bed dug on them.
  const OLD_PADDOCKS = [
    { tx0: 100, ty0: 100, tx1: 107, ty1: 105 },
    { tx0: 115, ty0: 100, tx1: 122, ty1: 104 },
  ];
  const moved = (tx: number, ty: number) => ({ tx: tx - 118, ty: ty - 65 });

  it("land on grass, every square of both paddocks", () => {
    for (const r of OLD_PADDOCKS) {
      for (let ty = r.ty0; ty <= r.ty1; ty++) {
        for (let tx = r.tx0; tx <= r.tx1; tx++) {
          const to = moved(tx, ty);
          expect(isBedSquare(to.tx, to.ty), `paddock ${tx},${ty} -> ${to.tx},${to.ty}`).toBe(true);
        }
      }
    }
  });

  it("land where the starter beds now are, so the paddock is still one patch of grass", () => {
    const [first] = homeStarterSoilTiles();
    expect(moved(100, 100)).toEqual({ tx: first.tx, ty: first.ty });
  });

  it("never land on a Crop Fields square", () => {
    for (const r of OLD_PADDOCKS) {
      for (let ty = r.ty0; ty <= r.ty1; ty++) {
        for (let tx = r.tx0; tx <= r.tx1; tx++) {
          const to = moved(tx, ty);
          expect(soilTileInCropFieldBeds(to.tx, to.ty)).toBe(false);
        }
      }
    }
  });
});
