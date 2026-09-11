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

/** Where a tile came from. `"starter"` no longer occurs -- free starter beds
 *  were removed, see the file's "starter kit" section -- but the value stays
 *  in the union rather than being narrowed away: a legacy in-memory tile
 *  built before that removal, or a future free grant, should still type-check
 *  as a `SoilTile`. Nothing renders differently by origin today either way. */
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
   * `soilTileTier` rather than directly: a starter tile had no stored tier at
   * all (starter tiles were never persisted, and are gone now -- see the
   * file's "starter kit" section), and every row written before the tier
   * column existed has none either. Both
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
/* Relocating placed beds                                              */
/* ------------------------------------------------------------------ */

/**
 * Every tile reachable from `(tx, ty)` by a chain of 4-neighbour placed
 * tiles -- what a hold-tap on one bed picks up as a single block, so
 * relocating a row of touching beds moves the whole row rather than one
 * tile at a time. Empty when nothing is placed at the seed coordinate.
 */
export function soilTileGroup(soil: SoilMap, tx: number, ty: number): SoilTileCoord[] {
  if (!hasSoilTile(soil, tx, ty)) return [];
  const startKey = soilTileKey(tx, ty);
  const seen = new Set<string>([startKey]);
  const queue: SoilTileCoord[] = [{ tx, ty }];
  const group: SoilTileCoord[] = [];
  const steps: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length > 0) {
    const current = queue.shift()!;
    group.push(current);
    for (const [dx, dy] of steps) {
      const ntx = current.tx + dx;
      const nty = current.ty + dy;
      const key = soilTileKey(ntx, nty);
      if (seen.has(key) || !hasSoilTile(soil, ntx, nty)) continue;
      seen.add(key);
      queue.push({ tx: ntx, ty: nty });
    }
  }
  return group;
}

/** One tile's move, as part of a group relocating together. */
export interface SoilGroupMove {
  from: SoilTileCoord;
  to: SoilTileCoord;
}

export type SoilGroupRelocationPlan =
  | { kind: "ok"; moves: SoilGroupMove[] }
  /** No bed stands at the seed coordinate -- nothing to pick up. */
  | { kind: "empty" }
  /** The destination is the same tile the group already occupies. */
  | { kind: "no-op" }
  /** A destination tile lands outside `inBounds`. */
  | { kind: "out-of-bounds"; at: SoilTileCoord }
  /** A destination tile already holds a bed that ISN'T also moving. */
  | { kind: "blocked"; at: SoilTileCoord };

/**
 * Plans sliding the contiguous group at `(tx, ty)` so that tile lands on
 * `(toTx, toTy)`, every other tile in the group carried by the same offset.
 *
 * A destination tile is only a collision when it holds a bed OUTSIDE the
 * moving group -- the group is translating as one rigid block, so one
 * member's destination coinciding with another member's current position is
 * an internal shuffle, not a conflict. `moveSoilTileGroup` below is what
 * actually has to execute that shuffle without a transient duplicate; this
 * function only decides whether the final layout is legal.
 *
 * `inBounds` is injected rather than read from `./world.ts`'s
 * `CROP_FIELD_BEDS` directly -- this file's header explains why it cannot
 * value-import world.ts. Both stackacres-service.ts and
 * optimistic-actions.ts already import world.ts and pass its own bounds
 * check in, so server and client agree on where a bed may stand without a
 * second copy of that rectangle living here.
 */
export function planSoilGroupRelocation(
  soil: SoilMap,
  tx: number,
  ty: number,
  toTx: number,
  toTy: number,
  inBounds: (tx: number, ty: number) => boolean,
): SoilGroupRelocationPlan {
  const group = soilTileGroup(soil, tx, ty);
  if (group.length === 0) return { kind: "empty" };
  const dx = toTx - tx;
  const dy = toTy - ty;
  if (dx === 0 && dy === 0) return { kind: "no-op" };
  const groupKeys = new Set(group.map((t) => soilTileKey(t.tx, t.ty)));
  const moves: SoilGroupMove[] = [];
  for (const tile of group) {
    const to: SoilTileCoord = { tx: tile.tx + dx, ty: tile.ty + dy };
    if (!inBounds(to.tx, to.ty)) return { kind: "out-of-bounds", at: to };
    const toKey = soilTileKey(to.tx, to.ty);
    if (!groupKeys.has(toKey) && hasSoilTile(soil, to.tx, to.ty)) {
      return { kind: "blocked", at: to };
    }
    moves.push({ from: { tx: tile.tx, ty: tile.ty }, to });
  }
  return { kind: "ok", moves };
}

/**
 * Executes a relocation plan's `moves` in place, mutating `soil`. Returns
 * false, changing nothing, if any `from` tile is no longer standing -- the
 * caller's plan was built against a snapshot that has since moved under it,
 * and a partial relocation would strand the rest of the group.
 *
 * Every `from` is deleted BEFORE any `to` is written, so a group shuffling
 * internally (one member's destination is another member's current
 * position) never collides with itself -- a `Map` has no uniqueness
 * constraint to trip, but writing-then-deleting in the wrong order would
 * still let a later delete remove a tile this same call just placed.
 *
 * Preserves each tile's `order`/`origin`/`tier` -- only `tx`/`ty` change.
 * That is what keeps every crop's `soilSlot` (an index into
 * `orderedSoilTiles`, not a coordinate) resolving to the same bed after the
 * move: see this file's own header on `soilSlotSpot` for why an `order`
 * change, not a coordinate change, is what would actually reassign crops.
 */
export function moveSoilTileGroup(soil: SoilMap, moves: readonly SoilGroupMove[]): boolean {
  const relocated: SoilTile[] = [];
  for (const move of moves) {
    const tile = soil.get(soilTileKey(move.from.tx, move.from.ty));
    if (!tile) return false;
    relocated.push({ ...tile, tx: move.to.tx, ty: move.to.ty });
  }
  for (const move of moves) soil.delete(soilTileKey(move.from.tx, move.from.ty));
  for (const tile of relocated) soil.set(soilTileKey(tile.tx, tile.ty), tile);
  return true;
}

/* ------------------------------------------------------------------ */
/* The starter kit -- SINCE REMOVED                                    */
/* ------------------------------------------------------------------ */

/**
 * A new farm USED TO open with 24 free beds (`SOIL_STARTER_TILES`),
 * generated on the fly by a since-deleted `starterSoilTiles` from whichever
 * tiles of an area sat nearest its centre. Removed outright: free ground
 * undercut the whole point of a placeable, purchasable bed -- see the file
 * header's complaint about the old hardcoded dirt box having "nothing to
 * buy" -- and a garden should be something the player works up to, not
 * something every save already has. Every farm, including ones already
 * standing, opens as bare grass now: there was never a database row to
 * migrate, since a starter tile was derived fresh on every load and never
 * persisted (see lib/server/stackacres-soil-store.ts's own header).
 *
 * `mergeSoilTiles` went with it -- it only ever flattened the starter pair
 * ahead of what a profile had bought, and a farm's placed soil is now simply
 * its purchased tiles, with no merge step.
 */

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
 * The world point for a crop holding a FIXED slot, or null when the slot
 * space is empty.
 *
 * THE ONLY WAY A CROP STANDS ON A BED. `soilSlotSpotForRank`, the rank-hash
 * fallback this used to share the lattice with, is gone (2026-09-10): it
 * packed a crop with no slot onto whichever tile its hash landed on, wrapping
 * past capacity rather than refusing -- which is exactly what let two, or
 * five, crops stand on the same three tiles. `assignSoilSlot` in
 * stackacres-service.ts already refuses to sow a crop with no free bed, so
 * every crop reaching here either carries a real slot or stands off the
 * lattice entirely (`cropSpot` in ./world.ts falls back to the open-field
 * scatter, the same one an unsoiled farm already uses) -- never a guess at
 * which tile it meant.
 *
 * Wraps a slot past capacity so selling off beds cannot make an
 * already-standing crop invisible and untappable; that is the one wrap left,
 * and it only ever fires when a slot's own tile stops existing, never as a
 * placement guess.
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
 * Whether the crop holding `slot` is standing on tile `(tx, ty)` right now --
 * the one predicate `removeStackAcresSoilTile` (should a bed's own crop go
 * with it?), the client's remove-bed confirm, and the optimistic guess for
 * `remove-soil-tile` all three ask. Kept here, on top of `soilSlotTile`,
 * rather than restated at each call site, so "where does a crop stand" has
 * one answer everywhere it is asked.
 */
export function soilSlotOnTile(soil: SoilMap, slot: number, tx: number, ty: number): boolean {
  const tile = soilSlotTile(soil, slot);
  return tile !== null && tile.tx === tx && tile.ty === ty;
}

/**
 * The slot a specific tile holds, or null when nothing is standing there.
 * The inverse of `soilSlotTile` -- so a planting that names the tile the
 * player actually tapped, rather than "whatever's free", can be checked
 * against the same slot space `nextFreeSoilSlot` and the renderer both use.
 *
 * Unwrapped: this is a lookup into `orderedSoilTiles`, not a wrap-around
 * index, so a tile past `soilCapacity` cannot exist to be found.
 */
export function soilSlotForTile(soil: SoilMap, tx: number, ty: number): number | null {
  const index = orderedSoilTiles(soil).findIndex((tile) => tile.tx === tx && tile.ty === ty);
  return index >= 0 ? index : null;
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
