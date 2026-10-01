/**
 * Where the live game's world coordinates land on the top-down maps.
 *
 * The live farm keeps positions in plain Cartesian world units
 * (lib/stackacres/world.ts); the isometric view was only ever a projection.
 * The top-down maps are drawn in their own pixels, so the few places the
 * shell and the server care about are pinned here:
 *
 *   THE CROP FIELDS are the Old Fields. `CROP_FIELD_BEDS` is 32 by 32 soil
 *   tiles, and the Old Fields map lays them out tile for tile with the field's
 *   top-left world corner at map pixel FIELD_ORIGIN. A bed the server stores
 *   at world tile (tx, ty) is drawn at exactly one map tile, and a tap on a map
 *   tile names exactly one world tile, so nothing about placement rules moves.
 *   art/stackacres-td/areas/rig/oldfields.py draws the field at the same spot.
 *
 *   THE HOMESTEAD STARTER BEDS (lib/stackacres/soil.ts's `homeStarterSoilTiles`)
 *   are their own small lattice, pinned the same way onto the Homestead map
 *   itself at `HOME_BEDS_ORIGIN` -- they are not Crop Fields ground, so they
 *   do not share `FIELD_ORIGIN`, and a farm's soil map can hold tiles that
 *   resolve on either map depending which one a tile's (tx, ty) falls in.
 *
 *   A FEW LANDMARKS the shell asks for by world point (the Hen Haven trough for
 *   the feed drag, the dock end for fishing) map to where those things are
 *   drawn in the Homestead.
 *
 * Anything else has no place on the playable maps yet and maps to null.
 */

import { HOME_STARTER_ORIGIN, SOIL_TILE, isHomePlotTile } from "@/lib/stackacres/soil";
import { FISHING_SPOT } from "@/lib/stackacres/water";
import { CROP_FIELD_BEDS, penFeedSpot, type WorldPoint } from "@/lib/stackacres/world";

export type TopdownArea =
  | "homestead"
  | "oldfields"
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

/** Map pixel of the Crop Fields' top-left world corner on the Old Fields map (tile 6, 2). */
export const FIELD_ORIGIN = { x: 6 * SOIL_TILE, y: 2 * SOIL_TILE } as const;
export const FIELD_SIZE = CROP_FIELD_BEDS.width;

/** Homestead map pixels for the landmarks the shell anchors drags to. */
export const HOMESTEAD_TROUGH = { x: 600, y: 312 } as const;
export const HOMESTEAD_DOCK_END = { x: 226, y: 420 } as const;
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

/** A Crop Fields world point, in Old Fields map pixels. */
export function fieldWorldToMap(world: WorldPoint): { x: number; y: number } {
  return { x: world.x - CROP_FIELD_BEDS.x + FIELD_ORIGIN.x, y: world.y - CROP_FIELD_BEDS.y + FIELD_ORIGIN.y };
}

/** An Old Fields map pixel, as a Crop Fields world point, or null when it is off the field. */
export function fieldMapToWorld(map: { x: number; y: number }): WorldPoint | null {
  const world = { x: map.x - FIELD_ORIGIN.x + CROP_FIELD_BEDS.x, y: map.y - FIELD_ORIGIN.y + CROP_FIELD_BEDS.y };
  return inCropField(world) ? world : null;
}

/** Where a world point the shell asks about is drawn, or null when it isn't on a playable map. */
export function worldToMap(world: WorldPoint): MapPoint | null {
  if (inCropField(world)) return { area: "oldfields", ...fieldWorldToMap(world) };
  const trough = penFeedSpot("henhaven");
  if (world.x === trough.x && world.y === trough.y) return { area: "homestead", ...HOMESTEAD_TROUGH };
  if (world.x === FISHING_SPOT.x && world.y === FISHING_SPOT.y) return { area: "homestead", ...HOMESTEAD_DOCK_END };
  const sheep = penFeedSpot("wallow");
  if (world.x === sheep.x && world.y === sheep.y) return { area: "fold", ...FOLD_TROUGH };
  const cattle = penFeedSpot("oxfields");
  if (world.x === cattle.x && world.y === cattle.y) return { area: "pasture", ...PASTURE_TROUGH };
  return null;
}

/** A soil tile's top-left corner in Old Fields map pixels. */
export function soilTileToMap(tx: number, ty: number): { x: number; y: number } {
  return fieldWorldToMap({ x: tx * SOIL_TILE, y: ty * SOIL_TILE });
}

/**
 * The Homestead's grass paddocks (lib/stackacres/soil.ts's `HOME_PLOTS`, which
 * hold the six free starter beds in the west one), pinned onto the Homestead
 * map itself rather than the Old Fields -- this is not Crop Fields ground, so it
 * gets its own origin instead of `FIELD_ORIGIN`.
 *
 * `HOME_BEDS_ORIGIN` is the map pixel of soil tile `HOME_STARTER_ORIGIN`, the
 * west paddock's top-left square: map tile (4, 15), the same corner the rig's
 * WEST_BED starts on (art/stackacres-td/areas/rig/homestead.py). The east
 * paddock is on the same lattice, so it needs no origin of its own -- it is
 * simply further along.
 */
const HOME_BEDS_ORIGIN = { x: 64, y: 240 } as const;

/** The starter lattice's own world-unit corner, restated from
 *  `HOME_STARTER_ORIGIN` in tile units rather than copied as a literal, so
 *  moving that lattice in soil.ts moves where it draws too. */
const HOME_BEDS_WORLD_ORIGIN = { x: HOME_STARTER_ORIGIN.tx * SOIL_TILE, y: HOME_STARTER_ORIGIN.ty * SOIL_TILE };

/** Whether a world point falls on one of the Homestead's grass paddocks. */
export function inHomePlots(world: WorldPoint): boolean {
  return isHomePlotTile(Math.floor(world.x / SOIL_TILE), Math.floor(world.y / SOIL_TILE));
}

/** A paddock world point, in Homestead map pixels. */
export function homeBedsWorldToMap(world: WorldPoint): { x: number; y: number } {
  return { x: world.x - HOME_BEDS_WORLD_ORIGIN.x + HOME_BEDS_ORIGIN.x, y: world.y - HOME_BEDS_WORLD_ORIGIN.y + HOME_BEDS_ORIGIN.y };
}

/** A Homestead map pixel, as a paddock world point, or null when it is off the grass paddocks. */
export function homeBedsMapToWorld(map: { x: number; y: number }): WorldPoint | null {
  const world = { x: map.x - HOME_BEDS_ORIGIN.x + HOME_BEDS_WORLD_ORIGIN.x, y: map.y - HOME_BEDS_ORIGIN.y + HOME_BEDS_WORLD_ORIGIN.y };
  return inHomePlots(world) ? world : null;
}

/** A paddock square's top-left corner in Homestead map pixels. */
export function homePlotTileToMap(tx: number, ty: number): { x: number; y: number } {
  return homeBedsWorldToMap({ x: tx * SOIL_TILE, y: ty * SOIL_TILE });
}
