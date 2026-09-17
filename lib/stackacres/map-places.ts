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
 * The grid below is not a drawing decision: it mirrors each area's own exits
 * in public/stackacres-td/areas/<area>/area.json. The Homestead sits in the
 * middle, and every other place sits on the side its gate is on -- the Crop
 * Fields through the north lane, the Mine off the north-east, the Oak west,
 * Town Square east, the Fold south-east with the Pasture beyond it, and the
 * Coast south. `map-places.test.ts` pins that against the area files, so a
 * re-laid map cannot leave this quietly wrong.
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

export const MAP_COLUMNS = 4;
export const MAP_ROWS = 3;

/** North is up. Every cell here is a place; the gaps are just grass. */
export const MAP_PLACES: readonly MapPlace[] = [
  { id: "cropfields", label: "Crop Fields", col: 1, row: 0 },
  { id: "mine", label: "Mine Entrance", col: 2, row: 0 },
  { id: "oak", label: "The Ancestral Oak", col: 0, row: 1 },
  { id: "farmstead", label: "The Homestead", col: 1, row: 1 },
  { id: "townsquare", label: "Town Square", col: 2, row: 1 },
  { id: "coast", label: "Coastal Market", col: 1, row: 2 },
  { id: "wallow", label: "The Fold", col: 2, row: 2 },
  { id: "oxfields", label: "Cattle Pasture", col: 3, row: 2 },
];
