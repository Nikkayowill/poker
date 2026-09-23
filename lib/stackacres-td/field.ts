/**
 * Where the live game's world coordinates land on the top-down maps.
 *
 * The live farm keeps positions in plain Cartesian world units
 * (lib/stackacres/world.ts); the isometric view was only ever a projection.
 * The top-down maps are drawn in their own pixels, so the few places the
 * shell and the server care about are pinned here:
 *
 *   EVERY BED is on the Homestead, on one soil grid (lib/stackacres/hoeable.ts's
 *   `SOIL_TO_MAP`). A bed the server stores at soil tile (tx, ty) is drawn on
 *   exactly one map tile, and a tap on a map tile names exactly one soil tile.
 *   There used to be two grids -- the Crop Fields and the paddocks by the house,
 *   pinned far apart -- because a bed could only exist in those two places. The
 *   hoe works on any grass now, and two grids would give one square two names.
 *
 *   THE CROP FIELDS are the north half of the same map. `CROP_FIELD_BEDS` is
 *   still the rect that counts as the Crop Fields (breaking ground there is a
 *   milestone), and it sits at map pixel FIELD_ORIGIN on the shared grid, which
 *   is why no bed dug out there moved when the grids became one.
 *
 *   A FEW LANDMARKS the shell asks for by world point (the Hen Haven trough for
 *   the feed drag, the dock end for fishing) map to where those things are
 *   drawn in the Homestead.
 *
 * Anything else has no place on the playable maps yet and maps to null.
 */

import { SOIL_TO_MAP, isHoeableSoilTile } from "@/lib/stackacres/hoeable";
import { SOIL_TILE, isHomeStarterSoilTile } from "@/lib/stackacres/soil";
import { FISHING_SPOT } from "@/lib/stackacres/water";
import { CROP_FIELD_BEDS, penFeedSpot, type WorldPoint } from "@/lib/stackacres/world";

export type TopdownArea =
  | "homestead"
  | "fold"
  | "pasture"
  | "coast"
  | "oak"
  | "mine"
  | "townsquare"
  | "barn"
  | "workshop"
  | "farmhouse";

export interface MapPoint {
  area: TopdownArea;
  x: number;
  y: number;
}

/** Map pixels between a soil world point and where it is drawn: the shared grid's offset. */
const SOIL_OFFSET = { x: SOIL_TO_MAP.tx * SOIL_TILE, y: SOIL_TO_MAP.ty * SOIL_TILE } as const;

/** Map pixel of the Crop Fields' top-left corner (map tile 6, 2), on the shared grid. */
export const FIELD_ORIGIN = {
  x: CROP_FIELD_BEDS.x + SOIL_OFFSET.x,
  y: CROP_FIELD_BEDS.y + SOIL_OFFSET.y,
} as const;
export const FIELD_SIZE = CROP_FIELD_BEDS.width;

/** Rows the farmyard starts down the merged map, in map pixels. The same
 *  number as `HOME_SHIFT` in art/stackacres-td/areas/rig/homestead.py (38
 *  tiles): every farmyard landmark below is the yard's own old coordinate plus
 *  this, which is why they can still be read against the map as it was drawn. */
const HOME_SHIFT = 38 * 16;

/** Homestead map pixels for the landmarks the shell anchors drags to. */
export const HOMESTEAD_TROUGH = { x: 600, y: 312 + HOME_SHIFT } as const;
export const HOMESTEAD_DOCK_END = { x: 226, y: 420 + HOME_SHIFT } as const;
/** The Fold's and the Cattle Pasture's pen troughs, where a feed drag lands. */
export const FOLD_TROUGH = { x: 240, y: 300 } as const;
export const PASTURE_TROUGH = { x: 470, y: 300 } as const;

export function inCropField(world: WorldPoint): boolean {
  return (
    world.x >= CROP_FIELD_BEDS.x &&
    world.y >= CROP_FIELD_BEDS.y &&
    world.x < CROP_FIELD_BEDS.x + CROP_FIELD_BEDS.width &&
    world.y < CROP_FIELD_BEDS.y + CROP_FIELD_BEDS.height
  );
}

/** A soil world point, in Homestead map pixels. Defined for every point: whether
 *  a bed may actually go there is `isBedSquare`'s question, not this one's. */
export function soilWorldToMap(world: WorldPoint): { x: number; y: number } {
  return { x: world.x + SOIL_OFFSET.x, y: world.y + SOIL_OFFSET.y };
}

/** A Homestead map pixel, as a soil world point. */
export function mapToSoilWorld(map: { x: number; y: number }): WorldPoint {
  return { x: map.x - SOIL_OFFSET.x, y: map.y - SOIL_OFFSET.y };
}

/** A soil tile's top-left corner in Homestead map pixels. */
export function soilTileToMap(tx: number, ty: number): { x: number; y: number } {
  return soilWorldToMap({ x: tx * SOIL_TILE, y: ty * SOIL_TILE });
}

/** Whether a bed can stand on this soil tile at all: grass the hoe may break, or
 *  one of the six free starter beds. Everywhere else is road, water or a roof. */
export function isBedSquare(tx: number, ty: number): boolean {
  return isHoeableSoilTile(tx, ty) || isHomeStarterSoilTile(tx, ty);
}

/** A Crop Fields world point, in Homestead map pixels. */
export function fieldWorldToMap(world: WorldPoint): { x: number; y: number } {
  return soilWorldToMap(world);
}

/** A Homestead map pixel, as a Crop Fields world point, or null when it is off the field. */
export function fieldMapToWorld(map: { x: number; y: number }): WorldPoint | null {
  const world = mapToSoilWorld(map);
  return inCropField(world) ? world : null;
}

/** Where a world point the shell asks about is drawn, or null when it isn't on a playable map. */
export function worldToMap(world: WorldPoint): MapPoint | null {
  const trough = penFeedSpot("henhaven");
  if (world.x === trough.x && world.y === trough.y) return { area: "homestead", ...HOMESTEAD_TROUGH };
  if (world.x === FISHING_SPOT.x && world.y === FISHING_SPOT.y) return { area: "homestead", ...HOMESTEAD_DOCK_END };
  const sheep = penFeedSpot("wallow");
  if (world.x === sheep.x && world.y === sheep.y) return { area: "fold", ...FOLD_TROUGH };
  const cattle = penFeedSpot("oxfields");
  if (world.x === cattle.x && world.y === cattle.y) return { area: "pasture", ...PASTURE_TROUGH };
  const tx = Math.floor(world.x / SOIL_TILE);
  const ty = Math.floor(world.y / SOIL_TILE);
  if (isBedSquare(tx, ty) || inCropField(world)) return { area: "homestead", ...soilWorldToMap(world) };
  return null;
}
