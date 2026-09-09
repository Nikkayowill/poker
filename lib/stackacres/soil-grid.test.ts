import { describe, expect, it } from "vitest";
import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH } from "./isometric-grid-manager";
import { projectedBounds } from "./iso";
import { SOIL_TILE, createSoilMap, soilTileDiamond, soilTileRect, type SoilTile } from "./soil";
import {
  SOIL_BED_CELLS,
  SOIL_GRID_CELL,
  createSoilGrid,
  soilBedFootprint,
  soilPlacementAt,
  soilTileCell,
} from "./soil-grid";
import { CROP_FIELD_BEDS } from "./world";

const AREA = CROP_FIELD_BEDS;

function tile(tx: number, ty: number, order: number): SoilTile {
  return { tx, ty, order, origin: "purchased" };
}

function tilesInArea(): Array<{ tx: number; ty: number }> {
  const out: Array<{ tx: number; ty: number }> = [];
  for (let ty = AREA.y / SOIL_TILE; ty < (AREA.y + AREA.height) / SOIL_TILE; ty++) {
    for (let tx = AREA.x / SOIL_TILE; tx < (AREA.x + AREA.width) / SOIL_TILE; tx++) out.push({ tx, ty });
  }
  return out;
}

describe("the soil grid's cell", () => {
  it("is half a bed, and one cell projects to exactly one 64x32 diamond", () => {
    expect(SOIL_GRID_CELL * SOIL_BED_CELLS).toBe(SOIL_TILE);
    const diamond = projectedBounds({ x: 0, y: 0, width: SOIL_GRID_CELL, height: SOIL_GRID_CELL });
    expect(diamond.width).toBe(ISO_TILE_WIDTH);
    expect(diamond.height).toBe(ISO_TILE_HEIGHT);
  });

  it("covers the meadow in whole cells with every bed on an integer anchor", () => {
    const { grid } = createSoilGrid(createSoilMap());
    expect(grid.columns * SOIL_GRID_CELL).toBe(AREA.width);
    expect(grid.rows * SOIL_GRID_CELL).toBe(AREA.height);
    for (const t of tilesInArea()) {
      const cell = soilTileCell(AREA, t);
      expect(Number.isInteger(cell.x) && Number.isInteger(cell.y)).toBe(true);
      expect(grid.canPlace(cell.x, cell.y, SOIL_BED_CELLS, SOIL_BED_CELLS).ok).toBe(true);
    }
  });

  it("lands a bed's footprint on the same four screen corners as soilTileDiamond", () => {
    const { grid } = createSoilGrid(createSoilMap());
    for (const t of tilesInArea()) {
      const fromGrid = grid.footprintCorners(soilBedFootprint(AREA, t));
      const fromSoil = soilTileDiamond(t.tx, t.ty);
      expect(fromGrid).toEqual(fromSoil);
    }
  });
});

describe("createSoilGrid", () => {
  it("marks every cell of each bed as crop, keyed by the tile", () => {
    const soil = createSoilMap([tile(-3, -3, 1), tile(2, 1, 2)]);
    const { grid } = createSoilGrid(soil);
    const first = soilBedFootprint(AREA, { tx: -3, ty: -3 });
    for (let y = first.y; y < first.y + first.height; y++) {
      for (let x = first.x; x < first.x + first.width; x++) {
        expect(grid.getCell(x, y)).toEqual({ occupancy: "crop", textureKey: "soil-bed", assetId: "-3,-3" });
      }
    }
    expect(grid.assets.map((a) => a.id).sort()).toEqual(["-3,-3", "2,1"]);
    expect(grid.getCell(first.x + 2, first.y)).toEqual({ occupancy: "empty", textureKey: "grass", assetId: null });
  });

  it("skips a stale tile outside the area instead of throwing", () => {
    const soil = createSoilMap([tile(-9, -9, 1), tile(0, 0, 2)]);
    const { grid } = createSoilGrid(soil);
    expect(grid.assets).toHaveLength(1);
    expect(grid.getAsset("0,0")).toBeDefined();
  });
});

describe("soilPlacementAt", () => {
  const soilGrid = createSoilGrid(createSoilMap([tile(0, 0, 1)]));

  it("reports the standing bed under a point on it", () => {
    const p = soilPlacementAt(soilGrid, { x: 40, y: 20 });
    expect(p.kind).toBe("occupied");
    if (p.kind !== "occupied") return;
    expect(p.tile).toEqual({ tx: 0, ty: 0 });
    expect(p.asset.id).toBe("0,0");
  });

  it("reports free ground inside the field, snapped to its tile", () => {
    const p = soilPlacementAt(soilGrid, { x: -150, y: -150 });
    expect(p).toMatchObject({ kind: "free", tile: { tx: -3, ty: -3 } });
    expect(p.footprint).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it("refuses the verge between the fence and the field", () => {
    // Inside the Farmstead's own fenced bounds, outside the Crop Fields'
    // grow area (the two used to be separate districts; the 2026-09-08
    // merge folded the Crop Fields into the Farmstead, but the beds still
    // only root in their own 384-square patch of it).
    expect(soilPlacementAt(soilGrid, { x: -250, y: 0 }).kind).toBe("outside");
    expect(soilPlacementAt(soilGrid, { x: 0, y: 250 }).kind).toBe("outside");
  });

  it("agrees with the service's own inside-the-field rule for every nearby tile", () => {
    for (let ty = -8; ty <= 6; ty++) {
      for (let tx = -6; tx <= 8; tx++) {
        const r = soilTileRect(tx, ty);
        const inMeadow =
          r.x >= AREA.x &&
          r.y >= AREA.y &&
          r.x + r.width <= AREA.x + AREA.width &&
          r.y + r.height <= AREA.y + AREA.height;
        const p = soilPlacementAt(soilGrid, { x: r.x + 1, y: r.y + 1 });
        expect(p.kind === "outside").toBe(!inMeadow);
      }
    }
  });
});
