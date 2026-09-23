/**
 * Where the Crop Fields' overgrowth stands: the wild land round the Homestead's yard.
 *
 * The wild land starts covered in trees, boulders and scrub
 * (./land-clearing.ts's "cropfields" list), and a square with something
 * standing on it is a square the hoe cannot break. That makes this a rule the
 * SERVER has to hold too, unlike the Fold's and the Pasture's obstacles,
 * which only the scene ever places. So the layout is worked out here, from
 * nothing but the hoeable map (./homestead-ground.ts) and the obstacle list,
 * and the scene and the server both read the same answer.
 *
 * Dealt by lib/stackacres-td/land-obstacles.ts, the same deal the Fold uses:
 * seeded, so every farm has the same wild land, and it will not seat anything
 * that walls ground off. It is dealt only on the tiles the map marks wild
 * (./homestead-ground.ts's HOMESTEAD_WILD_ROWS), reached from where the farmer
 * starts, so what happens in the yard never moves a tree out here.
 *
 * A BED WINS. A few farms already dug beds out here before it was overgrown.
 * Nothing is treated as standing on a square that holds a bed: the scene does
 * not draw it, and it never blocks anything.
 *
 * Pure and renderer-free: the server imports this.
 */

import { dealLandObstacles, type LandObstaclePlacement } from "@/lib/stackacres-td/land-obstacles";
import { tileKey } from "@/lib/stackacres-td/movement";
import { isHoeableMapTile, isWildMapTile, soilToMapTile } from "./hoeable";
import { HOMESTEAD_MAP_HEIGHT, HOMESTEAD_MAP_WIDTH, HOMESTEAD_WALKABLE_ROWS } from "./homestead-ground";
import { LAND_OBSTACLES } from "./land-clearing";

const MAP_TILE = 16;
/** Where the farmer starts, on the road in front of the house: SPAWN in art/stackacres-td/areas/rig/homestead.py. */
const START = { tx: 31, ty: 21 } as const;
const SEED = 0x5eed_f1e1d;

let dealt: readonly LandObstaclePlacement[] | null = null;

/** Every Crop Fields obstacle and the map tile it stands on. */
export function cropFieldObstaclePlacements(): readonly LandObstaclePlacement[] {
  if (dealt) return dealt;
  // Reach is worked out over everywhere the farmer walks, roads included, so nothing is seated where it
  // would wall a stretch of road or yard off. Only the wild tiles are dealt onto.
  const blocked = new Set<string>();
  const keepClear: { x: number; y: number; width: number; height: number }[] = [];
  for (let my = 0; my < HOMESTEAD_MAP_HEIGHT; my += 1) {
    for (let mx = 0; mx < HOMESTEAD_MAP_WIDTH; mx += 1) {
      if (HOMESTEAD_WALKABLE_ROWS[my]?.[mx] !== "1") blocked.add(tileKey(mx, my));
      else if (!isWildMapTile(mx, my) || !isHoeableMapTile(mx, my)) {
        keepClear.push({ x: mx * MAP_TILE, y: my * MAP_TILE, width: MAP_TILE, height: MAP_TILE });
      }
    }
  }
  dealt = dealLandObstacles(
    LAND_OBSTACLES.cropfields,
    {
      width: HOMESTEAD_MAP_WIDTH,
      height: HOMESTEAD_MAP_HEIGHT,
      tile: MAP_TILE,
      blocked,
      keepClear,
      from: START,
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
