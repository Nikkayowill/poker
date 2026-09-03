/**
 * The StackAcres as a place rather than a grid: where every plot sits in the
 * world, how the animals wander inside their pens, and what grows wild
 * outside the fence line.
 *
 * Everything here is pure and unit-based so it can be tested without a
 * renderer. One unit is one device pixel of the vector art at zoom 1; the
 * scene scales the whole thing with its camera and never with the sprites.
 *
 * The plot index is still the identity a plot has on the server. Nothing in
 * this file changes what a plot IS -- only where it is drawn. The 16-plot
 * ladder, the in-order unlock and every economic rule stay exactly where
 * they were in ./catalogue.ts and ./plots.ts; this module only answers
 * "which plot did the player just tap at these world coordinates", "where do
 * the hens walk" and "what does the open world look like out past the
 * fence".
 *
 * THE PLOTS ARE NOT ONE GRID ANY MORE. Kayo: "the zoning was meant to make
 * the user have to visit each section we made" -- the four districts
 * ./zones.ts already built (the Farmstead, the Long Meadow, Ox Fields, the
 * Wallow) are where the pens physically live now, one kind of pen per
 * district, four plots each. A Hen Coop plot is drawn at the Farmstead, a
 * Cattle Pen plot at Ox Fields, and so on -- see `PEN_GROUP_ORIGIN`. Tending
 * a Cattle Pen means travelling to Ox Fields, the way it would on a real
 * farm; there is no longer one grid where every animal stands side by side.
 *
 * The camera is unbounded: the player can roam past the farm in any
 * direction into procedurally-grown scenery (see `chunkScenery`).
 */

import {
  STACKACRES_CROPS,
  STACKACRES_GRID_PLOTS,
  type StackAcresStock,
} from "./catalogue";
// paths.ts imports only TYPES back from this module, so the cycle is
// harmless; a value import there would be read before this file finished
// evaluating and throw.
import { nearPath } from "./paths";
import type { StackAcresPlotSnapshot } from "./plots";
// Same arrangement as ./paths: water.ts imports only types from here.
import { inPondZone } from "./water";
// And again for ./zones, which grows the districts' own scenery in the same
// chunks the woodland uses and so has to be able to say "not here".
import { inOuterZone } from "./zones";

/** One art unit, in device pixels of the baked vector art at zoom 1. */
export const STACKACRES_TILE = 16;

/** A plot is a square of this many tiles a side: room for a fence and a pen. */
export const STACKACRES_CELL_TILES = 5;

/** A plot's edge, in world units. */
export const STACKACRES_CELL = STACKACRES_TILE * STACKACRES_CELL_TILES;

/** Offset of a district's own yard elements from the world origin, so
 *  nothing sits flush at (0, 0). Barn, silo, paths and props are all
 *  hand-placed relative to this -- it is a fixed reference point for the
 *  Farmstead's yard, not a plot-grid margin any more. */
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
/* Pen zones -- which district a plot lives in                        */
/* ------------------------------------------------------------------ */

/**
 * Which kind of stock a plot is fenced for, and which district it physically
 * stands in. Four kinds, four districts, one match each:
 *
 *   hen    -- the Farmstead (home base -- the cheap starter tier, no travel)
 *   field  -- the Long Meadow ("Crop Fields")
 *   pig    -- the Wallow (its wild hogs retired for real, ownable Sheep Pens)
 *   cattle -- Ox Fields (its wild oxen retired for real, ownable Cattle Pens)
 *
 * Kayo: "the zoning was meant to make the user have to visit each section
 * we made" -- not fence four kinds of stock into four rows of one grid (an
 * earlier pass here did exactly that, and it was the wrong fix), but stand
 * each kind's pens in the district that already has that animal's theming.
 * The 16-plot ladder is four blocks of four, one block per kind, in the
 * order this array lists them -- plots 1-4 are the free Hen Coops, 5-8 are
 * Crop Fields, 9-12 are Sheep Pens, 13-16 are Cattle Pens.
 */
export const STACKACRES_PEN_ZONES = ["hen", "field", "pig", "cattle"] as const;

export type StackAcresPenZone = (typeof STACKACRES_PEN_ZONES)[number];

const PEN_ZONE_LABEL: Readonly<Record<StackAcresPenZone, string>> = {
  hen: "the Hen Coops",
  field: "the Crop Fields",
  pig: "the Sheep Pens",
  cattle: "the Cattle Pens",
};

/** What each zone will let you plant or stock, whichever route pays for it. */
const PEN_ZONE_STOCK: Readonly<Record<StackAcresPenZone, readonly StackAcresStock[]>> = {
  hen: ["hen"],
  field: STACKACRES_CROPS,
  pig: ["pig"],
  cattle: ["cattle"],
};

/** How many plots stand in one kind's block, and how they are arranged --
 *  a small 2x2, not a long row, so a block reads as one fenced pen area
 *  rather than a strip. */
export const PEN_GROUP_COLUMNS = 2;
export const PEN_GROUP_ROWS = 2;
const PEN_GROUP_SIZE = PEN_GROUP_COLUMNS * PEN_GROUP_ROWS;

/**
 * Top-left corner of each kind's 2x2 block, in world units, inside the
 * district that kind now lives in (./zones.ts). Hand-placed to clear what is
 * already standing in each district -- restated as literals in ./zones.ts
 * for the two districts whose wild-herd scatter has to avoid the same box
 * (a value import back from here would read before this module finishes
 * evaluating, the same reason ./paths.ts and ./water.ts only take types).
 *
 *   hen    -- south-east of the pond, clear of the barn and the yard clutter
 *   field  -- the Long Meadow's open grass, east of the lane on its west edge
 *   cattle -- Ox Fields, roughly where the wild ox herd used to range
 *   pig    -- the Wallow, roughly where the wild hogs used to range
 *
 * Exact fit against each district's own props/scatter is a build-and-
 * screenshot job, not an arithmetic one -- see the district passes in
 * CLAUDE.md for the standing precedent.
 */
const PEN_GROUP_ORIGIN: Readonly<Record<StackAcresPenZone, WorldPoint>> = {
  hen: { x: 170, y: 200 },
  field: { x: 220, y: 560 },
  cattle: { x: 680, y: 70 },
  pig: { x: -320, y: -390 },
};

function plotLocal(plotIndex: number): { col: number; row: number } {
  const slot = (plotIndex - 1) % PEN_GROUP_SIZE;
  return { col: slot % PEN_GROUP_COLUMNS, row: Math.floor(slot / PEN_GROUP_COLUMNS) };
}

/** Which zone this plot belongs to. Every plot falls in exactly one block of
 *  four, and every block is exactly one zone -- there is no plot this can
 *  fail to name. */
export function plotPenZone(plotIndex: number): StackAcresPenZone {
  const group = Math.floor((plotIndex - 1) / PEN_GROUP_SIZE);
  return STACKACRES_PEN_ZONES[Math.min(group, STACKACRES_PEN_ZONES.length - 1)];
}

/** What the player calls a zone, for a refusal message that names the place
 *  the stock actually belongs rather than just saying no. */
export function penZoneLabel(zone: StackAcresPenZone): string {
  return PEN_ZONE_LABEL[zone];
}

/** Whether this stock is allowed to stand on this plot at all -- checked
 *  before a Bushel or a piece of Gold moves, on both the planting and the
 *  outright-buy routes. */
export function stockAllowedOnPlot(plotIndex: number, stock: StackAcresStock): boolean {
  return PEN_ZONE_STOCK[plotPenZone(plotIndex)].includes(stock);
}

/** The full district-relative rect a kind's 2x2 block covers. What the
 *  scene's district ground/scatter exclusions and this module's own hit
 *  test both measure against. */
export function penGroupBounds(zone: StackAcresPenZone): WorldRect {
  const origin = PEN_GROUP_ORIGIN[zone];
  return {
    x: origin.x,
    y: origin.y,
    width: PEN_GROUP_COLUMNS * STACKACRES_CELL,
    height: PEN_GROUP_ROWS * STACKACRES_CELL,
  };
}

/** Top-left corner of a plot's own square, inside its kind's block. */
export function cellOrigin(plotIndex: number): WorldPoint {
  const zone = plotPenZone(plotIndex);
  const origin = PEN_GROUP_ORIGIN[zone];
  const { col, row } = plotLocal(plotIndex);
  return { x: origin.x + col * STACKACRES_CELL, y: origin.y + row * STACKACRES_CELL };
}

export function cellRect(plotIndex: number): WorldRect {
  const origin = cellOrigin(plotIndex);
  return { x: origin.x, y: origin.y, width: STACKACRES_CELL, height: STACKACRES_CELL };
}

export function cellCenter(plotIndex: number): WorldPoint {
  const origin = cellOrigin(plotIndex);
  return { x: origin.x + STACKACRES_CELL / 2, y: origin.y + STACKACRES_CELL / 2 };
}

/**
 * Which plot a world point lands on, or null off every block. The tap that
 * decides what the player meant: checks each kind's 2x2 block in turn (the
 * four blocks never overlap, since they sit in four different districts),
 * and inside the one it lands in, a point on a plot's right edge belongs to
 * the next plot over, the last pixel of the last plot is still that plot --
 * the same edge rule the old single grid held, just per block now.
 */
export function plotIndexAt(x: number, y: number): number | null {
  for (let group = 0; group < STACKACRES_PEN_ZONES.length; group += 1) {
    const origin = PEN_GROUP_ORIGIN[STACKACRES_PEN_ZONES[group]];
    const col = Math.floor((x - origin.x) / STACKACRES_CELL);
    const row = Math.floor((y - origin.y) / STACKACRES_CELL);
    if (col < 0 || col >= PEN_GROUP_COLUMNS || row < 0 || row >= PEN_GROUP_ROWS) continue;
    const index = group * PEN_GROUP_SIZE + row * PEN_GROUP_COLUMNS + col + 1;
    return index <= STACKACRES_GRID_PLOTS ? index : null;
  }
  return null;
}

/**
 * The plot at this offset from `plotIndex`, within the SAME 2x2 block, or
 * null off its edge. What the fence-merge check needs: two owned plots share
 * a rail only when they are actual neighbours inside one kind's block, never
 * across two different kinds (a Hen Coop and a Cattle Pen are never in the
 * same block, so this can never merge them even by a numbering accident).
 */
export function plotNeighbor(plotIndex: number, deltaCol: number, deltaRow: number): number | null {
  const zone = plotPenZone(plotIndex);
  const { col, row } = plotLocal(plotIndex);
  const nCol = col + deltaCol;
  const nRow = row + deltaRow;
  if (nCol < 0 || nCol >= PEN_GROUP_COLUMNS || nRow < 0 || nRow >= PEN_GROUP_ROWS) return null;
  const group = STACKACRES_PEN_ZONES.indexOf(zone);
  return group * PEN_GROUP_SIZE + nRow * PEN_GROUP_COLUMNS + nCol + 1;
}

/** Plots the player can see as theirs: everything owned, plus the one for sale. */
export function isAcreage(plot: Pick<StackAcresPlotSnapshot, "state" | "purchasable">): boolean {
  return plot.state !== "locked" || plot.purchasable;
}

/**
 * The bounding box of a set of plots: everything owned among them, plus the
 * one for sale, with no padding. A farm with nothing on it yet is still a
 * place: it frames the plot list's own first entry.
 *
 * Pass ALL sixteen plots and this spans every district at once -- not useful
 * for framing a camera any more, now that a Hen Coop and a Cattle Pen can be
 * 800 units apart. Callers that want "home" or "this district" filter to
 * that district's own four plots first (`plotPenZone`), which is what makes
 * this still the right primitive: one small, pure box-fit, reused per place
 * rather than rewritten per place.
 */
export function ownedBounds(
  plots: readonly Pick<StackAcresPlotSnapshot, "plotIndex" | "state" | "purchasable">[],
): WorldRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const plot of plots) {
    if (!isAcreage(plot)) continue;
    const rect = cellRect(plot.plotIndex);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX)) {
    // Only reachable with an empty `plots` list -- `isAcreage` is true for
    // every real plot (a locked one is always `purchasable` now), so a
    // non-empty district-filtered list always has something to fit.
    const first = cellRect(plots[0]?.plotIndex ?? 1);
    return { x: first.x, y: first.y, width: first.width, height: first.height };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The smallest power of two that is at least `n` (and at least 1). Baked art
 * is padded to this on each side because the renderer only builds mipmaps
 * for power-of-two textures; see `bakeTexture` in stackacres-art.ts.
 */
export function powerOfTwoCeil(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

/** How far in and out the camera may go. Fixed now that the camera is
 *  unbounded -- there is no roamable area left to fit, only a floor so the
 *  art never shrinks to a smudge and a ceiling so it never fills the screen
 *  with one leaf. */
export const STACKACRES_ZOOM_MIN = 0.6;
export const STACKACRES_ZOOM_MAX = 5;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return STACKACRES_ZOOM_MIN;
  return Math.min(STACKACRES_ZOOM_MAX, Math.max(STACKACRES_ZOOM_MIN, zoom));
}

/**
 * The zoom the farm opens at: the owned plots filling the screen with a
 * little air around them. `STACKACRES_ZOOM_OPEN_MAX` stops a brand-new farm
 * (four plots) from opening so close that a single hen fills a phone.
 */
export const STACKACRES_ZOOM_OPEN_MAX = 3;

export function openingZoom(bounds: WorldRect, viewWidth: number, viewHeight: number): number {
  const paddedWidth = bounds.width + STACKACRES_CELL * 1.5;
  const paddedHeight = bounds.height + STACKACRES_CELL;
  const fit = Math.min(viewWidth / Math.max(1, paddedWidth), viewHeight / Math.max(1, paddedHeight));
  return clampZoom(Math.min(fit, STACKACRES_ZOOM_OPEN_MAX));
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

/** Where a pen's animals may walk: inside the fence, below the trough. The
 *  vector fence and trough take more of the cell than the old tile art did,
 *  so the walkable box is smaller than a naive "inset the whole cell". */
export function penInterior(plotIndex: number): WorldRect {
  const origin = cellOrigin(plotIndex);
  return {
    x: origin.x + 12,
    y: origin.y + 30,
    width: STACKACRES_CELL - 24,
    height: STACKACRES_CELL - 42,
  };
}

/** How many animals a working pen shows. Not the yield -- the picture. */
export function critterCount(stock: StackAcresStock | null): number {
  switch (stock) {
    case "hen":
      return 3;
    case "pig":
      return 2;
    case "cattle":
      return 2;
    default:
      return 0;
  }
}

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
  /** 1 faces the art's own way, -1 is mirrored. */
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
        facing: target.x >= next.x ? -1 : 1,
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

/* ------------------------------------------------------------------ */
/* Scenery                                                             */
/* ------------------------------------------------------------------ */

/**
 * A deterministic random source, so a plot's forest -- or a patch of open
 * world -- is the same forest every time it is drawn. Mulberry32: tiny, good
 * enough for placing bushes, and the same function every other seeded thing
 * in this codebase reaches for.
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

/** How wide the open world's procedural-scenery chunks are, in world units. */
export const STACKACRES_CHUNK = 160;

/**
 * The rectangle kept clear of wild scenery: x 28..440, y -60..410. The Hen
 * Coop block (170..330, 200..360), the barn yard north of it (barn feet on
 * y 34, roof to -28, a stone wall at -50..-40), the pond, the lane down the
 * west verge with its lamps at x 40, and the mailbox at the lane's end
 * (y 402) -- with air around all of it, so a tree can never grow on the roof
 * or lean its canopy over the lane.
 *
 * Fixed literals now, not derived from a plot-grid formula: this is the
 * Farmstead's own footprint (barn, pond, yard, four Hen Coops), which no
 * longer has anything to do with how big the whole 16-plot ladder is, since
 * the other twelve plots live in three other districts entirely. It still
 * has to equal `STACKACRES_ZONES.farmstead.bounds` in ./zones.ts exactly --
 * zones.test.ts holds the two to each other.
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

/** Everything the vector art can paint out in the open world or on a locked
 *  plot's thicket. Not every painter name -- crops, animals, buildings and
 *  icons are placed by the scene itself from the game state, not scattered
 *  as scenery. */
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
  /** World units. Chunk scenery is world-absolute; thicket/cleared scenery
   *  is cell-local (relative to the plot's own origin). */
  x: number;
  y: number;
}

// The woodland floor's own litter -- a fallen log, a clutch of mushrooms,
// a boulder -- is in the pool once each, so a chunk grows one of them now
// and then rather than a forest of them.
const CHUNK_WOOD_KINDS: readonly SceneryKind[] = [
  "tree1",
  "tree2",
  "tree3",
  "pine",
  "pine",
  "bush",
  "bush",
  "rock",
  "log",
  "mushroom",
  "boulder",
];
const GROUND_KINDS: readonly SceneryKind[] = ["flower1", "flower2", "flower3"];
const THICKET_WOOD_KINDS: readonly SceneryKind[] = ["tree1", "tree2", "tree3", "pine", "pine", "bush"];

/**
 * One chunk of the open world's scenery, deterministic by chunk coordinate
 * so the same chunk regrows the same trees every time the camera returns to
 * it. Denser near the farm (it reads as the woodland the farm was cut out
 * of) and thinner far out, where it exists only so the horizon is never
 * bare. Anything `blocked` refuses -- the farm zone, a path, the pond's
 * clearing, or one of ./zones.ts's districts -- is dropped rather than
 * shifted, so the farm's own edge stays exactly where the plot ladder ends,
 * the road out stays a road, no tree stands in the water, and the districts
 * keep the ground they paint for themselves.
 */
/**
 * Where the woodland may not grow. Four exclusions, and the districts are the
 * newest: a district paints its own ground and grows its own furniture (see
 * ./zones.ts), so a wild pine standing in the middle of a ploughed ox field
 * would be the woodland leaking into a place that exists to look unlike it.
 * The farmstead is excluded through `inFarmZone` rather than through
 * `inOuterZone`, which deliberately covers only the three outer districts --
 * the two rectangles are the same, and one of them predates the other.
 */
function blocked(x: number, y: number): boolean {
  return inFarmZone(x, y) || nearPath(x, y) || inPondZone(x, y) || inOuterZone(x, y);
}

export function chunkScenery(cx: number, cy: number): SceneryItem[] {
  const random = seededRandom((cx * 73856093) ^ (cy * 19349663) ^ 0x5bd1e995);
  const x0 = cx * STACKACRES_CHUNK;
  const y0 = cy * STACKACRES_CHUNK;
  const farmCenterX = FARM_ZONE.x + FARM_ZONE.width / 2;
  const farmCenterY = FARM_ZONE.y + FARM_ZONE.height / 2;
  const dist = Math.hypot(
    x0 + STACKACRES_CHUNK / 2 - farmCenterX,
    y0 + STACKACRES_CHUNK / 2 - farmCenterY,
  );
  const woods = dist < 420 ? 9 : dist < 900 ? 5 : 3;

  const items: SceneryItem[] = [];
  for (let i = 0; i < woods; i += 1) {
    const x = x0 + random() * STACKACRES_CHUNK;
    const y = y0 + random() * STACKACRES_CHUNK;
    if (blocked(x, y)) continue;
    items.push({ kind: CHUNK_WOOD_KINDS[Math.floor(random() * CHUNK_WOOD_KINDS.length)], x, y });
  }
  for (let i = 0; i < 10; i += 1) {
    const x = x0 + random() * STACKACRES_CHUNK;
    const y = y0 + random() * STACKACRES_CHUNK;
    if (blocked(x, y)) continue;
    const kind: SceneryKind =
      random() < 0.55 ? "tuft" : GROUND_KINDS[Math.floor(random() * GROUND_KINDS.length)];
    items.push({ kind, x, y });
  }
  return items.sort((a, b) => a.y - b.y);
}

/**
 * Unbroken land: a thicket that fills a locked plot, in cell-local units.
 * Dense for land that is not for sale yet, thinned out for the one plot that
 * is, so the plot the player can buy reads as a clearing waiting to happen
 * rather than the same wall of trees as everything beyond it.
 */
export function thicketLayout(plotIndex: number, forSale: boolean): SceneryItem[] {
  const random = seededRandom(plotIndex * 7919 + 13);
  const want = forSale ? 3 : 8;
  const items: SceneryItem[] = [];
  for (let i = 0; i < want; i += 1) {
    items.push({
      kind: THICKET_WOOD_KINDS[Math.floor(random() * THICKET_WOOD_KINDS.length)],
      x: 10 + random() * 60,
      y: 32 + random() * 44,
    });
  }
  for (let i = 0; i < 3; i += 1) {
    items.push({
      kind: random() < 0.5 ? "tuft" : "rock",
      x: 6 + random() * 68,
      y: 10 + random() * 66,
    });
  }
  return items.sort((a, b) => a.y - b.y);
}

/** Cleared land with nothing on it: mown grass and the odd tuft or flower,
 *  in cell-local units. */
export function clearedLayout(plotIndex: number): SceneryItem[] {
  const random = seededRandom(plotIndex * 104729 + 7);
  const out: SceneryItem[] = [];
  for (let i = 0; i < 3; i += 1) {
    out.push({
      kind: random() < 0.6 ? "tuft" : GROUND_KINDS[Math.floor(random() * GROUND_KINDS.length)],
      x: 8 + random() * 64,
      y: 8 + random() * 66,
    });
  }
  return out;
}

/** Where a growing plot sits in its three-frame life, by elapsed fraction. */
export function growthStage(progress: number | null, ready: boolean): 0 | 1 | 2 {
  if (ready) return 2;
  if (progress === null) return 0;
  // Two thirds of the cycle is spent as a visibly half-grown plant. A crop
  // that looks finished long before it is finished trains people to tap a
  // plot that cannot pay yet.
  return progress < 0.34 ? 0 : 1;
}
