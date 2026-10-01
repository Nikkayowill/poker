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
 * North is up: the Crop Fields are the wild land round the yard, so they sit
 * above the Homestead. The Far Field is left off. It is its own map, reached
 * over the west bridge, not a part of this one.
 */

import type { ZoneId } from "./zones";

/** Somewhere on the map. Every place is a zone except the Crop Fields, which
 *  are ground inside the Homestead rather than a district of their own. */
export type MapPlaceId = ZoneId | "cropfields";

export interface MapPlace {
  readonly id: MapPlaceId;
  readonly label: string;
  /** Column and row in the map's grid, counting from the top left. */
  readonly col: number;
  readonly row: number;
}

export const MAP_COLUMNS = 1;
export const MAP_ROWS = 2;

export const MAP_PLACES: readonly MapPlace[] = [
  { id: "cropfields", label: "Crop Fields", col: 0, row: 0 },
  { id: "farmstead", label: "The Homestead", col: 0, row: 1 },
];
