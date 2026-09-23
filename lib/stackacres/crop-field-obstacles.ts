/**
 * Where the Crop Fields' overgrowth stands.
 *
 * The Crop Fields start covered in trees, boulders and scrub
 * (./land-clearing.ts's "cropfields" list), and a square with something
 * standing on it is a square the hoe cannot break. That makes this a rule the
 * SERVER has to hold too, unlike the Fold's and the Pasture's obstacles,
 * which only the scene ever places. So the layout is worked out here, from
 * nothing but the hoeable map (./homestead-ground.ts) and the obstacle list,
 * and the scene and the server both read the same answer.
 *
 * Dealt by lib/stackacres-td/land-obstacles.ts, the same deal the Fold uses:
 * seeded, so every farm has the same field, and it will not seat anything
 * that walls ground off. It is dealt inside the field only, from the gate at
 * the top of the lane, so what happens in the rest of the farm never moves a
 * tree out here.
 *
 * A BED WINS. A few farms already dug beds out here before it was overgrown.
 * Nothing is treated as standing on a square that holds a bed: the scene does
 * not draw it, and it never blocks anything.
 *
 * Pure and renderer-free: the server imports this.
 */

import { dealLandObstacles, type LandObstaclePlacement } from "@/lib/stackacres-td/land-obstacles";
import { tileKey } from "@/lib/stackacres-td/movement";
import { FIELD_MAP_TILE, isHoeableMapTile, soilToMapTile } from "./hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH } from "./homestead-ground";
import { LAND_OBSTACLES } from "./land-clearing";
import { SOIL_TILE } from "./soil";
import { CROP_FIELD_BEDS } from "./world";

const MAP_TILE = 16;
const FIELD_TILES = CROP_FIELD_BEDS.width / SOIL_TILE;
/** Where the lane comes into the field: LANE_TX in art/stackacres-td/areas/rig/homestead.py, on the field's last row. */
const GATE = { tx: 14, ty: FIELD_MAP_TILE.ty + FIELD_TILES - 1 } as const;
const SEED = 0x5eed_f1e1d;

function inField(mx: number, my: number): boolean {
  return (
    mx >= FIELD_MAP_TILE.tx &&
    my >= FIELD_MAP_TILE.ty &&
    mx < FIELD_MAP_TILE.tx + FIELD_TILES &&
    my < FIELD_MAP_TILE.ty + FIELD_TILES
  );
}

let dealt: readonly LandObstaclePlacement[] | null = null;

/** Every Crop Fields obstacle and the map tile it stands on. */
export function cropFieldObstaclePlacements(): readonly LandObstaclePlacement[] {
  if (dealt) return dealt;
  const blocked = new Set<string>();
  for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my += 1) {
    for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx += 1) {
      if (!inField(mx, my) || !isHoeableMapTile(mx, my)) blocked.add(tileKey(mx, my));
    }
  }
  dealt = dealLandObstacles(
    LAND_OBSTACLES.cropfields,
    {
      width: HOMESTEAD_MAP_WIDTH,
      height: HOMESTEAD_MAP_HEIGHT,
      tile: MAP_TILE,
      blocked,
      // The way in from the lane stays open.
      keepClear: [{ x: (GATE.tx - 1) * MAP_TILE, y: (GATE.ty - 2) * MAP_TILE, width: MAP_TILE * 3, height: MAP_TILE * 3 }],
      from: GATE,
    },
    SEED,
  );
  return dealt;
}

/** The Crop Fields obstacle dealt onto this map tile, if any, standing or not. */
export function cropFieldObstacleOnMapTile(mx: number, my: number): LandObstaclePlacement | null {
  return cropFieldObstaclePlacements().find((p) => p.tx === mx && p.ty === my) ?? null;
}

/** The Crop Fields obstacle dealt onto the map tile under this soil tile, if any. */
export function cropFieldObstacleOnSoilTile(tx: number, ty: number): LandObstaclePlacement | null {
  const { mx, my } = soilToMapTile(tx, ty);
  return cropFieldObstacleOnMapTile(mx, my);
}

/** Whether a Crop Fields obstacle still stands on this soil tile, given the ids already cleared. */
export function overgrownSoilTile(tx: number, ty: number, cleared: ReadonlySet<string>): boolean {
  const obstacle = cropFieldObstacleOnSoilTile(tx, ty);
  return obstacle !== null && !cleared.has(obstacle.id);
}

/** What the hoe says when something is still standing on the square. */
export const OVERGROWN_SQUARE = "Clear that first.";
