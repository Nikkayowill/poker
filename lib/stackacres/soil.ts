/**
 * Placeable soil: the player-driven replacement for the one hardcoded,
 * district-sized dirt box the Crop Fields used to be.
 *
 * WHAT CHANGED AND WHY IT IS SHAPED THIS WAY. `paintAreaGround(area, "soil",
 * true)` painted one masked diamond over the whole of `growAreaBounds
 * ("meadow")` and every crop was scattered somewhere inside it by a hash of
 * its own row id. That gave a field with no rows, no edges the player chose,
 * and nothing to buy. This module replaces the box with a lattice of
 * individually placed tiles, and the scatter with a slot inside whichever
 * tile a crop landed on.
 *
 * ANIMALS ARE NOT AFFECTED, deliberately. A wandering animal never came
 * through `cropSpot` in the first place -- it spawns and walks inside
 * `growAreaInterior` (see `spawnCritter`/`stepCritter` in ./world.ts) -- so
 * the "keep animals scattered, put crops on a grid" split is a split that
 * already existed at the call site and is preserved by not touching it. The
 * one place the two meet is a MUCKED unit, livestock or crop, which parks at
 * a fixed spot: see `cropSpot`'s own fallback in ./world.ts.
 *
 * NO PHASER, NO components/ IMPORT, and no VALUE import from ./world.ts.
 * The first two are the rule every lib/stackacres module follows so vitest
 * can reach the arithmetic. The third is what keeps this module a runtime
 * leaf: ./world.ts and ./zones.ts both import THIS file for values, so a
 * value import back the other way would be read before those files finished
 * evaluating and throw -- the same cycle ./paths.ts and ./water.ts already
 * document. Types come back across that line freely; they are erased.
 *
 * That leaf position is why nothing here hashes an id. Ranking a crop needs
 * `seedFromId`, which lives in ./world.ts, so the RANK arrives as a plain
 * number and the slot arithmetic is all this module does with it. There is
 * deliberately no second copy of that hash here -- this codebase has been
 * bitten by hand-copied constants before (STAKES_TIERS, the wager ladders,
 * and `PEN_BLOCKS` two files over).
 */

import type { StackAcresStock } from "./catalogue";
import { isoProject } from "./iso";
// A VALUE import, and safe: ./soil-tiers.ts imports nothing at all, so it is
// a strictly deeper leaf than this file and cannot close a cycle back.
import { toSoilTier, type SoilTier } from "./soil-tiers";
// TYPE-ONLY, and it has to stay that way. ./world.ts value-imports THIS
// file, so a value import back the other way is a runtime cycle: world.ts's
// bindings are still in their temporal dead zone while this module's body
// runs, and a top-level `STACKACRES_TILE * 4` here does not throw -- it
// quietly evaluates to NaN and every tile on the farm lands at NaN. The two
// constants that would otherwise come across this line are restated below
// and held to their sources by soil.test.ts.
import type { WorldPoint, WorldRect } from "./world";

/* ------------------------------------------------------------------ */
/* The lattice                                                         */
/* ------------------------------------------------------------------ */

/**
 * One soil tile's side, in world units: one of ./world.ts's art units --
 * the same lattice ./irrigation.ts's `PIPE_TILE` and ./zones.ts's
 * `MEADOW_TILE` already snap to.
 *
 * Projected through ./iso.ts this is a 32x16 screen diamond -- exactly 2:1,
 * which is not a coincidence to be re-checked but a consequence of
 * `isoProject` sending any square to a diamond twice as wide as it is tall.
 * `soilTileDiamond` below returns those corners rather than letting a call
 * site rebuild them, so there is one place the tile's screen shape is known.
 *
 * ONE TILE, ONE PLANT, deliberately -- this USED TO be 4 art units holding a
 * dozen planting squares under one furrowed bed (`addSoilSlot`, since
 * deleted), bought and grown one square at a time. That indirection made
 * dragging soil down feel like buying real estate rather than planting: a
 * player wanted to drop a seed on the tile their thumb was over, not fill a
 * bed's twelfth square. Matching the base lattice means a drag across N tiles
 * plants N tiles, one placement per grid cell, the same way `place-pipe`
 * already works one tile at a time.
 *
 * WRITTEN AS A LITERAL, not as `STACKACRES_TILE`, for the cycle reason on
 * the import above. soil.test.ts holds the two equal, so this cannot drift
 * the way `PEN_BLOCKS` drifted from `GROW_AREA` two files over -- that one
 * was restated by hand with no test, and the exclusion it existed to provide
 * silently stopped covering the plot.
 */
export const SOIL_TILE = 16;

/** A tile's place on the lattice. Integer coordinates, NOT world units. */
export interface SoilTileCoord {
  tx: number;
  ty: number;
}

/** Where a tile came from, kept because the shop needs to tell a tile the
 *  player paid for apart from the two it was given. Nothing renders
 *  differently on it today. */
export type SoilTileOrigin = "starter" | "purchased";

export interface SoilTile extends SoilTileCoord {
  /**
   * Placement sequence, and the ONLY thing that orders the slot space (see
   * `orderedSoilTiles`). Monotonic per farm and never reused, so appending a
   * tile appends slots and cannot renumber the ones already standing.
   */
  order: number;
  origin: SoilTileOrigin;
  /**
   * What the bed is made of (./soil-tiers.ts). OPTIONAL, and read through
   * `soilTileTier` rather than directly: a starter tile has no stored tier at
   * all (starter tiles are never persisted -- see `starterSoilTiles`), and
   * every row written before the tier column existed has none either. Both
   * cases mean `SOIL_DEFAULT_TIER`, which is what those beds have always
   * been. Left optional rather than defaulted at every construction site so
   * that the dozens of existing `{ tx, ty, order, origin }` literals -- most
   * of them in tests about geometry, which the tier does not touch -- stay
   * valid and keep meaning "a plain bed".
   */
  tier?: SoilTier;
}

/** The tier of a bed, with the absent case resolved. Always use this rather
 *  than reading `.tier`, so a starter tile and a legacy row cannot read as
 *  `undefined` at a call site doing arithmetic with the multiplier. */
export function soilTileTier(tile: Pick<SoilTile, "tier">): SoilTier {
  return toSoilTier(tile.tier);
}

/**
 * Every placed tile, keyed `"tx,ty"`.
 *
 * A Map rather than an array because every hot path here is a coordinate
 * lookup: the grass SDF probes nine fixed neighbours per meadow tile
 * (`soilSignedDistance`), and the worker hooks ask "is there soil at this
 * point" per query. An array would make both a scan.
 */
export type SoilMap = Map<string, SoilTile>;

export function soilTileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/**
 * Which tile a world point falls on. Floor-divided, not truncated, for the
 * reason `meadowTileAt` states in ./zones.ts: truncation collapses the tile
 * at -0.5 and the one at 0.5 into a single cell, and this lattice runs
 * through negative world space (the Fold sits at x -320).
 */
export function soilTileAt(x: number, y: number): SoilTileCoord {
  return { tx: Math.floor(x / SOIL_TILE), ty: Math.floor(y / SOIL_TILE) };
}

/** The world square a tile covers. */
export function soilTileRect(tx: number, ty: number): WorldRect {
  return { x: tx * SOIL_TILE, y: ty * SOIL_TILE, width: SOIL_TILE, height: SOIL_TILE };
}

export function soilTileCentre(tx: number, ty: number): WorldPoint {
  return { x: (tx + 0.5) * SOIL_TILE, y: (ty + 0.5) * SOIL_TILE };
}

/**
 * The tile's four screen-space corners, in ./iso.ts's own N/E/S/W order --
 * what the scene fills and strokes, and the reason no call site there needs
 * to know `SOIL_TILE` at all.
 *
 * Deliberately not `projectedCorners(soilTileRect(...))`: that is exactly
 * what this is, but routing it through here means the tile's shape has one
 * owner, and a future half-tile or L-shaped bed changes this function rather
 * than every painter that guessed at the rect.
 */
export function soilTileDiamond(tx: number, ty: number): {
  n: WorldPoint;
  e: WorldPoint;
  s: WorldPoint;
  w: WorldPoint;
} {
  const r = soilTileRect(tx, ty);
  return {
    n: isoProject(r.x, r.y),
    e: isoProject(r.x + r.width, r.y),
    s: isoProject(r.x + r.width, r.y + r.height),
    w: isoProject(r.x, r.y + r.height),
  };
}

/* ------------------------------------------------------------------ */
/* The map                                                             */
/* ------------------------------------------------------------------ */

export function createSoilMap(tiles: readonly SoilTile[] = []): SoilMap {
  const map: SoilMap = new Map();
  for (const tile of tiles) map.set(soilTileKey(tile.tx, tile.ty), tile);
  return map;
}

export function hasSoilTile(soil: SoilMap, tx: number, ty: number): boolean {
  return soil.has(soilTileKey(tx, ty));
}

/** Whether a world point is standing on placed soil. */
export function onSoil(soil: SoilMap, x: number, y: number): boolean {
  const { tx, ty } = soilTileAt(x, y);
  return hasSoilTile(soil, tx, ty);
}

/**
 * Places a tile, returning whether it took. A coordinate already holding a
 * tile is refused rather than overwritten: the caller is a shop purchase,
 * and silently replacing a tile would take the Gold and change nothing.
 */
export function placeSoilTile(soil: SoilMap, tile: SoilTile): boolean {
  const key = soilTileKey(tile.tx, tile.ty);
  if (soil.has(key)) return false;
  soil.set(key, tile);
  return true;
}

export function removeSoilTile(soil: SoilMap, tx: number, ty: number): boolean {
  return soil.delete(soilTileKey(tx, ty));
}

/**
 * The next free `order`. Max-plus-one rather than `soil.size` so removing a
 * tile from the middle cannot hand out an order that is already standing --
 * which would put two tiles in one slot range.
 */
export function nextSoilOrder(soil: SoilMap): number {
  let max = -1;
  for (const tile of soil.values()) max = Math.max(max, tile.order);
  return max + 1;
}

/** What `plantSoilTile` actually did, so the caller can tell a fresh bed
 *  from the one refusal a single tile can give now that a bed holds exactly
 *  one plant -- there is nothing left to grow or fill. */
export type PlantSoilTileResult =
  | { kind: "created"; tile: SoilTile }
  /** A bed already stands here -- created or starter, tier-blind. */
  | { kind: "occupied" };

/**
 * Buys one bed: a one-tile plot at `coord`, tier-priced
 * (`SOIL_TILE_PRICE_GOLD`-scaled per tier), refused outright if a bed
 * already stands there.
 *
 * USED TO grow an existing bed by one more of its dozen planting squares
 * (`addSoilSlot`, since deleted, when `SOIL_TILE` was 4 art units wide) --
 * that whole "which square, which tier does this square already have to
 * match" question does not exist once a bed IS one plant: the only two
 * outcomes left are "bare ground, plant it" and "something is already
 * standing here."
 */
export function plantSoilTile(soil: SoilMap, coord: SoilTileCoord, tier: SoilTier): PlantSoilTileResult {
  const key = soilTileKey(coord.tx, coord.ty);
  if (soil.has(key)) return { kind: "occupied" };
  const tile: SoilTile = {
    tx: coord.tx,
    ty: coord.ty,
    order: nextSoilOrder(soil),
    origin: "purchased",
    tier,
  };
  soil.set(key, tile);
  return { kind: "created", tile };
}

/**
 * Placed tiles in slot order. Sorted by `order`, with the coordinate as a
 * tie-break so a hand-built map in a test (every tile at order 0) still has
 * ONE defined ordering rather than whatever the Map happened to iterate.
 */
export function orderedSoilTiles(soil: SoilMap): SoilTile[] {
  return [...soil.values()].sort(
    (a, b) => a.order - b.order || a.ty - b.ty || a.tx - b.tx,
  );
}

/**
 * Whether two purchased-tile lists name the same tiles, order-independent.
 *
 * The client's own reason to have this: every action response carries the
 * FULL list (StackAcresView.soilTiles), not a diff, so a feed or a water tap
 * that never touched the soil still hands the shop-facing shell a fresh
 * array from JSON every time. Pushing that into the scene unconditionally
 * would repaint the beds, the grass collar and every crop's slot on an
 * unrelated action -- this is what lets the shell skip that push when
 * nothing about the layout actually moved.
 */
export function soilTilesEqual(a: readonly SoilTile[], b: readonly SoilTile[]): boolean {
  if (a.length !== b.length) return false;
  const key = (t: SoilTile) => `${t.tx},${t.ty},${t.order},${t.origin}`;
  const as = a.map(key).sort();
  const bs = b.map(key).sort();
  return as.every((k, i) => k === bs[i]);
}

/* ------------------------------------------------------------------ */
/* The starter kit                                                     */
/* ------------------------------------------------------------------ */

/**
 * How many tiles a new farm is given. Every tile after these is bought.
 *
 * Raised from 2 to 24 the same day a bed shrank from 4 art units (holding up
 * to a dozen planting squares) down to 1 (holding exactly one plant): the
 * old two starter BEDS were free 2x12 = 24 planting squares, and this keeps
 * that same free starting capacity in the new one-tile-per-plant terms
 * rather than quietly handing new farms 1/12th of what they used to open
 * with.
 */
export const SOIL_STARTER_TILES = 24;

/**
 * Gold cost of one PLAIN purchased bed -- `SOIL_DEFAULT_TIER`'s own price,
 * restated here because this constant predates tiers. soil-tiers.test.ts
 * holds the two equal, so repricing the plain bed in one place cannot drift
 * from the other.
 *
 * Flat per bed -- no ladder, no scaling with how many a player already owns.
 * A bed still does not gate how many crops can be grown (see the file
 * header), so there is no economy reason for a rising price the way land or
 * capacity have one. What a bed is no longer is purely cosmetic: since
 * ./soil-tiers.ts, the TIER a bed is bought at can shorten a crop's cycle and
 * water its own tile. Those effects belong to the tier, not to this price,
 * and both are applied outside this module -- growth is baked into `ready_at`
 * at sow, hydration is resolved by the irrigation recompute. Nothing in THIS
 * file reads a tier for anything but passing it along.
 */
export const SOIL_TILE_PRICE_GOLD = 167;

/**
 * The two free tiles a new save opens with, derived from the area crops
 * already stand in rather than hardcoded.
 *
 * Derived, because a hardcoded pair is exactly the drift `PEN_BLOCKS` fell
 * into two files over: it restated `GROW_AREA` by hand, the grow area moved,
 * and the grass exclusion quietly stopped covering the plot. Feeding this the
 * live rect means moving the Crop Fields moves the starter kit with them.
 *
 * The pair is chosen as the two fully-contained tiles nearest the area's
 * centre, walked in a stable order, so it is the same two tiles on every
 * device and every reload without anything being persisted. Fewer than two
 * may come back if the area cannot hold two whole tiles -- the caller gets
 * what fits rather than a tile hanging over the fence line.
 */
export function starterSoilTiles(area: WorldRect): SoilTile[] {
  const first = soilTileAt(area.x, area.y);
  const last = soilTileAt(area.x + area.width, area.y + area.height);
  const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };

  const candidates: { tx: number; ty: number; d: number }[] = [];
  for (let ty = first.ty; ty <= last.ty; ty += 1) {
    for (let tx = first.tx; tx <= last.tx; tx += 1) {
      const r = soilTileRect(tx, ty);
      // Whole tiles only. A tile half over the fence would take grass off
      // ground the field does not own and put a plant outside the plot.
      const inside =
        r.x >= area.x &&
        r.y >= area.y &&
        r.x + r.width <= area.x + area.width &&
        r.y + r.height <= area.y + area.height;
      if (!inside) continue;
      const c = soilTileCentre(tx, ty);
      candidates.push({ tx, ty, d: Math.hypot(c.x - centre.x, c.y - centre.y) });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.ty - b.ty || a.tx - b.tx);
  return candidates
    .slice(0, SOIL_STARTER_TILES)
    .map((c, i) => ({ tx: c.tx, ty: c.ty, order: i, origin: "starter" as const }));
}

/* ------------------------------------------------------------------ */
/* The slot lattice -- one plant per bed                               */
/* ------------------------------------------------------------------ */

/**
 * A bed's world point: dead centre, with no jitter at all.
 *
 * USED TO take a `slot` argument and place up to a dozen plants across a
 * furrowed bed (`SOIL_COL_PITCH`/`SOIL_FURROW_ROWS`/`soilFurrowOffsets`,
 * since deleted) -- gone along with the rest of the furrow lattice now that
 * a bed IS one plant. The scatter this originally replaced rolled a random
 * point per crop, which is what made a field read as spilled rather than
 * planted; standing dead centre keeps that same "a row is exactly a row"
 * property with nothing left to lay out.
 */
export function soilSlotPoint(tile: SoilTileCoord): WorldPoint {
  return soilTileCentre(tile.tx, tile.ty);
}

/** How many plants the placed soil can hold -- one per bed, tier-blind.
 *  USED TO sum each bed's own `soilTileOwnedSlots` (a bed could hold up to
 *  a dozen, bought one square at a time); every bed now holds exactly one,
 *  so this is just the bed count. */
export function soilCapacity(soil: SoilMap): number {
  return soil.size;
}

/**
 * The world point for a crop holding rank `rank` among its siblings, or null
 * when there is no soil to stand on (the caller then falls back -- see
 * `cropSpot` in ./world.ts).
 *
 * WHAT RANK COSTS, stated plainly because it is the one real trade in this
 * module. The rank is a crop's position once its siblings are sorted by a
 * hash of their own ids (./world.ts's `cropRank`), NOT its index in whatever
 * order the rows arrived -- that much follows the rule `wheatPlotSpot`
 * already states, and it is what stops a repaint shuffling the bed. But a
 * rank is still relative to the set: harvest a crop and every sibling that
 * hashed above it moves up one slot. The bed re-packs itself tidily, which is
 * the FarmVille look and is arguably the nicer behaviour, but it IS movement
 * that a persisted slot column on `homestead_units` would remove. That is a
 * migration, so it is not done here; see the note in the PR body.
 *
 * Ranks past capacity wrap rather than vanish. A crop with nowhere to stand
 * would otherwise be invisible and untappable, which is strictly worse than
 * two plants sharing a bed until the player buys more ground.
 */
export function soilSlotSpotForRank(soil: SoilMap, rank: number): WorldPoint | null {
  const capacity = soilCapacity(soil);
  if (capacity <= 0) return null;
  const wrapped = ((rank % capacity) + capacity) % capacity;
  return soilSlotPoint(orderedSoilTiles(soil)[wrapped]);
}

/**
 * The starter pair ahead of whatever this profile has bought -- the full slot
 * space, in the one order both sides have to agree on.
 *
 * ONE OWNER, deliberately. The server assigns a crop's slot index and the
 * client renders it, and those two only line up while both flatten the tiles
 * the same way. Two hand-rolled spreads (there was one in the shell already)
 * is exactly the drift `PEN_BLOCKS`/`GROW_AREA` and the three copies of
 * `STAKES_TIERS` are cited for elsewhere in this codebase -- except here the
 * symptom would be a crop drawn on a bed that is not the one that sped it up.
 *
 * The area is a parameter rather than read from ./world.ts's `growAreaBounds`
 * because this module may not value-import that one (see the file header).
 */
export function mergeSoilTiles(area: WorldRect, purchased: readonly SoilTile[]): SoilTile[] {
  return [...starterSoilTiles(area), ...purchased];
}

/**
 * The world point for a crop holding a FIXED slot, or null when the slot
 * space is empty. Wraps a slot past capacity exactly as
 * `soilSlotSpotForRank` wraps a rank past it: selling off beds must not make
 * a crop invisible and untappable.
 */
export function soilSlotSpot(soil: SoilMap, slot: number): WorldPoint | null {
  const capacity = soilCapacity(soil);
  if (capacity <= 0) return null;
  const wrapped = ((slot % capacity) + capacity) % capacity;
  return soilSlotPoint(orderedSoilTiles(soil)[wrapped]);
}

/** Which tile a slot index falls on, or null when there is no soil. Same
 *  wrap as `soilSlotSpot`, so the two never disagree about a slot's home. */
export function soilSlotTile(soil: SoilMap, slot: number): SoilTile | null {
  const capacity = soilCapacity(soil);
  if (capacity <= 0) return null;
  const wrapped = ((slot % capacity) + capacity) % capacity;
  return orderedSoilTiles(soil)[wrapped] ?? null;
}

/**
 * The lowest slot nobody is standing in, or null when the soil is full.
 *
 * LOWEST rather than random, so sowing fills bed one before bed two and a
 * player watching their farm sees it pack in reading order. Full is a real
 * answer, not an error: the caller sows anyway and leaves the slot null,
 * which puts the crop back on the wrapping rank-hash path rather than
 * refusing a purchase because the player is out of ground.
 */
export function nextFreeSoilSlot(soil: SoilMap, taken: Iterable<number>): number | null {
  const capacity = soilCapacity(soil);
  if (capacity <= 0) return null;
  const used = new Set<number>();
  for (const slot of taken) {
    // Normalised the same way the renderer wraps it, so a stale out-of-range
    // slot still blocks the cell it is actually drawn in.
    used.add(((slot % capacity) + capacity) % capacity);
  }
  for (let slot = 0; slot < capacity; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The grass SDF                                                       */
/* ------------------------------------------------------------------ */

/**
 * How wide the stubble collar around a bed is, in world units.
 *
 * MUST stay under `SOIL_TILE`, and soil.test.ts holds it there. The probe in
 * `soilSignedDistance` only looks at the 3x3 block of tile coordinates around
 * the point, which is exhaustive exactly while the band cannot reach past one
 * tile -- widen this past `SOIL_TILE` and the SDF starts missing tiles two
 * coordinates away and grass grows in a ring it should have cut.
 *
 * Three quarters of a tile, not half. A meadow tile is `SOIL_TILE` wide too
 * (both lattices are the same one art unit now), so every off-bed meadow
 * tile's CENTRE -- what `meadowBaseDensity` actually measures against, see
 * ./zones.ts -- sits at a distance that is an odd multiple of `SOIL_TILE / 2`
 * from the bed's edge: 8, 24, 40, and so on. A band of exactly half a tile
 * would make `d < SOIL_EDGE_BAND` false for the nearest one at distance 8,
 * and the collar would never fire at all. Three quarters (12) clears that
 * nearest centre while staying under `SOIL_TILE` for the reason above it.
 */
export const SOIL_EDGE_BAND = SOIL_TILE * 0.75;

/**
 * Signed distance from a world point to the placed soil: negative on a tile,
 * positive off it, zero on the edge.
 *
 * O(1), not a scan. A point can only be within `SOIL_EDGE_BAND` of a tile
 * that is at most one coordinate away in each axis (the band is under one
 * tile wide -- see the constant), so nine `Map.get`s answer it exhaustively
 * however many thousand tiles the player has placed. This is called once per
 * meadow tile per chunk build and again on every scythe sample, so a scan
 * here would be felt.
 *
 * ONE HONEST LIMIT: the sign is exact, the inside MAGNITUDE is conservative.
 * Taking the min over per-rect distances under-reports depth for a point
 * inside one tile but near an edge it shares with another (the union has no
 * boundary there, the individual rects do). Every caller here tests the sign
 * or compares the positive side against the band, so nothing depends on the
 * inside magnitude -- but a future caller wanting true depth into a bed
 * needs to know it is not getting it from this.
 */
export function soilSignedDistance(soil: SoilMap, x: number, y: number): number {
  if (soil.size === 0) return Number.POSITIVE_INFINITY;
  const centre = soilTileAt(x, y);
  let best = Number.POSITIVE_INFINITY;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const tx = centre.tx + ox;
      const ty = centre.ty + oy;
      if (!soil.has(soilTileKey(tx, ty))) continue;
      const r = soilTileRect(tx, ty);
      const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
      const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
      const outside = Math.hypot(dx, dy);
      // Inside the rect both gaps are zero, so the distance is the shortest
      // run to any of its four edges, taken negative. Normalised away from
      // -0 on the boundary itself: every caller here tests `<= 0`, which -0
      // satisfies, but -0 propagates through arithmetic and comparisons in
      // ways that are a nuisance to debug and that no caller wants.
      const inside = Math.min(x - r.x, r.x + r.width - x, y - r.y, r.y + r.height - y);
      const d = outside > 0 ? outside : inside === 0 ? 0 : -inside;
      best = Math.min(best, d);
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* State hooks, for the farmhand                                       */
/* ------------------------------------------------------------------ */

/**
 * One crop as the automation layer sees it: where it is standing and what it
 * wants doing, with no Phaser node and no scene behind it.
 *
 * Flat booleans rather than the raw `state` string on purpose. A worker asks
 * "is there anything to water", and every caller re-deriving that from
 * `state === "dry"` is how a fifth call site eventually gets it wrong.
 */
export interface CropInstance {
  unitId: string;
  stock: StackAcresStock;
  at: WorldPoint;
  /** The tile it is standing on, or null if it fell back off the lattice. */
  tile: SoilTileCoord | null;
  growthStage: 0 | 1 | 2;
  isDry: boolean;
  needsHarvest: boolean;
}

/** What a tile currently holds. Derived per call rather than cached on the
 *  tile: a tile owns its position, and nothing else, so there is no second
 *  copy of crop state to fall out of date. */
export interface SoilTileState {
  tile: SoilTile;
  crops: CropInstance[];
  occupied: boolean;
  dryCount: number;
  harvestableCount: number;
}

export function soilTileState(tile: SoilTile, crops: readonly CropInstance[]): SoilTileState {
  const mine = crops.filter((c) => c.tile?.tx === tile.tx && c.tile?.ty === tile.ty);
  return {
    tile,
    crops: mine,
    occupied: mine.length > 0,
    dryCount: mine.filter((c) => c.isDry).length,
    harvestableCount: mine.filter((c) => c.needsHarvest).length,
  };
}

/**
 * The shape `buildCropInstances` needs off a unit row. Structural rather
 * than an import of the scene's own `StackAcresSceneUnit`, so this module
 * stays clear of components/ and either side can grow a field without
 * dragging the other along.
 */
export interface CropSource {
  id: string;
  stock: StackAcresStock;
  state: "working" | "hungry" | "dry" | "ready" | "mucked";
  progress: number | null;
}

/**
 * Turns unit rows into the worker's view of the field.
 *
 * `spotFor` and `stageFor` are injected rather than called directly for the
 * cycle reason in the file header: both live in ./world.ts, which imports
 * THIS file. Passing them in keeps this module a leaf and, incidentally,
 * makes the queries below testable against a fixture with no world at all.
 */
export function buildCropInstances(
  units: readonly CropSource[],
  spotFor: (unitId: string) => WorldPoint,
  stageFor: (progress: number | null, ready: boolean) => 0 | 1 | 2,
  soil: SoilMap,
): CropInstance[] {
  return units.map((unit) => {
    const at = spotFor(unit.id);
    const coord = soilTileAt(at.x, at.y);
    const onPlacedSoil = hasSoilTile(soil, coord.tx, coord.ty);
    return {
      unitId: unit.id,
      stock: unit.stock,
      at,
      tile: onPlacedSoil ? coord : null,
      growthStage: stageFor(unit.progress, unit.state === "ready"),
      isDry: unit.state === "dry",
      needsHarvest: unit.state === "ready",
    };
  });
}

/**
 * Nearest crop matching `wants`, or null.
 *
 * Distance is measured in WORLD space, which is the right frame here and not
 * an oversight: a worker walks the world, so the crop it should walk to is
 * the one fewest paces away, not the one that looks closest once the iso
 * shear has foreshortened the y axis. (The tap test in the scene measures in
 * SCREEN space for the mirror-image reason -- a thumb is on the picture.)
 *
 * Ties break on `unitId` so two crops the same distance away cannot make a
 * worker oscillate between them frame to frame.
 */
export function closestCrop(
  from: WorldPoint,
  crops: readonly CropInstance[],
  wants: (crop: CropInstance) => boolean,
): CropInstance | null {
  let best: CropInstance | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const crop of crops) {
    if (!wants(crop)) continue;
    const d = Math.hypot(crop.at.x - from.x, crop.at.y - from.y);
    if (d < bestD || (d === bestD && best !== null && crop.unitId < best.unitId)) {
      best = crop;
      bestD = d;
    }
  }
  return best;
}

export function getClosestDryCrop(
  from: WorldPoint,
  crops: readonly CropInstance[],
): CropInstance | null {
  return closestCrop(from, crops, (crop) => crop.isDry);
}

export function getClosestHarvestableCrop(
  from: WorldPoint,
  crops: readonly CropInstance[],
): CropInstance | null {
  return closestCrop(from, crops, (crop) => crop.needsHarvest);
}
