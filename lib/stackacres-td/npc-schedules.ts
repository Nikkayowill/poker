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

  // The Town Square's shopkeepers (lib/stackacres/town-buyers.ts, seed-seller.ts). Each keeps a stall or a
  // doorstep through the day, breaks for an hour at midday, and goes in at their own door at night, when
  // the shop is shut. The spots are open ground in the City's own area.json.
  "cora-stall": { area: "city", spots: [spot(328, 504, "up", "harvest", 4200), spot(360, 504, "down", "idle", 8000)] },
  "cora-lunch": { area: "city", spots: [spot(296, 440, "right", "idle", 60_000)] },
  "cora-home": { area: "city", spots: [{ ...spot(408, 664, "up", "idle", 60_000), indoors: true }] },
  "hank-stall": { area: "city", spots: [spot(616, 424, "down", "idle", 9000), spot(600, 424, "right", "idle", 5000)] },
  "hank-lunch": { area: "city", spots: [spot(392, 440, "left", "idle", 60_000)] },
  "hank-inn": { area: "city", spots: [spot(232, 376, "right", "idle", 60_000)] },
  "hank-home": { area: "city", spots: [{ ...spot(472, 184, "up", "idle", 60_000), indoors: true }] },
  "iris-store": { area: "city", spots: [spot(472, 392, "down", "idle", 9000), spot(440, 392, "right", "idle", 5000)] },
  "iris-lunch": { area: "city", spots: [spot(632, 404, "up", "idle", 60_000)] },
  "iris-home": { area: "city", spots: [{ ...spot(440, 664, "up", "idle", 60_000), indoors: true }] },
  "gus-quay": { area: "city", spots: [spot(746, 568, "left", "idle", 9000), spot(746, 590, "up", "harvest", 4000)] },
  "gus-lunch": { area: "city", spots: [spot(232, 376, "right", "idle", 60_000)] },
  "gus-home": { area: "city", spots: [{ ...spot(280, 184, "up", "idle", 60_000), indoors: true }] },

  // The rest of the Town Square. They shop, sit, tend the allotments and watch the river through the
  // day, and go in at their own door at night. Each place is open ground in the City's own area.json.
  "mabel-stalls": { area: "city", spots: [spot(272, 508, "down", "idle", 9_000), spot(300, 510, "up", "idle", 9_000)] },
  "mabel-board": { area: "city", spots: [spot(120, 392, "up", "idle", 9_000)] },
  "mabel-well": { area: "city", spots: [spot(253, 436, "up", "idle", 9_000)] },
  "mabel-bench": { area: "city", spots: [spot(178, 386, "right", "idle", 9_000)] },
  "mabel-cross": { area: "city", spots: [spot(330, 454, "down", "idle", 9_000), spot(358, 454, "left", "idle", 9_000)] },
  "mabel-bakery": { area: "city", spots: [spot(652, 404, "up", "idle", 12_000)] },
  "mabel-home": { area: "city", spots: [{ ...spot(216, 184, "up", "idle", 60_000), indoors: true }] },
  "priya-stalls": { area: "city", spots: [spot(340, 510, "down", "idle", 9_000), spot(380, 510, "up", "idle", 9_000)] },
  "priya-grocery": { area: "city", spots: [spot(500, 394, "down", "idle", 9_000), spot(524, 394, "left", "idle", 9_000)] },
  "priya-cross": { area: "city", spots: [spot(322, 456, "right", "idle", 10_000)] },
  "priya-bench": { area: "city", spots: [spot(410, 442, "left", "idle", 10_000)] },
  "priya-stalls-2": { area: "city", spots: [spot(512, 466, "down", "idle", 9_000), spot(540, 470, "up", "idle", 9_000)] },
  "priya-inn": { area: "city", spots: [spot(200, 384, "right", "idle", 12_000)] },
  "priya-home": { area: "city", spots: [{ ...spot(392, 184, "up", "idle", 60_000), indoors: true }] },
  "lena-bakery": { area: "city", spots: [spot(610, 402, "up", "idle", 9_000), spot(640, 408, "down", "idle", 9_000)] },
  "lena-stalls": { area: "city", spots: [spot(570, 478, "down", "idle", 9_000), spot(540, 474, "up", "idle", 9_000)] },
  "lena-bench": { area: "city", spots: [spot(310, 440, "right", "idle", 10_000)] },
  "lena-hall": { area: "city", spots: [spot(170, 540, "up", "idle", 9_000), spot(200, 540, "down", "idle", 9_000)] },
  "lena-cross": { area: "city", spots: [spot(372, 456, "left", "idle", 12_000)] },
  "lena-home": { area: "city", spots: [{ ...spot(536, 184, "up", "idle", 60_000), indoors: true }] },
  "tomas-road": { area: "city", spots: [spot(640, 206, "down", "idle", 9_000), spot(600, 204, "left", "idle", 9_000)] },
  "tomas-board": { area: "city", spots: [spot(132, 392, "up", "idle", 8_000)] },
  "tomas-grocery": { area: "city", spots: [spot(520, 396, "up", "idle", 9_000)] },
  "tomas-quay": { area: "city", spots: [spot(704, 502, "right", "idle", 12_000)] },
  "tomas-stalls": { area: "city", spots: [spot(512, 468, "up", "idle", 9_000)] },
  "tomas-inn": { area: "city", spots: [spot(236, 380, "right", "idle", 12_000)] },
  "tomas-home": { area: "city", spots: [{ ...spot(648, 184, "up", "idle", 60_000), indoors: true }] },
  "sam-inn": { area: "city", spots: [spot(216, 362, "down", "idle", 9_000), spot(238, 366, "left", "idle", 9_000)] },
  "sam-well": { area: "city", spots: [spot(268, 436, "right", "idle", 9_000)] },
  "sam-hall": { area: "city", spots: [spot(150, 540, "up", "idle", 9_000)] },
  "sam-bench": { area: "city", spots: [spot(178, 386, "right", "idle", 12_000)] },
  "sam-inn-2": { area: "city", spots: [spot(220, 364, "down", "idle", 14_000)] },
  "sam-home": { area: "city", spots: [{ ...spot(212, 356, "up", "idle", 60_000), indoors: true }] },
  "felix-stalls": { area: "city", spots: [spot(420, 510, "down", "idle", 9_000), spot(450, 506, "up", "idle", 9_000)] },
  "felix-bridge": { area: "city", spots: [spot(900, 452, "right", "idle", 12_000)] },
  "felix-bakery": { area: "city", spots: [spot(660, 408, "up", "idle", 9_000)] },
  "felix-beds": { area: "city", spots: [spot(400, 696, "up", "water", 5_200), spot(440, 696, "up", "harvest", 4_200)] },
  "felix-cross": { area: "city", spots: [spot(344, 462, "down", "idle", 10_000)] },
  "felix-home": { area: "city", spots: [{ ...spot(552, 664, "up", "idle", 60_000), indoors: true }] },
  "ned-tailor": { area: "city", spots: [spot(336, 368, "up", "idle", 9_000), spot(312, 384, "right", "idle", 9_000)] },
  "ned-road": { area: "city", spots: [spot(260, 204, "right", "idle", 9_000), spot(316, 204, "left", "idle", 9_000)] },
  "ned-bench": { area: "city", spots: [spot(264, 386, "left", "idle", 10_000)] },
  "ned-beds": { area: "city", spots: [spot(480, 696, "up", "water", 5_200), spot(520, 696, "up", "harvest", 4_200)] },
  "ned-tailor-2": { area: "city", spots: [spot(340, 370, "down", "idle", 10_000)] },
  "ned-home": { area: "city", spots: [{ ...spot(336, 370, "up", "idle", 60_000), indoors: true }] },
  "olive-bakery": { area: "city", spots: [spot(632, 406, "down", "idle", 9_000), spot(608, 404, "right", "idle", 9_000)] },
  "olive-table": { area: "city", spots: [spot(610, 400, "up", "idle", 10_000)] },
  "olive-road": { area: "city", spots: [spot(451, 206, "down", "idle", 9_000), spot(420, 204, "right", "idle", 9_000)] },
  "olive-bakery-2": { area: "city", spots: [spot(644, 406, "down", "idle", 12_000)] },
  "olive-home": { area: "city", spots: [{ ...spot(632, 392, "up", "idle", 60_000), indoors: true }] },
  "hugo-green": { area: "city", spots: [spot(138, 622, "right", "idle", 12_000)] },
  "hugo-bench": { area: "city", spots: [spot(82, 668, "up", "idle", 12_000)] },
  "hugo-board": { area: "city", spots: [spot(112, 394, "up", "idle", 9_000)] },
  "hugo-church": { area: "city", spots: [spot(172, 800, "up", "idle", 10_000)] },
  "hugo-green-2": { area: "city", spots: [spot(162, 628, "left", "idle", 12_000)] },
  "hugo-home": { area: "city", spots: [{ ...spot(76, 214, "up", "idle", 60_000), indoors: true }] },
  "winnie-yard": { area: "city", spots: [spot(272, 810, "left", "idle", 9_000), spot(240, 782, "up", "idle", 9_000)] },
  "winnie-church": { area: "city", spots: [spot(172, 800, "down", "idle", 10_000)] },
  "winnie-yard-2": { area: "city", spots: [spot(284, 780, "left", "idle", 12_000)] },
  "winnie-beds": { area: "city", spots: [spot(360, 744, "up", "water", 5_200), spot(400, 744, "up", "harvest", 4_200)] },
  "winnie-yard-3": { area: "city", spots: [spot(248, 800, "right", "idle", 12_000)] },
  "winnie-home": { area: "city", spots: [{ ...spot(172, 802, "up", "idle", 60_000), indoors: true }] },
  "tilly-mill": { area: "city", spots: [spot(700, 818, "up", "idle", 9_000), spot(714, 816, "right", "idle", 9_000)] },
  "tilly-quay": { area: "city", spots: [spot(704, 504, "right", "idle", 10_000)] },
  "tilly-bridge": { area: "city", spots: [spot(920, 456, "left", "idle", 10_000)] },
  "tilly-stalls": { area: "city", spots: [spot(570, 482, "up", "idle", 9_000), spot(596, 486, "left", "idle", 9_000)] },
  "tilly-mill-2": { area: "city", spots: [spot(712, 816, "down", "idle", 12_000)] },
  "tilly-home": { area: "city", spots: [{ ...spot(714, 818, "up", "idle", 60_000), indoors: true }] },
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
  // The Town Square. Shops open about six and shut about half past seven; whoever is not behind a stall
  // is at their lunch or at the inn, or indoors for the night. Lunches are staggered so the square is
  // never without a buyer.
  cora: {
    speed: 42,
    steps: [
      { hour: 6, station: "cora-stall" },
      { hour: 12, station: "cora-lunch" },
      { hour: 13, station: "cora-stall" },
      { hour: 19.5, station: "cora-home" },
    ],
  },
  hank: {
    speed: 40,
    steps: [
      { hour: 6.5, station: "hank-stall" },
      { hour: 13, station: "hank-lunch" },
      { hour: 14, station: "hank-stall" },
      { hour: 19.5, station: "hank-inn" },
      { hour: 22, station: "hank-home" },
    ],
  },
  iris: {
    speed: 42,
    steps: [
      { hour: 6, station: "iris-store" },
      { hour: 12.5, station: "iris-lunch" },
      { hour: 13.5, station: "iris-store" },
      { hour: 19, station: "iris-home" },
    ],
  },
  gus: {
    speed: 38,
    steps: [
      { hour: 6, station: "gus-quay" },
      { hour: 12, station: "gus-lunch" },
      { hour: 13, station: "gus-quay" },
      { hour: 19, station: "gus-home" },
    ],
  },

  // The rest of the square's people keep a slower, looser day than the shopkeepers: an errand, a sit, a
  // look at the river. Nobody is out after ten.
  mabel: {
    speed: 38,
    steps: [
      { hour: 6.5, station: "mabel-stalls" },
      { hour: 9, station: "mabel-board" },
      { hour: 11, station: "mabel-well" },
      { hour: 12.5, station: "mabel-bench" },
      { hour: 14.5, station: "mabel-cross" },
      { hour: 17, station: "mabel-bakery" },
      { hour: 20, station: "mabel-home" },
    ],
  },
  priya: {
    speed: 44,
    steps: [
      { hour: 7, station: "priya-stalls" },
      { hour: 10, station: "priya-grocery" },
      { hour: 12, station: "priya-cross" },
      { hour: 13.5, station: "priya-bench" },
      { hour: 16, station: "priya-stalls-2" },
      { hour: 18.5, station: "priya-inn" },
      { hour: 21, station: "priya-home" },
    ],
  },
  lena: {
    speed: 44,
    steps: [
      { hour: 7.5, station: "lena-bakery" },
      { hour: 10, station: "lena-stalls" },
      { hour: 12.5, station: "lena-bench" },
      { hour: 15, station: "lena-hall" },
      { hour: 18, station: "lena-cross" },
      { hour: 20.5, station: "lena-home" },
    ],
  },
  tomas: {
    speed: 40,
    steps: [
      { hour: 7, station: "tomas-road" },
      { hour: 9, station: "tomas-board" },
      { hour: 11, station: "tomas-grocery" },
      { hour: 13, station: "tomas-quay" },
      { hour: 16, station: "tomas-stalls" },
      { hour: 19, station: "tomas-inn" },
      { hour: 22, station: "tomas-home" },
    ],
  },
  sam: {
    speed: 42,
    steps: [
      { hour: 6, station: "sam-inn" },
      { hour: 10, station: "sam-well" },
      { hour: 12, station: "sam-hall" },
      { hour: 15, station: "sam-bench" },
      { hour: 18, station: "sam-inn-2" },
      { hour: 22, station: "sam-home" },
    ],
  },
  felix: {
    speed: 44,
    steps: [
      { hour: 7, station: "felix-stalls" },
      { hour: 9, station: "felix-bridge" },
      { hour: 12, station: "felix-bakery" },
      { hour: 14, station: "felix-beds" },
      { hour: 17, station: "felix-cross" },
      { hour: 20, station: "felix-home" },
    ],
  },
  ned: {
    speed: 36,
    steps: [
      { hour: 7, station: "ned-tailor" },
      { hour: 10, station: "ned-road" },
      { hour: 12.5, station: "ned-bench" },
      { hour: 15, station: "ned-beds" },
      { hour: 18, station: "ned-tailor-2" },
      { hour: 20, station: "ned-home" },
    ],
  },
  olive: {
    speed: 42,
    steps: [
      { hour: 5.5, station: "olive-bakery" },
      { hour: 11, station: "olive-table" },
      { hour: 13, station: "olive-road" },
      { hour: 16, station: "olive-bakery-2" },
      { hour: 19.5, station: "olive-home" },
    ],
  },
  hugo: {
    speed: 36,
    steps: [
      { hour: 7, station: "hugo-green" },
      { hour: 10, station: "hugo-bench" },
      { hour: 12, station: "hugo-board" },
      { hour: 14, station: "hugo-church" },
      { hour: 17, station: "hugo-green-2" },
      { hour: 20, station: "hugo-home" },
    ],
  },
  winnie: {
    speed: 34,
    steps: [
      { hour: 6, station: "winnie-yard" },
      { hour: 9, station: "winnie-church" },
      { hour: 12, station: "winnie-yard-2" },
      { hour: 14, station: "winnie-beds" },
      { hour: 17, station: "winnie-yard-3" },
      { hour: 19.5, station: "winnie-home" },
    ],
  },
  tilly: {
    speed: 46,
    steps: [
      { hour: 6.5, station: "tilly-mill" },
      { hour: 9, station: "tilly-quay" },
      { hour: 11.5, station: "tilly-bridge" },
      { hour: 14, station: "tilly-stalls" },
      { hour: 17, station: "tilly-mill-2" },
      { hour: 20, station: "tilly-home" },
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
  // Warm and talkative: always has a word for whoever comes to the stall.
  cora: { react: [220, 420], attention: [5000, 9000], fidget: [3000, 6500], chatty: 0.8, tempo: 1 },
  // Brisk and a little gruff about business, but he likes a chat once the stall is quiet.
  hank: { react: [260, 480], attention: [3500, 6500], fidget: [3500, 7500], chatty: 0.6, tempo: 1.02 },
  // Quick to look up, easy with strangers.
  iris: { react: [200, 360], attention: [4000, 7500], fidget: [2800, 6000], chatty: 0.7, tempo: 1.05 },
  // Slow and weathered, says little: the quay has taught him to wait.
  gus: { react: [340, 640], attention: [3000, 5500], fidget: [4500, 9000], chatty: 0.35, tempo: 0.9 },
  mabel: { react: [360, 660], attention: [6000, 10_000], fidget: [3500, 8000], chatty: 0.75, tempo: 0.86 },
  priya: { react: [220, 400], attention: [4000, 7000], fidget: [2800, 6000], chatty: 0.7, tempo: 1.04 },
  lena: { react: [240, 440], attention: [3500, 6500], fidget: [3000, 6500], chatty: 0.65, tempo: 1.02 },
  tomas: { react: [260, 480], attention: [3000, 5500], fidget: [3500, 7500], chatty: 0.5, tempo: 1 },
  sam: { react: [280, 520], attention: [4000, 7000], fidget: [3800, 8000], chatty: 0.6, tempo: 0.98 },
  felix: { react: [180, 340], attention: [2500, 5000], fidget: [2200, 5000], chatty: 0.55, tempo: 1.1 },
  ned: { react: [340, 620], attention: [5000, 9000], fidget: [4000, 8500], chatty: 0.5, tempo: 0.88 },
  olive: { react: [220, 400], attention: [4500, 8000], fidget: [3000, 6500], chatty: 0.7, tempo: 1 },
  hugo: { react: [360, 680], attention: [5000, 9000], fidget: [4500, 9000], chatty: 0.45, tempo: 0.86 },
  winnie: { react: [320, 600], attention: [4500, 8000], fidget: [4000, 8000], chatty: 0.4, tempo: 0.9 },
  tilly: { react: [180, 340], attention: [2500, 4800], fidget: [2000, 4800], chatty: 0.6, tempo: 1.12 },
};
