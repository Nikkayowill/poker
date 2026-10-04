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
 *   THE CROP FIELDS are the wild land round the yard (lib/stackacres/hoeable.ts's
 *   `isWildSoilTile`): the first bed dug out there is the milestone.
 *   `CROP_FIELD_BEDS` is only the old world rect now, kept so a world point the
 *   shell asks about still lands somewhere on the map.
 *
 *   A FEW LANDMARKS the shell asks for by world point (the Hen Haven trough for
 *   the feed drag, the lake dock's end for fishing) map to where those things
 *   are drawn in the Homestead.
 *
 * Anything else has no place on the playable maps yet and maps to null.
 */

import { SOIL_TO_MAP, isHoeableSoilTile } from "@/lib/stackacres/hoeable";
import { SOIL_TILE } from "@/lib/stackacres/soil";
import { FISHING_SPOT } from "@/lib/stackacres/water";
import { CROP_FIELD_BEDS, penFeedSpot, type WorldPoint } from "@/lib/stackacres/world";

export type TopdownArea =
  | "homestead"
  | "barn"
  | "workshop"
  | "farmhouse"
  // The Far Field (docs/stackacres-second-map-direction.md section 6a), through the gap in the
  // Homestead's east treeline.
  | "empire"
  // The city grocery (docs/stackacres-second-map-direction.md), walked into from the City's square.
  | "grocery"
  // The City, the market town over the Homestead's west bridge (art/stackacres-td/areas/rig/city.py).
  | "city";

export interface MapPoint {
  area: TopdownArea;
  x: number;
  y: number;
}

/** Map pixels between a soil world point and where it is drawn: the shared grid's offset. */
const SOIL_OFFSET = { x: SOIL_TO_MAP.tx * SOIL_TILE, y: SOIL_TO_MAP.ty * SOIL_TILE } as const;

/** Homestead map pixels for the landmarks the shell anchors drags to: Hen Haven's trough and the
 *  end of the lake dock (art/stackacres-td/areas/rig/homestead.py). */
export const HOMESTEAD_TROUGH = { x: 640, y: 464 } as const;
export const HOMESTEAD_DOCK_END = { x: 416, y: 34 } as const;

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

/** Whether a bed can stand on this soil tile at all: grass the hoe may break.
 *  Everywhere else is road, water or a roof. */
export function isBedSquare(tx: number, ty: number): boolean {
  return isHoeableSoilTile(tx, ty);
}

/** Where a world point the shell asks about is drawn, or null when it isn't on a playable map. */
export function worldToMap(world: WorldPoint): MapPoint | null {
  const trough = penFeedSpot("henhaven");
  if (world.x === trough.x && world.y === trough.y) return { area: "homestead", ...HOMESTEAD_TROUGH };
  if (world.x === FISHING_SPOT.x && world.y === FISHING_SPOT.y) return { area: "homestead", ...HOMESTEAD_DOCK_END };
  const tx = Math.floor(world.x / SOIL_TILE);
  const ty = Math.floor(world.y / SOIL_TILE);
  if (isBedSquare(tx, ty) || inCropField(world)) return { area: "homestead", ...soilWorldToMap(world) };
  return null;
}
