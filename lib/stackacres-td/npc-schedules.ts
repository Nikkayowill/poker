/**
 * Who does what on the farm, and when: the routines npc-routine.ts turns into walks and chores.
 *
 * Ray keeps the place going. He walks in from town in the morning, draws water at the well, tends
 * the greenhouse beds, minds his counter in the barn, feeds the hens at noon, picks berries in the
 * afternoon, sits on the porch at dusk and walks home to town at night. The Pixel Pilgrim fishes off
 * the dock, wanders the grove by the workshop, rests by the well and camps in the oak woods overnight.
 *
 * Every spot is a map point on open ground (npc-schedules.test.ts checks each one against the
 * exported area.json, and that every walk between them can be made). When the Homestead is redrawn,
 * that test says which spots need moving.
 */

import type { Routine, Spot, Station } from "./npc-routine";

const spot = (x: number, y: number, facing: Spot["facing"], chore: Spot["chore"], ms: number): Spot => ({ x, y, facing, chore, ms });

export const NPC_STATIONS: Record<string, Station> = {
  // Ray's home is in town. HOMESTEAD_ONLY keeps the player out of the Town Square for now, so the
  // player sees him leave by the east road at night and come back along it in the morning.
  "ray-home": { area: "townsquare", spots: [spot(120, 200, "down", "idle", 60_000)] },
  "ray-well": {
    area: "homestead",
    spots: [spot(430, 318, "up", "water", 7000), spot(452, 322, "left", "idle", 3000)],
  },
  "ray-greenhouse": {
    area: "homestead",
    spots: [
      spot(684, 392, "right", "water", 5200),
      spot(716, 392, "down", "harvest", 4200),
      spot(744, 408, "left", "water", 5200),
      spot(700, 404, "up", "harvest", 4200),
    ],
  },
  // Behind his counter in the barn, stocking the shelves between customers. The counter walls that
  // corner off, so he steps round behind it the way a shopkeeper would.
  "ray-counter": {
    area: "barn",
    spots: [spot(280, 72, "down", "idle", 9000), spot(256, 58, "up", "harvest", 4000), spot(304, 58, "up", "harvest", 4000)],
  },
  "ray-hens": {
    area: "homestead",
    spots: [spot(560, 432, "down", "harvest", 4200), spot(624, 436, "left", "harvest", 4200), spot(596, 412, "down", "idle", 3600)],
  },
  // The two berry bushes at the yard's edge, picked from the yard side.
  "ray-berries": {
    area: "homestead",
    spots: [spot(266, 300, "left", "harvest", 6000), spot(748, 300, "right", "harvest", 6000)],
  },
  "ray-porch": {
    area: "homestead",
    spots: [spot(520, 330, "down", "idle", 14_000), spot(540, 374, "up", "idle", 5000)],
  },

  "pilgrim-dock": {
    area: "homestead",
    spots: [spot(416, 44, "left", "fish", 16_000), spot(416, 110, "up", "idle", 5000)],
  },
  // The grove of old trees by the workshop, on the yard's side of the wild land.
  "pilgrim-grove": {
    area: "homestead",
    spots: [spot(296, 150, "down", "idle", 8000), spot(264, 134, "up", "harvest", 5000), spot(280, 232, "left", "harvest", 5000)],
  },
  "pilgrim-well": {
    area: "homestead",
    spots: [spot(412, 322, "up", "idle", 10_000), spot(372, 330, "right", "idle", 6000)],
  },
  // He sleeps out under the oaks, west of the Homestead.
  "pilgrim-camp": { area: "oak", spots: [spot(300, 200, "down", "idle", 60_000)] },

  // Two of the travelers who stay on the Homestead once they've arrived. They keep to their corner.
  "pierre-yard": {
    area: "homestead",
    spots: [spot(580, 352, "down", "idle", 7000), spot(546, 406, "down", "harvest", 4000), spot(616, 372, "left", "idle", 5000)],
  },
  "pierre-rest": { area: "homestead", spots: [spot(580, 352, "down", "idle", 60_000)] },
  "ivy-greenhouse": {
    area: "homestead",
    spots: [spot(690, 370, "down", "idle", 6000), spot(760, 392, "left", "water", 5200), spot(724, 414, "up", "harvest", 4200)],
  },
  "ivy-rest": { area: "homestead", spots: [spot(690, 370, "down", "idle", 60_000)] },
};

export const NPC_ROUTINES: Record<string, Routine> = {
  // Ray is old and in no hurry: he walks at about half the farmer's pace.
  ray: {
    speed: 34,
    steps: [
      { hour: 6, station: "ray-well" },
      { hour: 7, station: "ray-greenhouse" },
      { hour: 9.5, station: "ray-counter" },
      { hour: 12, station: "ray-hens" },
      { hour: 13.5, station: "ray-counter" },
      { hour: 16, station: "ray-berries" },
      { hour: 18, station: "ray-porch" },
      { hour: 20.5, station: "ray-home" },
    ],
  },
  pilgrim: {
    speed: 30,
    steps: [
      { hour: 5, station: "pilgrim-dock" },
      { hour: 9, station: "pilgrim-grove" },
      { hour: 12, station: "pilgrim-well" },
      { hour: 14, station: "pilgrim-dock" },
      { hour: 17, station: "pilgrim-grove" },
      { hour: 20, station: "pilgrim-camp" },
    ],
  },
  pierre: {
    speed: 38,
    steps: [
      { hour: 7, station: "pierre-yard" },
      { hour: 21, station: "pierre-rest" },
    ],
  },
  ivy: {
    speed: 38,
    steps: [
      { hour: 7, station: "ivy-greenhouse" },
      { hour: 21, station: "ivy-rest" },
    ],
  },
};
