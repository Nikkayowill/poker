/**
 * The Greenhouse: a small, weather-sealed structure a player builds once,
 * tucked into the Farmstead's own ground -- the sub-grid StackAcres' pen
 * districts (./zones.ts, ./fence.ts) do not have, because a pen block is a
 * fixed 2x2 the district hands its stock, while a Greenhouse is walked INTO.
 *
 * SAME "PLACES, NOT PLOTS" POSTURE THE REST OF STACKACRES TOOK ON
 * 2026-09-03 -- see ./world.ts's own header. There is no tile grid anywhere
 * else on this map any more, and this module does not bring one back for the
 * open world either: `GREENHOUSE_PLOT` is one hand-placed rect (the same
 * convention `WHEAT_FIELD` and `BARN_FOOTPRINT` already use), and the tile
 * matrix inside it is a SUB-grid that exists only once the player has
 * stepped inside -- it addresses six growing slots in the Greenhouse's own
 * small local space, never a position anywhere else on the farm.
 *
 * INHERITS THE MAIN WORLD'S PROJECTION, DOES NOT REPLACE IT. Every slot's
 * screen position goes through `isoProjectLocal` (./iso.ts), which is proven
 * additive over the ordinary `isoProject` every other object on this map
 * already uses -- a sub-grid tile at local (row, col) lands on screen exactly
 * where projecting `GREENHOUSE_PLOT`'s origin plus that offset directly
 * would. See iso.ts's own header for the property this rests on.
 *
 * TWO REAL INVARIANTS, NOT COSMETIC FLAVOUR:
 *
 *   1. GROWTH ACCELERATION. A crop housed here finishes its cycle at
 *      `GREENHOUSE_GROWTH_MULTIPLIER` of the catalogue's own `durationMs`.
 *      Applied and snapshotted onto `ready_at` the moment it is sown
 *      (lib/server/stackacres-service.ts's `stockStackAcres`) -- never
 *      re-derived at collection -- the same rule every other snapshotted
 *      number in this codebase already follows (`yieldQuantity`, `stake`,
 *      Word Stack's own wager ladder). A retune of the multiplier therefore
 *      cannot change what a crop already growing under glass returns.
 *
 *   2. AMBIENT-WEATHER ISOLATION. `applyWeatherModifiers` (./weather.ts) has
 *      exactly one live caller today, `WeatherOverlayManager`
 *      (components/arcade/stackacres/weather-overlay-manager.ts), which is a
 *      screen-wide visual/session query with no wiring into real settlement
 *      -- `harvestStackAcres` never calls it, and weather.ts's own header
 *      says its economy hooks are deliberately unwired pending a separately
 *      reviewed pass. This module does not perform that wiring: doing so
 *      would touch the flat daily Gold ceiling every other file here is
 *      careful never to move outside of a dedicated review (see
 *      lib/server/stackacres-service.ts's own header on that asymmetry).
 *      What IS real and live -- the weather overlay's screen-wide tint and
 *      particle fields -- is what "ignores ambient weather" means here, and
 *      it IS wired: `environmentModifierFor(true).ignoresAmbientWeather`
 *      documents the invariant, and `WeatherOverlayManager.setSuppressed`
 *      (components/arcade/stackacres/weather-overlay-manager.ts), called
 *      from the scene's own `update()` off `steppedInGreenhouse`, is what
 *      actually freezes the weather clock and hides the layer while the
 *      camera is inside -- exactly as a real greenhouse's glass keeps the
 *      weather outside where the player standing under it can still see it.
 *
 * ONLY CROPS ARE HOUSED. Livestock keeps its own trough and pen; "a
 * greenhouse full of cattle" is not a place, so `GREENHOUSE_ALLOWED_STOCK`
 * is `StackAcresCrop` only, checked by `isGreenhouseStock`.
 */

import type { MachineItemId } from "./machine-items";
import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { projectedBounds } from "./iso";
import { STACKACRES_CROPS, type StackAcresCrop, type StackAcresStock } from "./catalogue";
import type { WorldPoint, WorldRect } from "./world";

/** Re-exported so a caller working entirely in the Greenhouse's local space
 *  never has to import ./iso.ts directly for the two functions this
 *  module's own math is built on (see the doc comments below). */
export { isoProjectLocal, isoUnprojectLocal } from "./iso";

/* ------------------------------------------------------------------ */
/* Where it stands                                                     */
/* ------------------------------------------------------------------ */

/**
 * The Greenhouse's own footprint, in world units -- hand-placed the same way
 * `WHEAT_FIELD` and `BARN_FOOTPRINT` are, and checked against both by
 * greenhouse.test.ts rather than re-derived: clear of the Farmstead's own
 * grow area (170..330 x, 200..360 y), clear of the wheat field just north of
 * it (348..432 x, 140..320 y, with 10 units of air between the two), and
 * inside `FARM_ZONE` (28..440 x, -60..410 y) on both edges.
 */
export const GREENHOUSE_PLOT: WorldRect = { x: 348, y: 330, width: 84, height: 64 };

/** A `ZoneBoundary` describes a sub-grid: its world-space origin (local
 *  (0, 0)) and the rows/cols/tile size of the matrix living inside it. Kept
 *  general rather than hard-coded to the Greenhouse alone, so a future
 *  interior (a second building with its own tile matrix) can describe its own
 *  boundary with the same shape rather than a bespoke one. */
export interface ZoneBoundary {
  /** World-space point this sub-grid's local (0, 0) corner sits at. */
  origin: WorldPoint;
  rows: number;
  cols: number;
  /** One tile's own side length, in world units. */
  tileSize: number;
}

/** Inset from `GREENHOUSE_PLOT`'s own edge, in world units, the way
 *  `growAreaInterior` insets `growAreaBounds` -- the walls and the glass
 *  roof take real room at the plot's own edge that the walkable/plantable
 *  interior does not get to use. */
const GREENHOUSE_WALL_INSET = 8;

export const GREENHOUSE_ROWS = 2;
export const GREENHOUSE_COLS = 3;
export const GREENHOUSE_TILE = 16;

/** The sub-grid's own boundary: local (0, 0) is the plot's inset corner, and
 *  the matrix is `GREENHOUSE_ROWS` x `GREENHOUSE_COLS` tiles of
 *  `GREENHOUSE_TILE` world units each. */
export function greenhouseBoundary(): ZoneBoundary {
  return {
    origin: { x: GREENHOUSE_PLOT.x + GREENHOUSE_WALL_INSET, y: GREENHOUSE_PLOT.y + GREENHOUSE_WALL_INSET },
    rows: GREENHOUSE_ROWS,
    cols: GREENHOUSE_COLS,
    tileSize: GREENHOUSE_TILE,
  };
}

/** How many crops the Greenhouse can hold at once -- one per slot in its own
 *  tile matrix. Mirrored by the database's own advisory-locked trigger (see
 *  the migration); this is the pure number both read. */
export const GREENHOUSE_SLOT_CAP = GREENHOUSE_ROWS * GREENHOUSE_COLS;

/** One slot's own local offset within the sub-grid's boundary, in the
 *  boundary's own local units -- NOT yet projected, and NOT yet added to the
 *  boundary's world-space origin. Row 0 is the row nearest the door (screen
 *  south), matching every other "S is nearest the camera" convention this
 *  isometric map already holds (see iso.ts's `DiamondCorners`). */
export function greenhouseSlotLocal(row: number, col: number, boundary: ZoneBoundary = greenhouseBoundary()): WorldPoint {
  return {
    x: (col + 0.5) * boundary.tileSize,
    y: (row + 0.5) * boundary.tileSize,
  };
}

/** A slot's absolute world-space centre -- what hit-testing and a crop's own
 *  spawn point use, the same "plain world units, no projection" space every
 *  other hit-test in this codebase (`growAreaAt`, `barnHitAt`) already works
 *  in. Because `isoProject` is additive (see iso.ts), this is exactly the
 *  point `isoProjectLocal(boundary.origin, greenhouseSlotLocal(...))` would
 *  project to -- the two never disagree. */
export function greenhouseSlotWorldPoint(
  row: number,
  col: number,
  boundary: ZoneBoundary = greenhouseBoundary(),
): WorldPoint {
  const local = greenhouseSlotLocal(row, col, boundary);
  return { x: boundary.origin.x + local.x, y: boundary.origin.y + local.y };
}

/** Every slot in the matrix, row-major, paired with its world point -- what
 *  the scene iterates to draw the sub-grid and what the panel iterates to
 *  render each one's own state. */
export interface GreenhouseSlotLayout {
  row: number;
  col: number;
  at: WorldPoint;
}

export function greenhouseSlotLayouts(boundary: ZoneBoundary = greenhouseBoundary()): GreenhouseSlotLayout[] {
  const out: GreenhouseSlotLayout[] = [];
  for (let row = 0; row < boundary.rows; row += 1) {
    for (let col = 0; col < boundary.cols; col += 1) {
      out.push({ row, col, at: greenhouseSlotWorldPoint(row, col, boundary) });
    }
  }
  return out;
}

/** Which slot (if any) a world point hit-tests to, or null outside the
 *  matrix entirely -- the sub-grid's own version of `growAreaAt`. Reuses the
 *  boundary's own tile size rather than a fixed radius, so a resized matrix
 *  needs no change here. */
export function greenhouseSlotAt(
  x: number,
  y: number,
  boundary: ZoneBoundary = greenhouseBoundary(),
): { row: number; col: number } | null {
  const localX = x - boundary.origin.x;
  const localY = y - boundary.origin.y;
  if (localX < 0 || localY < 0) return null;
  const col = Math.floor(localX / boundary.tileSize);
  const row = Math.floor(localY / boundary.tileSize);
  if (row < 0 || row >= boundary.rows || col < 0 || col >= boundary.cols) return null;
  return { row, col };
}

/** Whether a tapped ground point (post `isoUnproject`, the same space
 *  `growAreaAt` and `barnHitAt` (./world.ts) already work in) lands on the
 *  Greenhouse's own footprint -- the structure's entryway, checked the same
 *  way `barnHitAt` is before offering the fenced ground behind it. */
export function greenhouseHitAt(x: number, y: number): boolean {
  return (
    x >= GREENHOUSE_PLOT.x &&
    x <= GREENHOUSE_PLOT.x + GREENHOUSE_PLOT.width &&
    y >= GREENHOUSE_PLOT.y &&
    y <= GREENHOUSE_PLOT.y + GREENHOUSE_PLOT.height
  );
}

/** The screen-space rect a "stepped inside" camera should be bounded to --
 *  pass straight to `camera.setBounds(x, y, width, height)`, the same
 *  contract `worldBoundsScreenRect` (./bounds.ts) already has for the open
 *  world. Restoring the open world's own bounds on exit is `worldBoundsScreenRect()`
 *  itself; this module does not restate it. */
export function greenhouseInteriorScreenBounds(): WorldRect {
  return projectedBounds(GREENHOUSE_PLOT);
}

/* ------------------------------------------------------------------ */
/* What it does to what grows in it                                    */
/* ------------------------------------------------------------------ */

/** Only crops are housed -- see the file header. */
export const GREENHOUSE_ALLOWED_STOCK: readonly StackAcresCrop[] = STACKACRES_CROPS;

export function isGreenhouseStock(stock: StackAcresStock): stock is StackAcresCrop {
  return (GREENHOUSE_ALLOWED_STOCK as readonly StackAcresStock[]).includes(stock);
}

/** 30% faster: a real, load-bearing number applied to `durationMs` at
 *  stocking and snapshotted onto `ready_at`, never re-read at collection.
 *  See the file header's invariant (1). */
export const GREENHOUSE_GROWTH_MULTIPLIER = 0.7;

/**
 * The environment a housed (or open-air) crop actually grows under.
 *
 * `growthMultiplier` is what `stockStackAcres` applies to the catalogue's own
 * `durationMs` before computing `readyAt` -- 1 outside the Greenhouse, so an
 * open-air crop's math is completely unchanged by this module existing.
 * `ignoresAmbientWeather` is the flag the scene's weather overlay reads to
 * suppress its tint/particle layers while the camera is inside -- see the
 * file header's invariant (2) for why that, and not a settlement-side hook,
 * is the real thing to isolate today.
 */
export function environmentModifierFor(housed: boolean): EnvironmentModifier {
  return housed
    ? { growthMultiplier: GREENHOUSE_GROWTH_MULTIPLIER, ignoresAmbientWeather: true }
    : { growthMultiplier: 1, ignoresAmbientWeather: false };
}

export interface EnvironmentModifier {
  growthMultiplier: number;
  ignoresAmbientWeather: boolean;
}

/**
 * A crop's own `durationMs`, adjusted for whether it is housed. Fails open
 * (returns `baseDurationMs` unchanged) for a stock kind the Greenhouse does
 * not accept, so a caller cannot accidentally speed up livestock by passing
 * `housed: true` for a pig or a hen -- `stockStackAcres` refuses that combo
 * outright before this is ever reached (see the service), but this stays
 * total and safe on its own regardless.
 */
export function greenhouseDurationMs(stock: StackAcresStock, baseDurationMs: number, housed: boolean): number {
  if (!housed || !isGreenhouseStock(stock)) return baseDurationMs;
  return Math.round(baseDurationMs * GREENHOUSE_GROWTH_MULTIPLIER);
}

/* ------------------------------------------------------------------ */
/* What it costs to build                                              */
/* ------------------------------------------------------------------ */

/**
 * The Greenhouse's own one-time build cost, in processing-track goods
 * (./machine-items.ts) -- Flour from a Mill's wheat run, Cloth from its Loom
 * recipe, both already valid `homestead_processing_inventory.item` values
 * (verified against the live check constraint before this was written; see
 * lib/server/stackacres-service.ts's own note on that discipline). A STRICT
 * baseline: there is no partial build and no discount, and the database's
 * own `build_homestead_greenhouse` duplicates these two numbers by hand for
 * the same reason `homestead_units_enforce_stock_shape` duplicates
 * `STACKACRES_CATALOGUE`'s yield ceilings -- a trigger cannot import a
 * TypeScript module.
 */
export const GREENHOUSE_BUILD_COST: Readonly<Partial<Record<MachineItemId, number>>> = {
  flour: 20,
  cloth: 12,
};

export interface GreenhouseCostLine {
  item: MachineItemId;
  needed: number;
  held: number;
  met: boolean;
}

export interface GreenhouseBuildCheck {
  /** True once every requirement below is met. Says nothing about a race
   *  against another tab -- the same posture `sectorClearCheck` takes; the
   *  database's own row-locked RPC is the real authority. */
  ok: boolean;
  lines: GreenhouseCostLine[];
  /** Set when the Greenhouse already stands -- there is nothing left to
   *  build, and nothing should be spent trying. */
  alreadyBuilt: boolean;
}

/**
 * Whether this player's held inventory covers the build cost right now, and
 * what is short if not.
 *
 * ONE FUNCTION, TWO SURFACES -- the same shape `sectorClearCheck` documents
 * in ./sectors.ts: a build panel renders this straight, and
 * `buildStackAcresGreenhouse` (lib/server/stackacres-service.ts) calls it
 * before ever touching the database, so the panel and the refusal can never
 * disagree about what is missing.
 */
export function greenhouseBuildCheck(
  inventory: StackAcresInventory,
  alreadyBuilt: boolean,
): GreenhouseBuildCheck {
  const lines: GreenhouseCostLine[] = (Object.entries(GREENHOUSE_BUILD_COST) as [MachineItemId, number][]).map(
    ([item, needed]) => {
      const held = inventoryQuantity(inventory, item);
      return { item, needed, held, met: held >= needed };
    },
  );
  return { ok: !alreadyBuilt && lines.every((line) => line.met), lines, alreadyBuilt };
}
