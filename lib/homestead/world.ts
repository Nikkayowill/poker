/**
 * The Homestead as a place rather than a grid: where every plot sits in the
 * world, how the animals wander inside their pens, and what grows wild
 * outside the fence line.
 *
 * Everything here is pure and unit-based so it can be tested without a
 * renderer. One unit is one device pixel of the vector art at zoom 1; the
 * scene scales the whole thing with its camera and never with the sprites.
 *
 * The plot index is still the identity a plot has on the server. Nothing in
 * this file changes what a plot IS -- only where it is drawn. The 4x4 ladder,
 * the in-order unlock and every economic rule stay exactly where they were in
 * ./catalogue.ts and ./plots.ts; this module only answers "which plot did the
 * player just tap at these world coordinates", "where do the hens walk" and
 * "what does the open world look like out past the fence".
 *
 * The camera is unbounded: the player can roam past the farm in any
 * direction into procedurally-grown scenery (see `chunkScenery`). Land is
 * still bought in ladder order, so the cleared part of the map still grows
 * outward from the top-left corner as acreage is bought -- `ownedBounds` is
 * what the opening shot and "back to the farm" frame, not a camera fence.
 */

import { HOMESTEAD_GRID_PLOTS, type HomesteadStock } from "./catalogue";
import type { HomesteadPlotSnapshot } from "./plots";

/** One art unit, in device pixels of the baked vector art at zoom 1. */
export const HOMESTEAD_TILE = 16;

/** A plot is a square of this many tiles a side: room for a fence and a pen. */
export const HOMESTEAD_CELL_TILES = 5;

/** A plot's edge, in world units. */
export const HOMESTEAD_CELL = HOMESTEAD_TILE * HOMESTEAD_CELL_TILES;

/** Plots per row. The 16-plot ladder is a 4x4 square. */
export const HOMESTEAD_WORLD_COLUMNS = 4;
export const HOMESTEAD_WORLD_ROWS = Math.ceil(HOMESTEAD_GRID_PLOTS / HOMESTEAD_WORLD_COLUMNS);

/** Offset of plot 1 from the world origin, so nothing sits flush at (0, 0). */
export const HOMESTEAD_MARGIN_TILES = 4;
export const HOMESTEAD_MARGIN = HOMESTEAD_TILE * HOMESTEAD_MARGIN_TILES;

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

/** The plots' own footprint: the 4x4 ladder, nothing else. Kept for anything
 *  that still wants "how big is the farm itself" -- the open world has no
 *  edge, so this is not a camera bound. */
export function worldSize(): { width: number; height: number } {
  return {
    width: HOMESTEAD_MARGIN * 2 + HOMESTEAD_WORLD_COLUMNS * HOMESTEAD_CELL,
    height: HOMESTEAD_MARGIN * 2 + HOMESTEAD_WORLD_ROWS * HOMESTEAD_CELL,
  };
}

/** Top-left corner of a plot's square. Plot indexes are 1-based, row-major. */
export function cellOrigin(plotIndex: number): WorldPoint {
  const slot = plotIndex - 1;
  const col = slot % HOMESTEAD_WORLD_COLUMNS;
  const row = Math.floor(slot / HOMESTEAD_WORLD_COLUMNS);
  return {
    x: HOMESTEAD_MARGIN + col * HOMESTEAD_CELL,
    y: HOMESTEAD_MARGIN + row * HOMESTEAD_CELL,
  };
}

export function cellRect(plotIndex: number): WorldRect {
  const origin = cellOrigin(plotIndex);
  return { x: origin.x, y: origin.y, width: HOMESTEAD_CELL, height: HOMESTEAD_CELL };
}

export function cellCenter(plotIndex: number): WorldPoint {
  const origin = cellOrigin(plotIndex);
  return { x: origin.x + HOMESTEAD_CELL / 2, y: origin.y + HOMESTEAD_CELL / 2 };
}

/**
 * Which plot a world point lands on, or null off the ladder. The tap that
 * decides what the player meant, so it is the one function here that most
 * wants a test at its edges: a point on a plot's right edge belongs to the
 * next plot over, and the last pixel of the last plot is still that plot.
 */
export function plotIndexAt(x: number, y: number): number | null {
  const col = Math.floor((x - HOMESTEAD_MARGIN) / HOMESTEAD_CELL);
  const row = Math.floor((y - HOMESTEAD_MARGIN) / HOMESTEAD_CELL);
  if (col < 0 || col >= HOMESTEAD_WORLD_COLUMNS) return null;
  if (row < 0 || row >= HOMESTEAD_WORLD_ROWS) return null;
  const index = row * HOMESTEAD_WORLD_COLUMNS + col + 1;
  return index > HOMESTEAD_GRID_PLOTS ? null : index;
}

/** Plots the player can see as theirs: everything owned, plus the one for sale. */
export function isAcreage(plot: Pick<HomesteadPlotSnapshot, "state" | "purchasable">): boolean {
  return plot.state !== "locked" || plot.purchasable;
}

/**
 * The bounding box of the acreage: everything owned, plus the one plot for
 * sale, with no padding. Used only to frame the opening shot and "back to
 * the farm" -- the camera itself is unbounded, so this never fences a drag.
 * A farm with nothing on it yet is still a place: it frames the first cell.
 */
export function ownedBounds(
  plots: readonly Pick<HomesteadPlotSnapshot, "plotIndex" | "state" | "purchasable">[],
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
    const first = cellRect(1);
    return { x: first.x, y: first.y, width: first.width, height: first.height };
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Old name for `ownedBounds`, kept as an alias for anything not yet ported. */
export const acreageBounds = ownedBounds;

/** How far in and out the camera may go. Fixed now that the camera is
 *  unbounded -- there is no roamable area left to fit, only a floor so the
 *  art never shrinks to a smudge and a ceiling so it never fills the screen
 *  with one leaf. */
export const HOMESTEAD_ZOOM_MIN = 0.6;
export const HOMESTEAD_ZOOM_MAX = 5;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return HOMESTEAD_ZOOM_MIN;
  return Math.min(HOMESTEAD_ZOOM_MAX, Math.max(HOMESTEAD_ZOOM_MIN, zoom));
}

/**
 * The zoom the farm opens at: the owned plots filling the screen with a
 * little air around them. `HOMESTEAD_ZOOM_OPEN_MAX` stops a brand-new farm
 * (four plots) from opening so close that a single hen fills a phone.
 */
export const HOMESTEAD_ZOOM_OPEN_MAX = 3;

export function openingZoom(bounds: WorldRect, viewWidth: number, viewHeight: number): number {
  const paddedWidth = bounds.width + HOMESTEAD_CELL * 1.5;
  const paddedHeight = bounds.height + HOMESTEAD_CELL;
  const fit = Math.min(viewWidth / Math.max(1, paddedWidth), viewHeight / Math.max(1, paddedHeight));
  return clampZoom(Math.min(fit, HOMESTEAD_ZOOM_OPEN_MAX));
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
    width: HOMESTEAD_CELL - 24,
    height: HOMESTEAD_CELL - 42,
  };
}

/** How many animals a working pen shows. Not the yield -- the picture. */
export function critterCount(stock: HomesteadStock | null): number {
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
export function critterSpeed(stock: HomesteadStock | null): number {
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
export const HOMESTEAD_CHUNK = 160;

/** The rectangle kept clear of wild scenery: the plot ladder plus a little
 *  air, so a tree can never grow inside the farm or lean over its fence. */
export const FARM_ZONE: WorldRect = {
  x: HOMESTEAD_MARGIN - 24,
  y: -8,
  width: HOMESTEAD_WORLD_COLUMNS * HOMESTEAD_CELL + 48,
  height: HOMESTEAD_MARGIN + HOMESTEAD_WORLD_ROWS * HOMESTEAD_CELL + 24,
};

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
  | "flower3";

export interface SceneryItem {
  kind: SceneryKind;
  /** World units. Chunk scenery is world-absolute; thicket/cleared scenery
   *  is cell-local (relative to the plot's own origin). */
  x: number;
  y: number;
}

const CHUNK_WOOD_KINDS: readonly SceneryKind[] = [
  "tree1",
  "tree2",
  "tree3",
  "pine",
  "pine",
  "bush",
  "bush",
  "rock",
];
const GROUND_KINDS: readonly SceneryKind[] = ["flower1", "flower2", "flower3"];
const THICKET_WOOD_KINDS: readonly SceneryKind[] = ["tree1", "tree2", "tree3", "pine", "pine", "bush"];

/**
 * One chunk of the open world's scenery, deterministic by chunk coordinate
 * so the same chunk regrows the same trees every time the camera returns to
 * it. Denser near the farm (it reads as the woodland the farm was cut out
 * of) and thinner far out, where it exists only so the horizon is never
 * bare. Anything that would land inside `FARM_ZONE` is dropped rather than
 * shifted, so the farm's own edge stays exactly where the plot ladder ends.
 */
export function chunkScenery(cx: number, cy: number): SceneryItem[] {
  const random = seededRandom((cx * 73856093) ^ (cy * 19349663) ^ 0x5bd1e995);
  const x0 = cx * HOMESTEAD_CHUNK;
  const y0 = cy * HOMESTEAD_CHUNK;
  const farmCenterX = HOMESTEAD_MARGIN + (HOMESTEAD_WORLD_COLUMNS * HOMESTEAD_CELL) / 2;
  const farmCenterY = HOMESTEAD_MARGIN + (HOMESTEAD_WORLD_ROWS * HOMESTEAD_CELL) / 2;
  const dist = Math.hypot(
    x0 + HOMESTEAD_CHUNK / 2 - farmCenterX,
    y0 + HOMESTEAD_CHUNK / 2 - farmCenterY,
  );
  const woods = dist < 420 ? 9 : dist < 900 ? 5 : 3;

  const items: SceneryItem[] = [];
  for (let i = 0; i < woods; i += 1) {
    const x = x0 + random() * HOMESTEAD_CHUNK;
    const y = y0 + random() * HOMESTEAD_CHUNK;
    if (inFarmZone(x, y)) continue;
    items.push({ kind: CHUNK_WOOD_KINDS[Math.floor(random() * CHUNK_WOOD_KINDS.length)], x, y });
  }
  for (let i = 0; i < 10; i += 1) {
    const x = x0 + random() * HOMESTEAD_CHUNK;
    const y = y0 + random() * HOMESTEAD_CHUNK;
    if (inFarmZone(x, y)) continue;
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
