/**
 * The world map: every place the farmer can walk to, laid out the way the
 * areas actually join up.
 *
 * The map sheet (components/arcade/stackacres/stackacres-map-sheet.tsx) is
 * the game's only orientation aid now -- the How to Play modal and the
 * standing hint caption are both gone (Kayo, 2026-09-17: "the how to play
 * ... shouldnt even be there if the onboarding is good. all theyll need is
 * the map of this world to click on with their indicator").
 *
 * SHRUNK 2026-09-28: the Mine, the Ancestral Oak, Town Square, the Coast,
 * the Fold and Cattle Pasture all had their gates removed the same day (the
 * six districts, ../story/travelers.ts's own header). The Fold and Cattle
 * Pasture stay real, Gold-gated sectors (../sectors.ts) a player can still
 * clear from the barn's Livestock tab -- they are just no longer a place
 * with a gate to walk to, so they are off this map rather than a dead tap.
 * The grid below still mirrors the Homestead's own exits in
 * public/stackacres-td/areas/homestead/area.json: the Crop Fields, through
 * the north lane. `map-places.test.ts` pins that against the area file.
 */

import type { ZoneId } from "./zones";

/** Somewhere on the map. Every area is a zone except the Crop Fields, which
 *  are ground inside the Homestead rather than a district of their own. */
export type MapPlaceId = ZoneId | "cropfields";

export interface MapPlace {
  readonly id: MapPlaceId;
  readonly label: string;
  /** Column and row in the map's grid, counting from the top left. */
  readonly col: number;
  readonly row: number;
}

export const MAP_COLUMNS = 2;
export const MAP_ROWS = 1;

/** North is up. Every cell here is a place; the gaps are just grass. */
export const MAP_PLACES: readonly MapPlace[] = [
  { id: "cropfields", label: "Crop Fields", col: 0, row: 0 },
  { id: "farmstead", label: "The Homestead", col: 1, row: 0 },
];
