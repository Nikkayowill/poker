/**
 * Where the things standing on unclaimed land actually stand.
 *
 * lib/stackacres/land-clearing.ts deals the obstacles -- how many, of what
 * kind, on which sector -- and the server tracks each one's swings. It
 * deliberately does not know a single coordinate, because the only thing
 * that knows which tiles are free is the map: the area's own blocked list
 * plus whatever props are standing on it.
 *
 * So this file is the other half. Hand it a field (tile grid, blocked tiles,
 * the strips to leave alone, and where the farmer walks in) and the sector's
 * obstacle list, and it deals every obstacle a tile, the same seeded,
 * deterministic way the obstacle list itself was dealt: the Fold looks the
 * same on every device and after every reload, without a single position
 * being stored anywhere.
 *
 * TWO RULES IT WILL NOT BREAK, because a field that breaks either is not
 * playable: every obstacle can be walked up to, and no obstacle seals
 * anything off behind it. Both are checked against the real maps in
 * ./land-obstacles.test.ts.
 *
 * Pure and renderer-free, same split the rest of lib/stackacres-td keeps.
 */

import type { LandObstacle } from "@/lib/stackacres/land-clearing";
import { seededRandom, type WorldRect } from "@/lib/stackacres/world";
import { tileKey } from "./movement";

interface Tile {
  readonly tx: number;
  readonly ty: number;
}

/** The ground an obstacle may be dealt onto. */
export interface LandField {
  /** Tiles across and down, and how big one is in world px. */
  readonly width: number;
  readonly height: number;
  readonly tile: number;
  /** Tiles already taken: the area's own blocked list plus standing props. */
  readonly blocked: ReadonlySet<string>;
  /** Strips to leave open whatever else happens -- a doorway, the tile the
   *  farmer walks in on. Nothing is dealt onto one. */
  readonly keepClear: readonly WorldRect[];
  /** The tile the farmer arrives on. Everything is dealt, and every
   *  reachability rule judged, from here. */
  readonly from: Tile;
}

export interface LandObstaclePlacement {
  readonly id: string;
  readonly kind: LandObstacle["kind"];
  /** Tile it stands on, which is also the tile it blocks while it stands. */
  readonly tx: number;
  readonly ty: number;
  /** World px of its base point: the middle of the tile, on its bottom edge,
   *  which is where every prop in an area is anchored. */
  readonly x: number;
  readonly y: number;
}

/** Tiles an obstacle keeps between itself and the next one, so a field reads
 *  as scattered growth rather than a hedge. Relaxed a step at a time when a
 *  field is too tight to seat everything (see `dealLandObstacles`). */
const SPACINGS = [2, 1] as const;

/** Tiles of margin left around the outside of an area: its edge strip is
 *  treeline and fence in every drawn area, and an obstacle dealt into it
 *  would sit half off the map. */
const EDGE_MARGIN = 1;

/** The eight ways the farmer walks (lib/stackacres-td/movement.ts). */
const STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function intersects(rect: WorldRect, x: number, y: number, tile: number): boolean {
  return x + tile > rect.x && x < rect.x + rect.width && y + tile > rect.y && y < rect.y + rect.height;
}

/** How many tiles the farmer can still walk to with `standing` in his way.
 *  Eight-way and refusing to cut a blocked corner, exactly as `findPath`
 *  walks him, so this counts the same ground the game does. */
function reach(field: LandField, standing: ReadonlySet<string>): Set<string> {
  const open = (tx: number, ty: number) =>
    tx >= 0 &&
    ty >= 0 &&
    tx < field.width &&
    ty < field.height &&
    !field.blocked.has(tileKey(tx, ty)) &&
    !standing.has(tileKey(tx, ty));
  const seen = new Set<string>();
  if (!open(field.from.tx, field.from.ty)) return seen;
  seen.add(tileKey(field.from.tx, field.from.ty));
  const queue: Tile[] = [field.from];
  for (let head = 0; head < queue.length; head += 1) {
    const { tx, ty } = queue[head];
    for (const [dx, dy] of STEPS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!open(nx, ny) || seen.has(tileKey(nx, ny))) continue;
      if (dx !== 0 && dy !== 0 && (!open(tx + dx, ty) || !open(tx, ty + dy))) continue;
      seen.add(tileKey(nx, ny));
      queue.push({ tx: nx, ty: ny });
    }
  }
  return seen;
}

/** Every tile an obstacle could stand on: inside the margin, not already
 *  taken, not on a strip that has to stay open, and somewhere the farmer can
 *  actually get to. Ground he cannot reach is ground he cannot clear. */
function candidateTiles(field: LandField): Tile[] {
  const walkable = reach(field, new Set());
  const out: Tile[] = [];
  for (let ty = EDGE_MARGIN; ty < field.height - EDGE_MARGIN; ty += 1) {
    for (let tx = EDGE_MARGIN; tx < field.width - EDGE_MARGIN; tx += 1) {
      if (!walkable.has(tileKey(tx, ty))) continue;
      const x = tx * field.tile;
      const y = ty * field.tile;
      if (field.keepClear.some((rect) => intersects(rect, x, y, field.tile))) continue;
      out.push({ tx, ty });
    }
  }
  return out;
}

/**
 * Seats every obstacle it can on the field, in the order it was given.
 *
 * Greedy rather than clever: walk a shuffled list of reachable tiles and take
 * the first that is far enough from everything already seated AND that shuts
 * nothing in behind it -- a candidate is only accepted when standing there
 * costs the farmer exactly the one tile it covers. That is what keeps a
 * boulder out of a one-tile gap in a fence.
 *
 * When the field runs out of room at one spacing it starts over a step
 * tighter, so a small field ends up crowded rather than half empty: an
 * obstacle nobody can find is an obstacle the sector never opens without.
 */
export function dealLandObstacles(
  obstacles: readonly LandObstacle[],
  field: LandField,
  seed: number,
): LandObstaclePlacement[] {
  if (obstacles.length === 0) return [];
  const tiles = candidateTiles(field);
  const last = SPACINGS[SPACINGS.length - 1];

  for (const spacing of SPACINGS) {
    const random = seededRandom(seed);
    const shuffled = [...tiles];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const taken: LandObstaclePlacement[] = [];
    const standing = new Set<string>();
    let open = reach(field, standing).size;
    for (const { tx, ty } of shuffled) {
      if (taken.length === obstacles.length) break;
      if (taken.some((p) => Math.abs(p.tx - tx) <= spacing && Math.abs(p.ty - ty) <= spacing)) continue;
      standing.add(tileKey(tx, ty));
      const left = reach(field, standing).size;
      if (left !== open - 1) {
        standing.delete(tileKey(tx, ty));
        continue;
      }
      open = left;
      const obstacle = obstacles[taken.length];
      taken.push({
        id: obstacle.id,
        kind: obstacle.kind,
        tx,
        ty,
        x: tx * field.tile + field.tile / 2,
        y: ty * field.tile + field.tile,
      });
    }
    if (taken.length === obstacles.length || spacing === last) return taken;
  }
  return [];
}

/**
 * The boulder and the scrub, from the LPC terrain pack
 * (art/stackacres-td/lpc/terrain/terrain_atlas.png, CC-BY-SA 3.0 / GPL 3.0,
 * credited in its Attribution.txt), cut into public/stackacres-td/common/.
 * Drawn at half size like every pack piece: the pack is 32px a tile, the map
 * 16. Trees are still the area's own, off its atlas.
 */
export const LAND_ART_SCALE = 0.5;
const LAND_ART: Readonly<Record<"boulder" | "scrub", readonly string[]>> = {
  boulder: ["land-boulder-0", "land-boulder-1"],
  scrub: ["land-scrub"],
};
export const LAND_TEXTURES: readonly string[] = [...LAND_ART.boulder, ...LAND_ART.scrub];

/** Which picture a boulder or a scrub stands as, picked by its id so it is the same one on every device. */
export function landTexture(kind: "boulder" | "scrub", id: string): string {
  const pool = LAND_ART[kind];
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length];
}
