/**
 * The Crop Fields as a cell grid.
 *
 * An IsometricGridManager laid over the Crop Fields' grow area
 * (`CROP_FIELD_BEDS` in ./world.ts), rebuilt from the soil map whenever it
 * changes. A bed is SOIL_TILE (64) square and a cell is half that, so every
 * bed is a 2x2 footprint and a 32-unit square projects under ./iso.ts's
 * ISO_K = 1 to exactly one 64x32 diamond. The grid's origin is the projected
 * centre of the area's first cell, which keeps the manager's cell math and
 * the scene's `isoProject` landing on the same pixels; soil-grid.test.ts
 * holds the two together corner for corner.
 *
 * The grid is occupancy and snap only. Beds are still painted by the scene's
 * own soil painter, so the sprites the manager creates are inert stubs.
 */

import { isoProject } from "./iso";
import {
  IsometricGridManager,
  StubSprite,
  type Footprint,
  type GridCell,
  type PlacedAsset,
} from "./isometric-grid-manager";
import { SOIL_TILE, soilTileAt, soilTileKey, type SoilMap, type SoilTileCoord } from "./soil";
import { CROP_FIELD_BEDS, type WorldPoint, type WorldRect } from "./world";

/** World units per grid cell: half a bed. */
export const SOIL_GRID_CELL = SOIL_TILE / 2;
/** A bed's footprint, in cells per side. */
export const SOIL_BED_CELLS = SOIL_TILE / SOIL_GRID_CELL;
export const SOIL_BED_TEXTURE_KEY = "soil-bed";
export const SOIL_GROUND_TEXTURE_KEY = "grass";

export interface SoilGrid {
  readonly area: WorldRect;
  readonly grid: IsometricGridManager;
}

export type SoilPlacement =
  /** The bed would hang outside the grow area, which the service refuses. */
  | { readonly kind: "outside"; readonly tile: SoilTileCoord; readonly footprint: Footprint }
  /** Bare ground where a new bed fits. */
  | { readonly kind: "free"; readonly tile: SoilTileCoord; readonly footprint: Footprint }
  /** A bed already stands here. */
  | {
      readonly kind: "occupied";
      readonly tile: SoilTileCoord;
      readonly footprint: Footprint;
      readonly asset: PlacedAsset;
    };

/** The grid cell a bed's north-most corner sits in. Integer for any area
 *  aligned to the bed lattice, which soil.test.ts holds the meadow to. */
export function soilTileCell(area: WorldRect, tile: SoilTileCoord): GridCell {
  return {
    x: (tile.tx * SOIL_TILE - area.x) / SOIL_GRID_CELL,
    y: (tile.ty * SOIL_TILE - area.y) / SOIL_GRID_CELL,
  };
}

export function soilBedFootprint(area: WorldRect, tile: SoilTileCoord): Footprint {
  const cell = soilTileCell(area, tile);
  return { x: cell.x, y: cell.y, width: SOIL_BED_CELLS, height: SOIL_BED_CELLS };
}

/**
 * Builds the grid for a soil map. A tile outside the area (a stale save
 * from before a re-lay) is skipped rather than thrown on: the grid answers
 * placement questions, it is not the record of what exists.
 */
export function createSoilGrid(soil: SoilMap, area: WorldRect = CROP_FIELD_BEDS): SoilGrid {
  const grid = new IsometricGridManager({
    columns: Math.floor(area.width / SOIL_GRID_CELL),
    rows: Math.floor(area.height / SOIL_GRID_CELL),
    origin: isoProject(area.x + SOIL_GRID_CELL / 2, area.y + SOIL_GRID_CELL / 2),
    groundTextureKey: SOIL_GROUND_TEXTURE_KEY,
    createSprite: (spec) => new StubSprite(spec),
  });
  for (const tile of soil.values()) {
    const f = soilBedFootprint(area, tile);
    grid.placeAsset(f.x, f.y, "crop", f.width, f.height, {
      id: soilTileKey(tile.tx, tile.ty),
      textureKey: SOIL_BED_TEXTURE_KEY,
    });
  }
  return { area, grid };
}

/**
 * What a bed bought under a world point would do: land on bare ground, act
 * on the bed already there, or be refused for hanging outside the field.
 * Snaps through the same `soilTileAt` the purchase itself uses, so the
 * answer and the action cannot disagree about which tile is meant.
 */
export function soilPlacementAt(soilGrid: SoilGrid, world: WorldPoint): SoilPlacement {
  const tile = soilTileAt(world.x, world.y);
  const footprint = soilBedFootprint(soilGrid.area, tile);
  const standing = soilGrid.grid.getAsset(soilTileKey(tile.tx, tile.ty));
  if (standing) return { kind: "occupied", tile, footprint, asset: standing };
  const check = soilGrid.grid.canPlace(footprint.x, footprint.y, footprint.width, footprint.height);
  if (check.ok) return { kind: "free", tile, footprint };
  if (check.reason === "overlap") {
    const blocker = check.blockingCells[0];
    const asset = soilGrid.grid.assetAt(blocker.x, blocker.y);
    if (asset) return { kind: "occupied", tile, footprint, asset };
  }
  return { kind: "outside", tile, footprint };
}
