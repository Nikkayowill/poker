/**
 * The ground that is not lawn: the sea along the east edge, the pond, the
 * dirt roads and the two worked yards -- as one field of materials over the
 * world, cut into the terrain pack's tiles.
 *
 * WHY ONE FIELD. The pack (see scripts/prepare-stackacres-terrain.py) is a
 * coastline set: plain plates for sand, shallow and deep water, and for each
 * neighbouring pair of materials a straight edge, an inside curve and an
 * outside curve at four rotations. That is exactly the marching-squares
 * vocabulary, so anything expressed as "which material is at this point"
 * can be drawn from it -- and a road drawn that way meets the lawn with the
 * same grass-edged sand the shore does, rather than with a painted feather
 * that matches nothing else on the map.
 *
 * THE LATTICE. Cells are `TERRAIN_CELL` (16) units square: one pack diamond
 * at the density the lawn already uses (`prepare-stackacres-terrain.py`'s
 * GRASS_SCALE puts a 64x32 diamond on 16 world units). The lattice is offset
 * by `TERRAIN_ORIGIN` so its diamonds land ON the lawn's own stamps rather
 * than half a diamond off them: `bakeGrass` tiles the lawn from screen
 * (0, 0) and its stamps sit at screen centres (16k, 8m + 8) with k + m odd,
 * which is the world lattice shifted by (8, -8). A grass-edged tile drawn
 * over the lawn then replaces one whole lawn stamp instead of straddling
 * two.
 *
 * MARCHING SQUARES, corner-sampled. A cell's tile is decided by the material
 * at its four corners (`cellFrame`): all one material is a plate; two
 * adjacent corners of the lower material is a straight edge; one corner is
 * an outside curve; three is an inside curve. The pack has no tile for two
 * opposite corners (a saddle), and none for corners two levels apart (grass
 * beside shallow water); both are resolved rather than left as holes -- the
 * saddle by the cell's centre, the skip by clamping to the nearer level --
 * and the bands are drawn wide enough that neither happens on the map today
 * (terrain.test.ts counts them).
 *
 * CHUNKS. The scene bakes the tiles into canvases one chunk at a time
 * (art-terrain.ts), and chunks whose tiles come out identical share one
 * texture: every chunk carries a content key. That is why the shore's
 * wobble is periodic in exactly two chunks and the plate variant is chosen
 * from cell coordinates modulo the chunk -- a straight stretch of road or
 * coast then costs one texture however long it runs.
 *
 * This module sits between ./world.ts and the leaves it reads: ./paths.ts
 * and ./water.ts value-import nothing from world.ts, so world.ts may
 * value-import this (for `inSea`) without the cycle its own header warns of.
 * Nothing here touches Phaser or a canvas.
 */

import { isoProject, isoUnproject, projectedBounds } from "./iso";
import { ALL_FARM_PATHS, distanceToPath, type PathSpec } from "./paths";
import { POND, POND_SAND, POND_SHALLOW, pondRadial } from "./water";
import { yardRect } from "./yard";
import type { WorldPoint, WorldRect } from "./world";

/* ---- the lattice --------------------------------------------------------- */

/** One pack diamond, in world units. */
export const TERRAIN_CELL = 16;

/** Where cell (0, 0)'s north-west corner sits, so the lattice lands on the
 *  lawn's own stamps (see the header). */
export const TERRAIN_ORIGIN: WorldPoint = { x: 8, y: -8 };

/** Cells per chunk side. Seven, because a chunk's projected box (224x112
 *  screen units) plus the blades overhanging its top row then bakes into a
 *  512x256 canvas at two device pixels per unit with nothing wasted on the
 *  power-of-two padding. */
export const TERRAIN_CHUNK_CELLS = 7;
export const TERRAIN_CHUNK = TERRAIN_CELL * TERRAIN_CHUNK_CELLS;

/** How far a grass-edged tile's blades reach above its diamond, in screen
 *  units: the pack's tallest overhang is ten source pixels, five units. */
export const TERRAIN_OVERHANG = 8;

/* ---- the materials ------------------------------------------------------- */

export type TerrainMaterial = "grass" | "dirt" | "sand" | "shallow" | "deep";

/** Ground rises out of the water in steps: only neighbouring steps have a
 *  transition tile between them. Dirt is sand's step (it IS the sand plate,
 *  tinted), so a road meets a beach with no transition at all. */
const LEVEL: Readonly<Record<TerrainMaterial, 0 | 1 | 2 | 3>> = {
  grass: 0,
  dirt: 1,
  sand: 1,
  shallow: 2,
  deep: 3,
};

/* ---- the sea ------------------------------------------------------------- */

/** Where the lawn ends and the beach begins, on average, in world x. East
 *  of every district (the Fold's bounds end at 432) and west of the camera's
 *  own wall (`worldBoundsRect` ends at 592), so the shore is always in
 *  reach and never behind a pen. */
export const SEA_SHORE_X = 456;
export const SEA_SAND_WIDTH = 32;
export const SEA_SHALLOW_WIDTH = 40;

/** The shore's wobble repeats every two chunks, so a chunk of coast and the
 *  one two south of it bake to the same texture. */
export const SEA_WOBBLE_PERIOD = TERRAIN_CHUNK * 2;

/** The shoreline: `SEA_SHORE_X` wandered by three harmonics of the period.
 *  Amplitudes are kept small enough (slope under 0.8) that the sand and
 *  shallow bands stay wider than a cell's diagonal measured across the
 *  shore, which is what keeps every cell within one level of its
 *  neighbours. */
export function seaShoreX(y: number): number {
  const t = (y / SEA_WOBBLE_PERIOD) * Math.PI * 2;
  return SEA_SHORE_X + 10 * Math.sin(t) + 5 * Math.sin(2 * t + 1.3) + 2 * Math.sin(4 * t + 0.4);
}

/** Salt water or sand: nothing wild grows here, nothing wanders here. */
export function inSea(x: number, y: number): boolean {
  return x >= seaShoreX(y);
}

/** The shore never wanders further than this from `SEA_SHORE_X`: the sum of
 *  `seaShoreX`'s amplitudes. East of `SEA_SHORE_X + SEA_SHORE_WOBBLE` every
 *  point is sand or water and so is drawn by a tile. */
export const SEA_SHORE_WOBBLE = 17;

/** The east edge of the tiled region. Past it the sea is a grid of plain
 *  images of open water (`seaExpanseTiles`); the tiles run this far so that
 *  every one of those images, which is `SEA_EXPANSE_TILE` screen units
 *  square and so spans up to 192 world units of x, can be kept entirely
 *  east of the shore's wobble and still leave no gap before the tiles. */
export const SEA_TILES_EAST = 672;

/** One open-water image, in screen units: deep-tile.png (512 px) at the
 *  lawn's four pixels per unit. */
export const SEA_EXPANSE_TILE = 128;

/**
 * The open sea, as the screen-space squares of one image each that cover
 * everything past the tiles inside `reach` -- the camera's largest possible
 * view, in screen units. A square is laid wherever all four of its corners
 * sit east of the shore's furthest wander, so it never covers lawn; every
 * point east of `SEA_TILES_EAST` is then inside one (a square spans at most
 * 192 world units of x, and 480 + 192 = 672). Plain images rather than one
 * tiling sprite because Phaser gives a TileSprite a backing canvas the size
 * of the sprite in both renderers, and a sprite big enough to cover the
 * reach of a desktop window is tens of megabytes on a phone.
 */
export function seaExpanseTiles(reach: WorldRect): WorldPoint[] {
  const t = SEA_EXPANSE_TILE;
  const west = SEA_SHORE_X + SEA_SHORE_WOBBLE + 4;
  const out: WorldPoint[] = [];
  const x0 = Math.floor(reach.x / t) * t;
  const y0 = Math.floor(reach.y / t) * t;
  for (let y = y0; y < reach.y + reach.height; y += t) {
    for (let x = x0; x < reach.x + reach.width; x += t) {
      const corners = [isoUnproject(x, y), isoUnproject(x + t, y), isoUnproject(x, y + t), isoUnproject(x + t, y + t)];
      if (corners.every((c) => c.x >= west)) out.push({ x, y });
    }
  }
  return out;
}

/* ---- the dirt ------------------------------------------------------------ */

/**
 * The two yards that are worked ground rather than lawn: the barn's apron
 * (its ground band, the picture box's feet, with the yard in front of the
 * door) and the Greenhouse's plot with a margin. Yard literals, so they move
 * with the Farmstead; terrain.test.ts holds them to `BARN_FOOTPRINT` and
 * `GREENHOUSE_PLOT`, which live in modules this one must not value-import.
 *
 * The old Hen Pen block is deliberately not here. Its mud stayed after the
 * hens moved to Hen Haven as "the worn ground the coops left behind", and
 * what that read as on screen was a large empty brown square in the middle
 * of the yard. It is lawn again.
 */
export const DIRT_YARDS: readonly WorldRect[] = [
  yardRect(55, -6, 120, 60),
  yardRect(336, 322, 104, 84),
];

/**
 * How far from a road's centreline the ground is dirt, in world units. Half
 * the width plus six: for the grid's 32-wide roads, which run midway between
 * two lattice rows, that takes in exactly those two rows and no third, so
 * the road bakes two cells wide with a grass-edged cell either side --
 * about the width it was drawn at. The lane and the yard road get the same
 * two rows for the same reason; a narrow service spur gets one or two.
 */
export function dirtReach(spec: PathSpec): number {
  return spec.width / 2 + 6;
}

function inRect(x: number, y: number, r: WorldRect): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function onRoad(x: number, y: number): boolean {
  for (const spec of ALL_FARM_PATHS) {
    if (distanceToPath(x, y, spec) <= dirtReach(spec)) return true;
  }
  return false;
}

/* ---- the field ------------------------------------------------------------ */

/**
 * What the ground is at a world point. Sea first, then the pond, then the
 * roads and yards, then lawn. The pond and the yards never meet the sea; a
 * road that reaches the pond (the dock spur) simply becomes sand where it
 * touches the ring, both being level one.
 */
export function terrainMaterialAt(x: number, y: number): TerrainMaterial {
  const sea = x - seaShoreX(y);
  if (sea >= 0) {
    if (sea < SEA_SAND_WIDTH) return "sand";
    if (sea < SEA_SAND_WIDTH + SEA_SHALLOW_WIDTH) return "shallow";
    return "deep";
  }
  const pond = (pondRadial(x, y) - 1) * Math.min(POND.rx, POND.ry);
  if (pond < POND_SAND) {
    if (pond < -POND_SHALLOW) return "deep";
    if (pond < 0) return "shallow";
    return "sand";
  }
  if (onRoad(x, y)) return "dirt";
  for (const yard of DIRT_YARDS) if (inRect(x, y, yard)) return "dirt";
  return "grass";
}

/* ---- the tiles ------------------------------------------------------------ */

/**
 * The atlas: eight frames a row, 64x64 each, with the diamond's base at
 * y 30 (`prepare-stackacres-terrain.py`'s BASE_TOP). Pair p (0 grass-sand,
 * 1 sand-shallow, 2 shallow-deep, 3 grass-dirt) owns sixteen frames from
 * 16p: straight, inside curve and outside curve at rotations 45, 135, 225,
 * 315 in that order, then four plates of the pair's higher material.
 */
export const TERRAIN_ATLAS_COLUMNS = 8;
export const TERRAIN_FRAME = 64;
export const TERRAIN_FRAME_BASE_TOP = 30;
export const TERRAIN_FRAME_DIAMOND_HEIGHT = 32;

const PAIR_GRASS_SAND = 0;
const PAIR_SAND_SHALLOW = 1;
const PAIR_SHALLOW_DEEP = 2;
const PAIR_GRASS_DIRT = 3;

const SHAPE_STRAIGHT = 0;
const SHAPE_CURVE_IN = 1;
const SHAPE_CURVE_OUT = 2;

function transitionFrame(pair: number, shape: number, rotation: number): number {
  return pair * 16 + shape * 4 + rotation;
}

function plateFrame(pair: number, variant: number): number {
  return pair * 16 + 12 + variant;
}

/** The pair whose plate a material draws with. Grass has none: a grass cell
 *  is left to the lawn. */
function plateOf(material: TerrainMaterial, variant: number): number | null {
  switch (material) {
    case "grass":
      return null;
    case "dirt":
      return plateFrame(PAIR_GRASS_DIRT, variant);
    case "sand":
      return plateFrame(PAIR_GRASS_SAND, variant);
    case "shallow":
      return plateFrame(PAIR_SAND_SHALLOW, variant);
    case "deep":
      return plateFrame(PAIR_SHALLOW_DEEP, variant);
  }
}

/**
 * Corner patterns, as (N, E, S, W) flags of where the LOWER material is,
 * mapped to the pack's rotation index. Read off the frames themselves (the
 * pack's own naming says nothing): rotation 45 puts the lower material on
 * the north-east edge for a straight, at the east tip for an outside curve,
 * and everywhere but the west tip for an inside curve, and each step of
 * rotation turns that a quarter turn anticlockwise.
 */
const STRAIGHT: ReadonlyMap<number, number> = new Map([
  [0b1100, 0], // N E
  [0b1001, 1], // N W
  [0b0011, 2], // S W
  [0b0110, 3], // E S
]);
const CURVE_IN: ReadonlyMap<number, number> = new Map([
  [0b1110, 0], // all but W
  [0b1101, 1], // all but S
  [0b1011, 2], // all but E
  [0b0111, 3], // all but N
]);
const CURVE_OUT: ReadonlyMap<number, number> = new Map([
  [0b0100, 0], // E
  [0b1000, 1], // N
  [0b0001, 2], // W
  [0b0010, 3], // S
]);

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Which of a material's four plates a cell draws. Periodic in the chunk
 *  (and in the shore's two-chunk period), so identical chunks stay
 *  identical -- see the header on sharing textures. */
function plateVariant(i: number, j: number): number {
  return (mod(i, TERRAIN_CHUNK_CELLS) * 5 + mod(j, TERRAIN_CHUNK_CELLS * 2) * 3) % 4;
}

/** A lattice cell's north-west corner in world units. */
export function cellOrigin(i: number, j: number): WorldPoint {
  return { x: TERRAIN_ORIGIN.x + i * TERRAIN_CELL, y: TERRAIN_ORIGIN.y + j * TERRAIN_CELL };
}

/** The cell containing a world point. */
export function cellAt(x: number, y: number): { i: number; j: number } {
  return {
    i: Math.floor((x - TERRAIN_ORIGIN.x) / TERRAIN_CELL),
    j: Math.floor((y - TERRAIN_ORIGIN.y) / TERRAIN_CELL),
  };
}

/** How a cell was resolved, for the test that counts the fallbacks. */
export type CellResolution = "plain" | "edge" | "saddle" | "skip";

export interface CellTile {
  frame: number;
  resolution: CellResolution;
}

/**
 * The atlas frame for cell (i, j), or null when the cell is lawn. Corners
 * are sampled in screen order -- N is the world north-west corner, E the
 * north-east, S the south-east, W the south-west -- which is the order the
 * rotation tables above are written in.
 */
export function cellTile(i: number, j: number): CellTile | null {
  const o = cellOrigin(i, j);
  const x1 = o.x + TERRAIN_CELL;
  const y1 = o.y + TERRAIN_CELL;
  const corners: TerrainMaterial[] = [
    terrainMaterialAt(o.x, o.y),
    terrainMaterialAt(x1, o.y),
    terrainMaterialAt(x1, y1),
    terrainMaterialAt(o.x, y1),
  ];
  let levels: number[] = corners.map((m) => LEVEL[m]);
  // Dirt only ever pairs with grass. Where a road runs into the beach the
  // cell is drawn as sand -- the road turns to shore, which is what a track
  // down to the water does.
  const sandy = corners.some((m) => m === "sand");
  const dirty = !sandy && corners.some((m) => m === "dirt");
  const lo = Math.min(...levels);
  let hi = Math.max(...levels);
  const variant = plateVariant(i, j);

  if (lo === hi) {
    const plate = plateOf(dirty ? "dirt" : corners[0], variant);
    return plate === null ? null : { frame: plate, resolution: "plain" };
  }

  let resolution: CellResolution = "edge";
  if (hi > lo + 1) {
    levels = levels.map((l) => Math.min(l, lo + 1));
    hi = lo + 1;
    resolution = "skip";
  }
  const pair = lo === 0 && dirty ? PAIR_GRASS_DIRT : lo === 0 ? PAIR_GRASS_SAND : lo === 1 ? PAIR_SAND_SHALLOW : PAIR_SHALLOW_DEEP;
  const mask = (levels[0] === lo ? 8 : 0) | (levels[1] === lo ? 4 : 0) | (levels[2] === lo ? 2 : 0) | (levels[3] === lo ? 1 : 0);
  const straight = STRAIGHT.get(mask);
  if (straight !== undefined) return { frame: transitionFrame(pair, SHAPE_STRAIGHT, straight), resolution };
  const curveIn = CURVE_IN.get(mask);
  if (curveIn !== undefined) return { frame: transitionFrame(pair, SHAPE_CURVE_IN, curveIn), resolution };
  const curveOut = CURVE_OUT.get(mask);
  if (curveOut !== undefined) return { frame: transitionFrame(pair, SHAPE_CURVE_OUT, curveOut), resolution };

  // A saddle: the lower material at two opposite corners. The centre says
  // which of the two the cell is mostly, and it draws as that plate.
  const centre = LEVEL[terrainMaterialAt(o.x + TERRAIN_CELL / 2, o.y + TERRAIN_CELL / 2)];
  const material: TerrainMaterial =
    centre <= lo ? (lo === 0 ? "grass" : lo === 1 ? (dirty ? "dirt" : "sand") : lo === 2 ? "shallow" : "deep")
    : hi === 1 ? (dirty ? "dirt" : "sand") : hi === 2 ? "shallow" : "deep";
  const plate = plateOf(material, variant);
  return plate === null ? null : { frame: plate, resolution: "saddle" };
}

/* ---- the chunks ------------------------------------------------------------ */

/** The world the terrain is generated over. West it runs a little past the
 *  camera's wall (`worldBoundsRect`: x -860..592, y -560..656); east it
 *  stops at `SEA_TILES_EAST`, where the open-water images take over. North
 *  and south the shore is tiled far past the wall: the camera's box is the
 *  projected rect's box, which reaches world y about -1300 at a corner, and
 *  a wide desktop window at the minimum zoom sees several hundred units
 *  past even that (a view larger than the bounds is not clamped, it
 *  overhangs them to the east and south). Off the coast the extra chunks are
 *  all lawn and cost nothing; along it they are the same two textures over
 *  and over. */
export const TERRAIN_SCAN: WorldRect = { x: -904, y: -2024, width: SEA_TILES_EAST + 904, height: 4048 };

export interface TerrainTile {
  /** Cell offsets from the chunk's own first cell; -1 and
   *  `TERRAIN_CHUNK_CELLS` are the apron (see `terrainChunks`). */
  di: number;
  dj: number;
  frame: number;
}

export interface TerrainChunk {
  cx: number;
  cy: number;
  /** Content hash: two chunks with the same key draw the same picture. */
  key: string;
  tiles: readonly TerrainTile[];
}

/** The chunk's own 7x7 cells, in world units. */
export function terrainChunkWorldRect(cx: number, cy: number): WorldRect {
  const o = cellOrigin(cx * TERRAIN_CHUNK_CELLS, cy * TERRAIN_CHUNK_CELLS);
  return { x: o.x, y: o.y, width: TERRAIN_CHUNK, height: TERRAIN_CHUNK };
}

/** The screen box the chunk's cells project to, without the overhang: what
 *  the baked canvas covers below its top `TERRAIN_OVERHANG` units. */
export function terrainChunkScreenRect(cx: number, cy: number): WorldRect {
  return projectedBounds(terrainChunkWorldRect(cx, cy));
}

/** Where a tile's frame goes, in screen units relative to the chunk's
 *  screen rect's top-left corner (before the overhang is added): the cell's
 *  projected centre, less the diamond centre's offset inside the frame at
 *  half a screen unit per frame pixel. */
export function tileFrameOffset(chunk: TerrainChunk, tile: TerrainTile): WorldPoint {
  const rect = terrainChunkScreenRect(chunk.cx, chunk.cy);
  const o = cellOrigin(chunk.cx * TERRAIN_CHUNK_CELLS + tile.di, chunk.cy * TERRAIN_CHUNK_CELLS + tile.dj);
  const centre = isoProject(o.x + TERRAIN_CELL / 2, o.y + TERRAIN_CELL / 2);
  const half = TERRAIN_FRAME / 4;
  const diamondCentreY = (TERRAIN_FRAME_BASE_TOP + TERRAIN_FRAME_DIAMOND_HEIGHT / 2) / 2;
  return { x: centre.x - rect.x - half, y: centre.y - rect.y - diamondCentreY };
}

function hashTiles(tiles: readonly TerrainTile[]): string {
  let h = 2166136261;
  for (const t of tiles) {
    h = Math.imul(h ^ (t.di + 2), 16777619);
    h = Math.imul(h ^ (t.dj + 2), 16777619);
    h = Math.imul(h ^ t.frame, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

let chunksMemo: readonly TerrainChunk[] | null = null;

/**
 * Every chunk with something to draw, with its tiles. A chunk carries an
 * APRON: the ring of neighbouring cells around its own 7x7, since a
 * neighbour's diamond overlaps the chunk's rectangular screen box at the
 * corners. Baking those into the chunk too is what keeps the box opaque up
 * to its edge, so two chunks meet with no seam even when the textures are
 * minified. Tiles are listed north-to-south in screen order, which is the
 * order they must be drawn in: a tile's blades overhang the row above it.
 */
export function terrainChunks(): readonly TerrainChunk[] {
  if (chunksMemo) return chunksMemo;
  const first = cellAt(TERRAIN_SCAN.x, TERRAIN_SCAN.y);
  const last = cellAt(TERRAIN_SCAN.x + TERRAIN_SCAN.width, TERRAIN_SCAN.y + TERRAIN_SCAN.height);
  const cx0 = Math.floor(first.i / TERRAIN_CHUNK_CELLS);
  const cy0 = Math.floor(first.j / TERRAIN_CHUNK_CELLS);
  const cx1 = Math.floor(last.i / TERRAIN_CHUNK_CELLS);
  const cy1 = Math.floor(last.j / TERRAIN_CHUNK_CELLS);
  const frames = new Map<string, number | null>();
  const frameAt = (i: number, j: number): number | null => {
    if (i < first.i || i > last.i || j < first.j || j > last.j) return null;
    const key = `${i}:${j}`;
    const cached = frames.get(key);
    if (cached !== undefined) return cached;
    const tile = cellTile(i, j);
    const frame = tile ? tile.frame : null;
    frames.set(key, frame);
    return frame;
  };
  const chunks: TerrainChunk[] = [];
  for (let cy = cy0; cy <= cy1; cy += 1) {
    for (let cx = cx0; cx <= cx1; cx += 1) {
      const tiles: TerrainTile[] = [];
      let own = false;
      for (let dj = -1; dj <= TERRAIN_CHUNK_CELLS; dj += 1) {
        for (let di = -1; di <= TERRAIN_CHUNK_CELLS; di += 1) {
          const frame = frameAt(cx * TERRAIN_CHUNK_CELLS + di, cy * TERRAIN_CHUNK_CELLS + dj);
          if (frame === null) continue;
          const inside = di >= 0 && di < TERRAIN_CHUNK_CELLS && dj >= 0 && dj < TERRAIN_CHUNK_CELLS;
          if (inside) own = true;
          tiles.push({ di, dj, frame });
        }
      }
      if (!own) continue;
      // Screen order: rows of constant (di + dj) top to bottom, and within a
      // row left to right, which is decreasing dj.
      tiles.sort((a, b) => a.di + a.dj - (b.di + b.dj) || b.dj - a.dj);
      chunks.push({ cx, cy, key: hashTiles(tiles), tiles });
    }
  }
  chunksMemo = chunks;
  return chunks;
}
