/**
 * Who does what on the farm, and when: the routines npc-routine.ts turns into walks and chores.
 *
 * Ray keeps the place going. He walks in from the east road in the morning, draws water at the well,
 * tends the greenhouse beds, minds his counter in the barn, feeds the hens at noon, picks berries in
 * the afternoon, sits on the porch at dusk and turns in by the east road again at night. Pierre and
 * Ivy work their corner but break at midday and wander for the evening. On day 6 of each week Ray
 * keeps a rest day (Routine.weekly).
 *
 * Every spot is a map point on open ground (npc-schedules.test.ts checks each one against the
 * exported area.json, and that every walk between them can be made). When the Homestead is redrawn,
 * that test says which spots need moving.
 */

import type { Temperament } from "./npc-mind";
import type { Routine, Spot, Station } from "./npc-routine";

const spot = (x: number, y: number, facing: Spot["facing"], chore: Spot["chore"], ms: number): Spot => ({ x, y, facing, chore, ms });

export const NPC_STATIONS: Record<string, Station> = {
  // Ray's home used to be in Town Square, off the east road -- gone with that district (2026-09-28,
  // ../story/travelers.ts's own header). He still turns in for the night by the same road, at the
  // gate that leads to the Far Field now.
  "ray-home": { area: "homestead", spots: [spot(976, 480, "down", "idle", 60_000)] },
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

  // A rest by the well, west of where Ray draws water. Pierre takes his evening break here.
  "well-bench": {
    area: "homestead",
    spots: [spot(412, 322, "up", "idle", 10_000), spot(372, 330, "right", "idle", 6000)],
  },

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
    // Day 6 of the week the barn stays shut: he lies in, still feeds the hens, and spends the rest of
    // the day on the porch and at the berries.
    weekly: {
      6: [
        { hour: 7.5, station: "ray-porch" },
        { hour: 10, station: "ray-hens" },
        { hour: 12, station: "ray-porch" },
        { hour: 15, station: "ray-berries" },
        { hour: 17.5, station: "ray-porch" },
        { hour: 20.5, station: "ray-home" },
      ],
    },
  },
  pierre: {
    speed: 38,
    steps: [
      { hour: 7, station: "pierre-yard" },
      { hour: 12, station: "ray-porch" },
      { hour: 13, station: "pierre-yard" },
      { hour: 17, station: "well-bench" },
      { hour: 19, station: "pierre-yard" },
      { hour: 21, station: "pierre-rest" },
    ],
  },
  ivy: {
    speed: 38,
    steps: [
      { hour: 7, station: "ivy-greenhouse" },
      { hour: 12, station: "ray-berries" },
      { hour: 13.5, station: "ivy-greenhouse" },
      { hour: 17, station: "ray-hens" },
      { hour: 19, station: "ivy-greenhouse" },
      { hour: 21, station: "ivy-rest" },
    ],
  },
};

/**
 * How each person carries themselves (npc-mind.ts): how quick they are to react, how long they give the
 * farmer their attention, how often a quiet moment turns into a look around, and how keen they are to
 * stop for a word with someone. Nobody is instant: the fastest still takes a fifth of a second to notice.
 */
export const NPC_TEMPERAMENTS: Record<string, Temperament> = {
  // Old, warm and unhurried: slow to look up, but once he has he's glad of the company.
  ray: { react: [320, 620], attention: [6000, 10_000], fidget: [3500, 8000], chatty: 0.8, tempo: 0.88 },
  // Restless and curious: quick to notice, can't keep still.
  pierre: { react: [200, 380], attention: [3500, 6500], fidget: [2200, 5000], chatty: 0.7, tempo: 1.08 },
  // Shy: notices you quickly, looks away soon, then keeps sneaking glances.
  ivy: { react: [220, 420], attention: [2000, 3800], fidget: [3000, 6500], chatty: 0.55, tempo: 1 },
};
