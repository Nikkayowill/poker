/**
 * Where the eleven travelers stand, and how a tap finds one.
 *
 * Each traveler is a `PropKind` (../props.ts holds the picture box and the
 * ground shadow, the same way it does for a lamp post) placed by THIS module
 * rather than by YARD_PROPS: the yard cluster is hand-placed furniture, and
 * these are characters with a district each in ./travelers.ts. Same split
 * the retired visitors module kept, for the same reason.
 *
 * Every spot is searched, not typed: a seeded reject-and-retry over the
 * district's own bounds, cleared against the real path, pond, building and
 * prop geometry, so nobody ships a coordinate that turns out to be on a
 * road. Deterministic by traveler id, so the same traveler stands on the
 * same spot on every boot, and placement.test.ts holds every spot to the
 * same checks. A search that finds nothing throws at module load rather
 * than landing somewhere unchecked; the test is what catches that.
 *
 * Ray is the one exception to "somewhere in the district": he stands beside
 * his own house (../world.ts's RAY_HOUSE_FOOTPRINT), found by walking
 * outward from its wall until the ground is clear.
 */

import { PROP_SIZE, YARD_PROPS, farmsteadClutter, propRect, type PropKind, type PropPlacement } from "../props";
import {
  BARN_FOOTPRINT,
  MIDNIGHT_MERCHANT_SPOT,
  RAY_HOUSE_FOOTPRINT,
  WHEAT_FIELD,
  growAreaBounds,
  seededRandom,
  seedFromId,
  type WorldPoint,
  type WorldRect,
} from "../world";
import { CROP_FIELD, yardRect } from "../yard";
import { GREENHOUSE_PLOT } from "../greenhouse";
import { MONK_POST, MONK_TAP_ZONE } from "../monk";
import { STACKACRES_ZONES, zoneAt, type ZoneId } from "../zones";
import { nearPath } from "../paths";
import { FARM_JUNCTIONS } from "../path-junctions";
import { inPondZone } from "../water";
import { TRAVELER_CATALOGUE, TRAVELER_IDS, type TravelerId } from "./travelers";

/** Which `PropKind` each traveler paints as. */
export const TRAVELER_KIND: Readonly<Record<TravelerId, PropKind>> = {
  ray: "travelerRay",
  pierre: "travelerPierre",
  miles: "travelerMiles",
  skye: "travelerSkye",
  barnaby: "travelerBarnaby",
  arthur: "travelerArthur",
  brayden: "travelerBrayden",
  ivy: "travelerIvy",
  wes: "travelerWes",
  bea: "travelerBea",
  leo: "travelerLeo",
};

const KIND_TO_TRAVELER = new Map<PropKind, TravelerId>(TRAVELER_IDS.map((id) => [TRAVELER_KIND[id], id] as const));

/** The traveler a `PropKind` names, or null for every other prop. */
export function travelerForKind(kind: PropKind): TravelerId | null {
  return KIND_TO_TRAVELER.get(kind) ?? null;
}

export interface TravelerPlacement extends PropPlacement {
  readonly traveler: TravelerId;
}

/* ------------------------------------------------------------------ */
/* Clear ground                                                        */
/* ------------------------------------------------------------------ */

function insideRect(x: number, y: number, rect: WorldRect, margin: number): boolean {
  return (
    x >= rect.x - margin &&
    x <= rect.x + rect.width + margin &&
    y >= rect.y - margin &&
    y <= rect.y + rect.height + margin
  );
}

function boxesOverlap(a: WorldRect, b: WorldRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** The picture box a traveler's feet at (x, y) would cover. */
function travelerBox(id: TravelerId, x: number, y: number): WorldRect {
  return propRect({ kind: TRAVELER_KIND[id], x, y });
}

/** Buildings and worked ground a traveler must keep their FEET out of. A
 *  picture overlapping a building's picture is fine (that is what standing
 *  in front of one looks like); feet inside its footprint is not. */
const FARMSTEAD_KEEP_OUT: readonly WorldRect[] = [
  BARN_FOOTPRINT,
  RAY_HOUSE_FOOTPRINT,
  MONK_TAP_ZONE,
  GREENHOUSE_PLOT,
  WHEAT_FIELD,
  growAreaBounds("farmstead"),
  CROP_FIELD,
];

const FARMSTEAD_CLEARANCE = 8;
const PROP_GAP = 4;
const NPC_GAP = 30;

/** The yard's own furniture plus the deterministic clutter scattered south
 *  of it -- everything on the Farmstead with a picture box to keep off. */
const FARMSTEAD_PROPS: readonly PropPlacement[] = [...YARD_PROPS, ...farmsteadClutter()];

interface ClearOptions {
  /** How close the feet may come to a building's footprint. */
  readonly buildingMargin: number;
  /** Ray stands behind the low field wall by his house on purpose; every
   *  other traveler keeps off every prop. */
  readonly ignoreWalls: boolean;
}

function farmsteadClear(id: TravelerId, x: number, y: number, options: ClearOptions): boolean {
  if (zoneAt(x, y) !== "farmstead") return false;
  if (nearPath(x, y) || inPondZone(x, y)) return false;
  if (FARM_JUNCTIONS.some((j) => Math.hypot(x - j.at.x, y - j.at.y) < j.reach + PROP_GAP)) return false;
  if (FARMSTEAD_KEEP_OUT.some((rect) => insideRect(x, y, rect, options.buildingMargin))) return false;
  if (Math.hypot(x - MIDNIGHT_MERCHANT_SPOT.x, y - MIDNIGHT_MERCHANT_SPOT.y) < NPC_GAP) return false;
  if (Math.hypot(x - MONK_POST.x, y - MONK_POST.y) < NPC_GAP) return false;
  const box = travelerBox(id, x, y);
  for (const prop of FARMSTEAD_PROPS) {
    if (options.ignoreWalls && prop.kind === "stoneWall") continue;
    if (boxesOverlap(box, propRect(prop), PROP_GAP)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* The searches                                                        */
/* ------------------------------------------------------------------ */

const SEARCH_TRIES = 600;

/** How far apart two travelers in the same district must stand, centre to
 *  centre -- generous next to any one picture box. */
const TRAVELER_MIN_GAP = 50;

function farFromTaken(x: number, y: number, taken: readonly WorldPoint[]): boolean {
  return taken.every((p) => Math.hypot(p.x - x, p.y - y) >= TRAVELER_MIN_GAP);
}

/** A seeded point inside `rect` that passes `clear`. */
function searchRect(
  seed: number,
  rect: WorldRect,
  clear: (x: number, y: number) => boolean,
  what: string,
): WorldPoint {
  const random = seededRandom(seed);
  for (let attempt = 0; attempt < SEARCH_TRIES; attempt += 1) {
    const x = rect.x + random() * rect.width;
    const y = rect.y + random() * rect.height;
    if (clear(x, y)) return { x, y };
  }
  throw new Error(`no clear ground for ${what}`);
}

/**
 * The band each Farmstead traveler is looked for in, in the yard's own
 * literal coordinates (../yard.ts): Pierre on the grass between the road
 * and the Hen Coop, in reach of the windmill he cooks beside; Ivy on the
 * strip south of the Greenhouse, next to the glass she came to study.
 */
const FARMSTEAD_BANDS: Readonly<Record<"pierre" | "ivy", WorldRect>> = {
  pierre: yardRect(236, 84, 190, 110),
  ivy: yardRect(340, 396, 116, 34),
};

const OTHERS: ClearOptions = { buildingMargin: FARMSTEAD_CLEARANCE, ignoreWalls: false };
const RAY: ClearOptions = { buildingMargin: 2, ignoreWalls: true };

/**
 * Beside his own house: walked outward from the east wall first (the lane
 * runs down the west side), a step at a time, until his feet are on clear
 * ground. The field wall east of the house is deliberately not an obstacle
 * for him -- a spirit standing behind a knee-high wall is the picture.
 */
function raySpot(): WorldPoint {
  const house = RAY_HOUSE_FOOTPRINT;
  const feetLine = house.y + house.height;
  for (const dy of [0, 4, -4, 8, -8, 12, -12, 16, 20]) {
    for (const dx of [6, 10, 14, 18, 22, 26, 30, 36, 42, 48]) {
      for (const x of [house.x + house.width + dx, house.x - dx]) {
        const y = feetLine + dy;
        if (farmsteadClear("ray", x, y, RAY)) return { x, y };
      }
    }
  }
  throw new Error("no clear ground beside Ray's house");
}

/** Somewhere genuinely inside an outer district: off its roads, off the
 *  pond, and clear of every traveler already standing in it. */
function districtSpot(id: TravelerId, zone: ZoneId, taken: readonly WorldPoint[]): WorldPoint {
  const bounds = STACKACRES_ZONES[zone].bounds;
  const margin = Math.min(bounds.width, bounds.height) * 0.18;
  const inset: WorldRect = {
    x: bounds.x + margin,
    y: bounds.y + margin,
    width: Math.max(0, bounds.width - margin * 2),
    height: Math.max(0, bounds.height - margin * 2),
  };
  return searchRect(
    seedFromId(`stackacres-traveler-${id}`),
    inset,
    (x, y) => zoneAt(x, y) === zone && !nearPath(x, y) && !inPondZone(x, y) && farFromTaken(x, y, taken),
    id,
  );
}

function farmsteadSpot(id: "pierre" | "ivy", taken: readonly WorldPoint[]): WorldPoint {
  return searchRect(
    seedFromId(`stackacres-traveler-${id}`),
    FARMSTEAD_BANDS[id],
    (x, y) => farmsteadClear(id, x, y, OTHERS) && farFromTaken(x, y, taken),
    id,
  );
}

/**
 * The eleven placements, computed once at module load. Fixed for as long as
 * the geometry they were searched against is: the search only replaces how
 * the numbers were arrived at, not their stability once shipped.
 */
export const TRAVELER_PROPS: readonly TravelerPlacement[] = (() => {
  const placed: TravelerPlacement[] = [];
  const takenByZone = new Map<ZoneId, WorldPoint[]>();
  for (const id of TRAVELER_IDS) {
    const zone = TRAVELER_CATALOGUE[id].zone;
    const taken = takenByZone.get(zone) ?? [];
    const spot =
      id === "ray"
        ? raySpot()
        : id === "pierre" || id === "ivy"
          ? farmsteadSpot(id, taken)
          : districtSpot(id, zone, taken);
    taken.push(spot);
    takenByZone.set(zone, taken);
    placed.push({ traveler: id, kind: TRAVELER_KIND[id], x: spot.x, y: spot.y });
  }
  return placed;
})();

/** Where one traveler stands. */
export function travelerSpot(id: TravelerId): TravelerPlacement {
  const placement = TRAVELER_PROPS.find((p) => p.traveler === id);
  if (!placement) throw new Error(`no placement for ${id}`);
  return placement;
}

/**
 * Whether a tapped ground point lands on a traveler, and which -- one
 * generic box test over TRAVELER_PROPS, the same math `rayHouseHitAt`
 * (../world.ts) uses for its single building.
 */
export function travelerHitAt(x: number, y: number): TravelerId | null {
  for (const prop of TRAVELER_PROPS) {
    const size = PROP_SIZE[prop.kind];
    const left = prop.x - size.w / 2;
    const top = prop.y - size.h;
    if (x >= left && x <= left + size.w && y >= top && y <= top + size.h) return prop.traveler;
  }
  return null;
}
