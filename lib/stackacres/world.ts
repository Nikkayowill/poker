/**
 * StackAcres as a place rather than a grid: which district a stock kind
 * belongs to, where its owned units stand and wander, and what grows wild
 * outside the fence line.
 *
 * Everything here is pure and unit-based so it can be tested without a
 * renderer. One unit is one device pixel of the vector art at zoom 1; the
 * scene scales the whole thing with its camera and never with the sprites.
 *
 * THERE IS NO PLOT GRID (see 2026-09-03's CLAUDE.md entry -- "districts hold
 * stock, not plots"). What used to live here as `cellOrigin`/`plotIndexAt`/
 * `plotNeighbor`/`PEN_GROUP_ORIGIN` -- a 16-plot ladder cut into four
 * districts' own 2x2 blocks -- is gone outright, not adapted: a unit you own
 * (./units.ts) has no position of its own to look up. `stockZone` still
 * answers "which district does this kind belong to" (the one thing that
 * mapping was ever really for), and `growAreaBounds` answers "where in that
 * district do its units stand" -- one rect per district, not one per plot.
 *
 * The camera is bounded (see ./bounds.ts): a hard edge sits a margin past
 * the outermost district, past which the camera cannot scroll. Inside that
 * edge the player can still roam past any district into procedurally-grown
 * scenery (see `chunkScenery`) -- bounding the camera did not touch that
 * system, it just means its farthest, thinnest tier is now scenery that sits
 * this side of the wall rather than a tail that used to run to infinity.
 */

import { STACKACRES_STOCK, type StackAcresStock } from "./catalogue";
// paths.ts imports only TYPES back from this module, so the cycle is
// harmless; a value import there would be read before this file finished
// evaluating and throw.
import { nearPath } from "./paths";
// Same arrangement as ./paths: water.ts imports only types from here.
import { inPondZone } from "./water";
// And again for ./zones, which grows the districts' own scenery in the same
// chunks the woodland uses and so has to be able to say "not here".
import { inOuterZone, type ZoneId } from "./zones";

/** One art unit, in device pixels of the baked vector art at zoom 1. */
export const STACKACRES_TILE = 16;

/**
 * A baking dimension only, not a world-geometry one any more. The isometric
 * pass already replaced the flat plot-cell ground painters (`mown`/`soil`/
 * `straw`/`muckbed`/`wild` in stackacres-art.ts) with diamond Graphics fills
 * drawn straight from their RAMPS colours -- those five painters have not
 * been drawn onto anything since, only baked -- and this migration removes
 * the plot cell those painters were ever sized to. Kept as a plain constant
 * so stackacres-art.ts's `CELL` still resolves; touching those five painters
 * is a separate, pre-existing cleanup, not part of this change.
 */
export const STACKACRES_CELL_TILES = 5;
export const STACKACRES_CELL = STACKACRES_TILE * STACKACRES_CELL_TILES;

/** Offset of a district's own yard elements from the world origin, so
 *  nothing sits flush at (0, 0). Barn, silo, paths and props are all
 *  hand-placed relative to this -- it is a fixed reference point for the
 *  Farmstead's yard. */
export const STACKACRES_MARGIN_TILES = 4;
export const STACKACRES_MARGIN = STACKACRES_TILE * STACKACRES_MARGIN_TILES;

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Where a kind lives, and where its units stand                       */
/* ------------------------------------------------------------------ */

/**
 * Which district a stock kind belongs to. Four kinds, four districts, one
 * match each -- unchanged from the pen-zoning pass, just no longer routed
 * through a plot index to get there:
 *
 *   hen               -- the Farmstead (home base -- the cheap starter tier)
 *   sprout, cash_crop  -- the Long Meadow ("Crop Fields")
 *   pig                -- the Wallow (labelled Sheep Pens)
 *   cattle             -- Ox Fields
 */
const STOCK_ZONE: Readonly<Record<StackAcresStock, ZoneId>> = {
  hen: "farmstead",
  sprout: "meadow",
  cash_crop: "meadow",
  pig: "wallow",
  cattle: "oxfields",
};

export function stockZone(stock: StackAcresStock): ZoneId {
  return STOCK_ZONE[stock];
}

/** Whether this stock may be bought/stocked while standing in this district
 *  -- checked before a Bushel or a piece of Gold moves. */
export function stockAllowedInZone(zone: ZoneId, stock: StackAcresStock): boolean {
  return STOCK_ZONE[stock] === zone;
}

/** Every stock kind sold/kept in this district -- the complement of
 *  `stockZone`, and the whole answer to "what does the sidebar's buy section
 *  show here". Replaces market.ts's old, since-drifted `STACKACRES_STALLS`
 *  (it predated the pen-zoning pass and had cattle at the Long Meadow and
 *  crops at Ox Fields -- the opposite of where the pens actually stand);
 *  `stockZone` is the one true mapping now, and this is just its reverse. */
export function stocksInZone(zone: ZoneId): StackAcresStock[] {
  return STACKACRES_STOCK.filter((stock) => STOCK_ZONE[stock] === zone);
}

/**
 * Top-left corner of each district's grow area, in world units -- where its
 * units stand and wander. Hand-placed to clear what is already standing in
 * each district (the barn, the pond, the roads, the districts' own scenery);
 * these are the exact boxes the pen-zoning pass placed its four 2x2 plot
 * blocks in, kept as literals rather than re-derived, since re-fitting them
 * against everything else already screenshotted correctly there.
 *
 * Restated as literals in ./zones.ts for the same reason `FARM_ZONE` is --
 * zones.ts imports this module as a value, so the reverse would read a
 * constant before this module finishes evaluating. zones.test.ts holds the
 * two to each other.
 */
const GROW_AREA: Readonly<Record<ZoneId, WorldRect>> = {
  farmstead: { x: 170, y: 200, width: 160, height: 160 },
  meadow: { x: 220, y: 560, width: 160, height: 160 },
  oxfields: { x: 680, y: 70, width: 160, height: 160 },
  wallow: { x: -320, y: -390, width: 160, height: 160 },
};

/**
 * The barn's own picture box, in the same feet-anchored convention
 * props.ts's `propRect` uses (x/y is the top-left corner, y extending
 * UP from the feet rather than down): x 71..145, feet on y 34, 62 tall --
 * lifted straight from `paintBarn`'s `BARN_X`/`BARN_Y` (`STACKACRES_MARGIN`
 * + 44 / - 30) and matched by props.test.ts's own `BARN_PIECES` fixture, not
 * re-derived, since both already agree with the shipped art.
 *
 * A flat ground-plane rect rather than the sprite's true picture silhouette
 * (the way `unitAt` in stackacres-scene.ts tests a unit's actual drawn art
 * in scene space): the barn never moves, so a fixed, slightly generous box
 * is worth the small imprecision it trades for staying a pure, testable
 * function that needs no renderer -- the same tradeoff `GROW_AREA`'s own
 * flat district boxes already make.
 */
export const BARN_FOOTPRINT: WorldRect = { x: 71, y: -28, width: 74, height: 62 };

/** Whether a tapped ground point (post `isoUnproject`, the same space
 *  `growAreaAt` and every `PropPlacement` live in) lands on the barn --
 *  StackAcres' entryway into Ray's Museum. */
export function barnHitAt(x: number, y: number): boolean {
  return (
    x >= BARN_FOOTPRINT.x &&
    x <= BARN_FOOTPRINT.x + BARN_FOOTPRINT.width &&
    y >= BARN_FOOTPRINT.y &&
    y <= BARN_FOOTPRINT.y + BARN_FOOTPRINT.height
  );
}

/**
 * Where the Midnight Merchant stands when a visit is live -- a fixed spot in
 * the yard, off to the barn's east side, clear of both the barn footprint
 * (x 71..145) and Grandfather Ray's own spot (props.ts's `{ x: 178, y: 20 }`,
 * whose 25.125-wide box spans roughly x 165..191). The Merchant is a
 * TEMPORARY visitor and has no `PropPlacement` entry in props.ts's
 * `YARD_PROPS` -- that array is for permanent scenery only, painted once at
 * boot; the scene's own `setMerchant` (stackacres-scene.ts) adds and removes
 * this one picture at runtime, the same reconciled-node mechanism `setUnits`
 * already uses for livestock, rather than the "paint every YARD_PROPS entry
 * once at create()" mechanism the barn and Ray use. See that method's own
 * header for why a temporary NPC needed a node it could destroy, not a
 * static array entry it never could.
 */
export const MIDNIGHT_MERCHANT_SPOT: WorldPoint = { x: 230, y: 20 };

/** Same box `PROP_SIZE.grandfatherRay` uses (25.125 wide, 40 tall) --
 *  restated here rather than imported from props.ts, since that module's
 *  `PROP_SIZE` is keyed by `PropKind` and the Merchant, being temporary, is
 *  deliberately not a member of that closed set (see the doc comment
 *  above). */
const MIDNIGHT_MERCHANT_FOOTPRINT: WorldRect = {
  x: MIDNIGHT_MERCHANT_SPOT.x - 25.125 / 2,
  y: MIDNIGHT_MERCHANT_SPOT.y - 40,
  width: 25.125,
  height: 40,
};

/** Whether a tapped ground point lands on the Midnight Merchant's spot.
 *  Checked by the scene ONLY while a visit is actually live (see
 *  `StackAcresScene`'s pointer-up handler) -- when no visit is on, this
 *  function is simply never called, rather than being called and refused,
 *  so a tap on empty ground where the Merchant sometimes stands falls
 *  through to `growAreaAt` exactly as it would if this feature did not
 *  exist. */
export function midnightMerchantHitAt(x: number, y: number): boolean {
  return (
    x >= MIDNIGHT_MERCHANT_FOOTPRINT.x &&
    x <= MIDNIGHT_MERCHANT_FOOTPRINT.x + MIDNIGHT_MERCHANT_FOOTPRINT.width &&
    y >= MIDNIGHT_MERCHANT_FOOTPRINT.y &&
    y <= MIDNIGHT_MERCHANT_FOOTPRINT.y + MIDNIGHT_MERCHANT_FOOTPRINT.height
  );
}

/** Where a district's units stand: the fenced boundary the scene draws once
 *  per district, and the box every one of that district's animals wanders
 *  inside (crops sit at a fixed spot within the same box). */
export function growAreaBounds(zone: ZoneId): WorldRect {
  return GROW_AREA[zone];
}

/** The walkable interior, inset from the fence/rail the scene draws around
 *  `growAreaBounds`. Narrower than a naive "inset the whole area" because the
 *  vector fence and trough take real room at the box's own edge. */
export function growAreaInterior(zone: ZoneId): WorldRect {
  const area = GROW_AREA[zone];
  return { x: area.x + 12, y: area.y + 30, width: area.width - 24, height: area.height - 42 };
}

/**
 * Which district's grow area a world point falls in, or null anywhere else.
 *
 * Narrower than ./zones.ts's `zoneAt` on purpose, and that difference is the
 * whole point: `zoneAt` answers "which district am I standing in", a generous
 * box hundreds of units across, while this answers "am I on the fenced ground
 * where this district's stock actually stands". A tap on empty ground offers
 * to seed there (see the radial menu in stackacres-farm.tsx), and offering
 * that from halfway across the woods would put a Cattle Pen wherever the
 * finger happened to land.
 *
 * The four boxes do not overlap (world.test.ts holds that), so the first
 * match is the only match and no farmstead-last tie-break is needed here the
 * way `zoneAt` needs one.
 */
export function growAreaAt(x: number, y: number): ZoneId | null {
  for (const id of Object.keys(GROW_AREA) as ZoneId[]) {
    const area = GROW_AREA[id];
    if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
      return id;
    }
  }
  return null;
}

/** The bounding box of every district that currently has anything to show:
 *  the camera frame for "home", when there is no single owned plot list to
 *  fit any more. Kept for parity with the old `ownedBounds`/`openingZoom`
 *  pair, but the scene now opens on ./zones.ts's `zoneFrame("farmstead")`
 *  directly -- a fixed-size gate window, the same shot arriving there via
 *  the signpost gets -- rather than fitting a box of owned stock, since
 *  units have no fixed position to fit a box around. */

/**
 * The smallest power of two that is at least `n` (and at least 1). Baked art
 * is padded to this on each side because the renderer only builds mipmaps
 * for power-of-two textures; see `bakeTexture` in stackacres-art.ts.
 */
export function powerOfTwoCeil(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

/** How far in and out the camera may go. */
export const STACKACRES_ZOOM_MIN = 0.6;
export const STACKACRES_ZOOM_MAX = 5;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return STACKACRES_ZOOM_MIN;
  return Math.min(STACKACRES_ZOOM_MAX, Math.max(STACKACRES_ZOOM_MIN, zoom));
}

/**
 * Where to put the camera after a zoom so the world point that was under the
 * player's finger is still under it. Phaser's camera scales about the centre
 * of the view, so the scroll that keeps `world` under `screen` is the world
 * point, less the view's half-size, less the finger's offset from centre
 * divided by the new zoom.
 */
export function scrollToKeepUnderPointer(
  world: WorldPoint,
  screen: WorldPoint,
  viewWidth: number,
  viewHeight: number,
  zoom: number,
): WorldPoint {
  return {
    x: world.x - viewWidth / 2 - (screen.x - viewWidth / 2) / zoom,
    y: world.y - viewHeight / 2 - (screen.y - viewHeight / 2) / zoom,
  };
}

/* ------------------------------------------------------------------ */
/* Animals                                                             */
/* ------------------------------------------------------------------ */

/** Walking speed in units per second. A hen scurries, a cow does not. */
export function critterSpeed(stock: StackAcresStock | null): number {
  switch (stock) {
    case "hen":
      return 14;
    case "pig":
      return 9;
    case "cattle":
      return 7;
    default:
      return 0;
  }
}

export interface Critter {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  mode: "idle" | "walk";
  /** Milliseconds left standing about before the next wander. */
  waitMs: number;
  /**
   * Which way along the SCREEN's x axis this animal is heading: 1 right, -1
   * left. Screen rather than world because that is the only axis a mirrored
   * sprite can express, and the two are not the same thing here -- the iso
   * projection puts screen x at (world x - world y), so an animal walking
   * due +y is walking to the LEFT of the picture however its world x reads.
   * Which way the art itself faces before being mirrored is the scene's
   * business, not this module's; see `ART_FACES` there.
   */
  facing: 1 | -1;
}

/** A source of numbers in [0, 1). Injected so a test can make it boring. */
export type Random = () => number;

const IDLE_MIN_MS = 900;
const IDLE_MAX_MS = 3_600;
const ARRIVE_WITHIN = 0.75;

function pointWithin(bounds: WorldRect, random: Random): WorldPoint {
  return {
    x: bounds.x + random() * bounds.width,
    y: bounds.y + random() * bounds.height,
  };
}

/**
 * Which way a walk from here to there reads on screen. A step that is equal
 * parts +x and +y goes straight up the picture and is not a turn either way,
 * so a tie keeps the facing the animal already had rather than flipping it to
 * some default every time it happens to pick a target on the diagonal.
 */
function headingTo(dx: number, dy: number, current: 1 | -1): 1 | -1 {
  const along = dx - dy;
  if (along === 0) return current;
  return along > 0 ? 1 : -1;
}

export function spawnCritter(bounds: WorldRect, random: Random): Critter {
  const at = pointWithin(bounds, random);
  return {
    x: at.x,
    y: at.y,
    targetX: at.x,
    targetY: at.y,
    mode: "idle",
    waitMs: IDLE_MIN_MS + random() * (IDLE_MAX_MS - IDLE_MIN_MS),
    facing: random() < 0.5 ? 1 : -1,
  };
}

/**
 * One tick of an animal's day: stand about, pick somewhere in the pen, walk
 * there, stand about again. Position is clamped to the pen every step, so a
 * pen that shrinks under an animal (it cannot, but) or a rounding wobble can
 * never put one through the fence.
 */
export function stepCritter(
  critter: Critter,
  bounds: WorldRect,
  speed: number,
  dtMs: number,
  random: Random,
): Critter {
  const dt = Math.max(0, Math.min(dtMs, 250)) / 1000;
  let next: Critter = { ...critter };

  if (next.mode === "idle") {
    next.waitMs -= dt * 1000;
    if (next.waitMs <= 0) {
      const target = pointWithin(bounds, random);
      next = {
        ...next,
        mode: "walk",
        targetX: target.x,
        targetY: target.y,
        facing: headingTo(target.x - next.x, target.y - next.y, next.facing),
      };
    }
  } else {
    const dx = next.targetX - next.x;
    const dy = next.targetY - next.y;
    const distance = Math.hypot(dx, dy);
    const stride = speed * dt;
    if (distance <= Math.max(stride, ARRIVE_WITHIN)) {
      next = {
        ...next,
        x: next.targetX,
        y: next.targetY,
        mode: "idle",
        waitMs: IDLE_MIN_MS + random() * (IDLE_MAX_MS - IDLE_MIN_MS),
      };
    } else {
      next = { ...next, x: next.x + (dx / distance) * stride, y: next.y + (dy / distance) * stride };
    }
  }

  next.x = Math.min(bounds.x + bounds.width, Math.max(bounds.x, next.x));
  next.y = Math.min(bounds.y + bounds.height, Math.max(bounds.y, next.y));
  return next;
}

/**
 * A deterministic random source, so a unit's spot -- or a patch of open
 * world -- is the same every time it is drawn. Mulberry32: tiny, good enough
 * for placing bushes and standing crops, and the same function every other
 * seeded thing in this codebase reaches for.
 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable hash of a unit's own id, for seeding its fixed spot (a crop) or
 * its initial wander state (an animal, before `stepCritter` takes over) --
 * the same unit renders in the same place every time it is drawn, without
 * the server needing to store a position at all.
 */
export function seedFromId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A crop's fixed spot within its district's grow area -- it does not
 *  wander, so all it needs is one stable point. */
export function cropSpot(zone: ZoneId, unitId: string): WorldPoint {
  return pointWithin(growAreaInterior(zone), seededRandom(seedFromId(unitId)));
}

/**
 * The wheat field: the strip east of the Hen Coop, under the scarecrow.
 *
 * ITS OWN GROUND, DELIBERATELY OUTSIDE EVERY `GROW_AREA`. A wheat plot is
 * not a `homestead_units` row and must never be reachable from the harvest
 * sweep that pays Gold for one -- see ./machine-items.ts's header for why
 * that separation is the whole reason wheat got its own table. Drawing it
 * inside the Farmstead's fence would be the first step toward someone
 * reasonably assuming the sweep covers it.
 *
 * Hand-placed, and the constraints are the ones a future move has to keep:
 * clear of the Farmstead's grow area (170..330, so this starts at 348),
 * inside `FARM_ZONE` (x 28..440, y -60..410, so this ends at 432), south of
 * the scarecrow at (402, 110) which now reads as guarding it, and clear of
 * the windmill at (330, 28). world.test.ts holds all four.
 */
export const WHEAT_FIELD: WorldRect = { x: 348, y: 140, width: 84, height: 180 };

/**
 * Where one wheat plot stands. Hashed off the plot's own row id, exactly the
 * way `cropSpot` hashes off a unit's -- NOT off its position in the list.
 * Plots are collected out from under each other (`workStackAcres` settles
 * every ripe one in a single pass), so an ordinal spot would slide every
 * surviving plot sideways the moment an earlier one was cashed.
 */
export function wheatPlotSpot(plotId: string): WorldPoint {
  return pointWithin(WHEAT_FIELD, seededRandom(seedFromId(plotId)));
}

/* ------------------------------------------------------------------ */
/* Scenery                                                             */
/* ------------------------------------------------------------------ */

/** How wide the open world's procedural-scenery chunks are, in world units. */
export const STACKACRES_CHUNK = 160;

/** How far past the union of every district's own bounds the hard camera
 *  boundary sits (./bounds.ts), in world units -- about one and a half
 *  scenery chunks, so a ring or two of the woodland `chunkScenery` already
 *  thins into still stands between the outermost district and the wall,
 *  rather than the districts' own fences butting straight up against it. */
export const WORLD_BOUND_MARGIN = STACKACRES_CHUNK * 1.5;

/**
 * The rectangle kept clear of wild scenery: x 28..440, y -60..410. The Hen
 * Coop block (170..330, 200..360), the barn yard north of it (barn feet on
 * y 34, roof to -28, a stone wall at -50..-40), the pond, the lane down the
 * west verge with its lamps at x 40, and the mailbox at the lane's end
 * (y 402) -- with air around all of it, so a tree can never grow on the roof
 * or lean its canopy over the lane.
 *
 * Still has to equal `STACKACRES_ZONES.farmstead.bounds` in ./zones.ts
 * exactly -- zones.test.ts holds the two to each other.
 */
export const FARM_ZONE: WorldRect = { x: 28, y: -60, width: 412, height: 470 };

export function inFarmZone(x: number, y: number): boolean {
  return (
    x >= FARM_ZONE.x &&
    x <= FARM_ZONE.x + FARM_ZONE.width &&
    y >= FARM_ZONE.y &&
    y <= FARM_ZONE.y + FARM_ZONE.height
  );
}

/** Everything the vector art can paint out in the open world. Not every
 *  painter name -- crops, animals, buildings and icons are placed by the
 *  scene itself from the game state, not scattered as scenery. */
export type SceneryKind =
  | "tree1"
  | "tree2"
  | "tree3"
  | "pine"
  | "bush"
  | "rock"
  | "tuft"
  | "flower1"
  | "flower2"
  | "flower3"
  | "log"
  | "mushroom"
  | "boulder";

export interface SceneryItem {
  kind: SceneryKind;
  /** World units, absolute. */
  x: number;
  y: number;
  /** Size against the painter's own drawn size. Trees are grown at their own
   *  height rather than all at one, so a stand has a skyline; the scene
   *  applies this to the sprite AND to its ground shadow, or a big tree sits
   *  on a small pool. Ground decoration is always 1. */
  scale: number;
}

// What grows inside a wood, by role. Broadleaf and conifer are kept apart so a
// stand can be one or the other rather than a salad of both -- a real wood is
// mostly one species at a time, and mixing them evenly is a large part of what
// made the old scatter read as decoration rather than as forest.
const BROADLEAF_KINDS: readonly SceneryKind[] = ["tree1", "tree2", "tree3"];
const CONIFER_KINDS: readonly SceneryKind[] = ["pine", "pine", "pine", "tree3"];
// The woodland floor's own litter -- a fallen log, a clutch of mushrooms, a
// boulder -- is in the pool once each and drawn rarely, so a wood grows one of
// them now and then rather than a forest of them.
const FOREST_FLOOR_KINDS: readonly SceneryKind[] = ["rock", "log", "mushroom", "boulder"];
const GROUND_KINDS: readonly SceneryKind[] = ["flower1", "flower2", "flower3"];

/**
 * One chunk of the open world's scenery, deterministic by chunk coordinate
 * so the same chunk regrows the same trees every time the camera returns to
 * it. Anything `blocked` refuses -- the farm zone, a path, the pond's
 * clearing, or one of ./zones.ts's districts -- is dropped rather than
 * shifted, so the farm's own edge stays exactly where it is, the road out
 * stays a road, no tree stands in the water, and the districts keep the
 * ground they paint for themselves.
 */
function blocked(x: number, y: number): boolean {
  return inFarmZone(x, y) || nearPath(x, y) || inPondZone(x, y) || inOuterZone(x, y);
}

/** Keeps a jittered planting point inside its own chunk. Every piece of
 *  scenery belongs to exactly one chunk and is grown and pruned with it, so a
 *  point that wandered over the line would be drawn twice where two chunks
 *  overlap and vanish when only one of them is loaded. */
function clampToChunk(v: number, lo: number): number {
  return Math.min(Math.max(v, lo), lo + STACKACRES_CHUNK - 0.01);
}

/* ---- the forest field ------------------------------------------------ */
//
// Where the woods are is decided in WORLD space, not per chunk, and that is
// the whole point of this pass. Two earlier versions grew trees from each
// chunk's own seeded RNG -- first as independent uniform points (confetti),
// then as per-chunk groves and treelines (clumps, but still clumps, and every
// one of them stopped at its own chunk). Neither could ever produce what a
// wood actually looks like from the air: open grass for a long way, then an
// edge, then forest running unbroken for as far as you can see. A field
// sampled in world units has no chunk boundary in it at all, so a stand runs
// across as many chunks as it likes and the seams are invisible.

const FOREST_SEED = 0x5f3a91;
const CORRIDOR_SEED = 0x2c7d11;
const STAND_SEED = 0x71b5c3;

/** Deterministic hash of a lattice point, to [0, 1). */
function latticeNoise(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in world units: hashed lattice, smoothstepped across
 *  each cell so the field has no grid in it. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = latticeNoise(gx, gy, seed);
  const n10 = latticeNoise(gx + 1, gy, seed);
  const n01 = latticeNoise(gx, gy + 1, seed);
  const n11 = latticeNoise(gx + 1, gy + 1, seed);
  const top = n00 + (n10 - n00) * sx;
  const bottom = n01 + (n11 - n01) * sx;
  return top + (bottom - top) * sy;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * How much wood stands at a world point: 0 is open grass, 1 is deep forest,
 * and the band between is the forest's own edge, where trees thin out instead
 * of stopping on a line.
 *
 * Three things are layered here:
 *
 * 1. WHERE THE WOOD IS. A broad, slow field (cells hundreds of units across,
 *    so one stand spans several chunks) roughened by a finer one, thresholded
 *    into a mass. Everything under the threshold is grass, and there is a lot
 *    of it -- that is deliberate, "a ton of grass and then miles of forest"
 *    rather than trees sprinkled evenly everywhere.
 * 2. ROOM AROUND THE FARM. The threshold is highest near the farm and falls
 *    with distance, so the home districts keep their air and the deep world
 *    closes in. Interpolated rather than stepped, so there is no ring.
 * 3. THE GAPS. Two families of winding lanes are cut back out of the mass,
 *    where a second and third field cross their own mid-line. They run for
 *    hundreds of units, they cross each other, and they are what stops a wood
 *    being one solid blob -- you walk into the trees and find ways through.
 */
export function forestDensityAt(x: number, y: number): number {
  const broad = valueNoise(x, y, 520, FOREST_SEED);
  const detail = valueNoise(x, y, 170, FOREST_SEED + 1);
  const field = broad * 0.74 + detail * 0.26;

  const farmCenterX = FARM_ZONE.x + FARM_ZONE.width / 2;
  const farmCenterY = FARM_ZONE.y + FARM_ZONE.height / 2;
  const dist = Math.hypot(x - farmCenterX, y - farmCenterY);
  const threshold = 0.6 - 0.19 * clamp01((dist - 340) / 900);

  // A soft edge rather than a hard one: over this much field above the
  // threshold the wood goes from its first outlying trees to full density.
  const mass = clamp01((field - threshold) / 0.1);
  if (mass <= 0) return 0;

  // Lanes. `off` is how far this point sits from a lane's centre line; inside
  // `half` it is open ground, and it feathers back to full wood over `soft`.
  const lane = (cell: number, seed: number, half: number, soft: number): number => {
    const off = Math.abs(valueNoise(x, y, cell, seed) - 0.5);
    return clamp01((off - half) / soft);
  };
  const gaps = Math.min(
    lane(430, CORRIDOR_SEED, 0.028, 0.03),
    lane(310, CORRIDOR_SEED + 1, 0.022, 0.026),
  );

  return mass * gaps;
}

/** Whether the conifers or the broadleaves have this ground. Its own slow
 *  field, so a pine stand is a place on the map rather than a per-tree coin
 *  flip. */
function coniferStand(x: number, y: number): boolean {
  return valueNoise(x, y, 380, STAND_SEED) > 0.52;
}

/** How far apart the forest's planting points sit, in world units. Close
 *  enough that canopies overlap at full density -- a tree is about 64 units
 *  wide -- which is what makes a stand read as one canopy rather than as
 *  separate trees standing near each other.
 *
 *  Grown with the trees (34 -> 44), but deliberately by LESS than they grew:
 *  the trees went up about 1.5x and this went up 1.3x, so the canopy closes
 *  up rather than merely keeping pace. Fewer planting points per chunk (4x4
 *  rather than 5x5) but far more cover, since each tree covers better than
 *  twice the ground it used to. */
const FOREST_SPACING = 44;

export function chunkScenery(cx: number, cy: number): SceneryItem[] {
  const random = seededRandom((cx * 73856093) ^ (cy * 19349663) ^ 0x5bd1e995);
  const x0 = cx * STACKACRES_CHUNK;
  const y0 = cy * STACKACRES_CHUNK;
  const items: SceneryItem[] = [];

  // A jittered lattice rather than random points: at forest density, uniform
  // random points clump and leave holes, and a wood wants its trees spread
  // about evenly with the gaps coming from the FIELD, not from the sampling.
  const steps = Math.ceil(STACKACRES_CHUNK / FOREST_SPACING);
  for (let gy = 0; gy < steps; gy += 1) {
    for (let gx = 0; gx < steps; gx += 1) {
      const x = clampToChunk(
        x0 + (gx + 0.5) * FOREST_SPACING + (random() - 0.5) * FOREST_SPACING * 0.85,
        x0,
      );
      const y = clampToChunk(
        y0 + (gy + 0.5) * FOREST_SPACING + (random() - 0.5) * FOREST_SPACING * 0.85,
        y0,
      );
      const density = forestDensityAt(x, y);
      // Thinning by density is what feathers a forest edge: deep in, every
      // point takes; out at the margin, most do not.
      if (density <= 0 || random() > density) continue;
      if (blocked(x, y)) continue;

      const roll = random();
      let kind: SceneryKind;
      if (roll < 0.05) {
        kind = FOREST_FLOOR_KINDS[Math.floor(random() * FOREST_FLOOR_KINDS.length)];
      } else if (roll < 0.16) {
        kind = "bush";
      } else if (coniferStand(x, y)) {
        kind = CONIFER_KINDS[Math.floor(random() * CONIFER_KINDS.length)];
      } else {
        kind = BROADLEAF_KINDS[Math.floor(random() * BROADLEAF_KINDS.length)];
      }
      // Every tree its own height. A stand of one size reads as wallpaper --
      // the range is wide enough (0.78x to 1.36x) to give a canopy a skyline.
      // Litter on the floor stays near its drawn size; a 1.4x mushroom is a
      // different object, not a bigger one.
      const litter = kind === "rock" || kind === "log" || kind === "mushroom" || kind === "boulder";
      const scale = litter ? 0.9 + random() * 0.3 : 0.78 + random() * 0.58;
      items.push({ kind, x, y, scale });
    }
  }

  // The open ground is not bare, just sparse: the odd lone bush or boulder
  // out in the grass, well away from the wood's own edge.
  for (let i = 0; i < 3; i += 1) {
    const x = x0 + random() * STACKACRES_CHUNK;
    const y = y0 + random() * STACKACRES_CHUNK;
    if (forestDensityAt(x, y) > 0.15 || random() < 0.55 || blocked(x, y)) continue;
    const kind = random() < 0.5 ? "bush" : FOREST_FLOOR_KINDS[Math.floor(random() * FOREST_FLOOR_KINDS.length)];
    items.push({ kind, x, y, scale: 0.85 + random() * 0.35 });
  }

  for (let i = 0; i < 10; i += 1) {
    const x = x0 + random() * STACKACRES_CHUNK;
    const y = y0 + random() * STACKACRES_CHUNK;
    if (blocked(x, y)) continue;
    const kind: SceneryKind =
      random() < 0.55 ? "tuft" : GROUND_KINDS[Math.floor(random() * GROUND_KINDS.length)];
    items.push({ kind, x, y, scale: 1 });
  }
  return items.sort((a, b) => a.y - b.y);
}

/** Where a growing unit sits in its three-frame life, by elapsed fraction. */
export function growthStage(progress: number | null, ready: boolean): 0 | 1 | 2 {
  if (ready) return 2;
  if (progress === null) return 0;
  // Two thirds of the cycle is spent as a visibly half-grown plant. A crop
  // that looks finished long before it is finished trains people to tap a
  // unit that cannot pay yet.
  return progress < 0.34 ? 0 : 1;
}
