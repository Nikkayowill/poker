/**
 * Fences the player builds on the Homestead.
 *
 * The map used to come with its fences drawn on: rails round the Crop Fields
 * and round Hen Haven. They are gone from the art, and a fence is now
 * something the player puts up, one piece a square, with the Fence on the tool
 * belt. Each piece costs Wood and gives it all back when it is pulled up, so a
 * layout is never a mistake you pay for twice.
 *
 * A PIECE GOES WHERE A BED COULD. Open grass with nothing standing on it
 * (./hoeable.ts), and never on a bed. That keeps fences off the roads, the
 * doors, the water and every building, without a second list of places to
 * keep in step with the map.
 *
 * GOLD: none. Fences take Wood and return Wood; no Gold enters or leaves.
 *
 * Squares are Homestead MAP tiles (16 units), the same squares the farmer
 * walks, not soil tiles. Pure: the server and the scene both import this.
 */

import { isHoeableMapTile } from "./hoeable";

/** Wood one piece takes, and gives back when it comes up. */
export const FENCE_WOOD_COST = 2;

/** How many pieces one farm may stand. Mirrors `place_homestead_fence`'s own cap argument. */
export const FENCE_CAP = 240;

export interface FencePiece {
  readonly tx: number;
  readonly ty: number;
}

export function fenceKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/** Whether a piece may go on this map square, before beds and what the farm already has. */
export function isFenceableMapTile(tx: number, ty: number): boolean {
  return isHoeableMapTile(tx, ty);
}

/**
 * Which picture a piece is drawn with: one bit per neighbour it joins.
 *
 * Every piece is a post, with rails out to the west and east halves of its
 * square when there is a piece next door that way, and a rail up to the post
 * above when there is one there. Nothing draws downward: the piece below draws
 * its own rail up, so a join is never drawn twice.
 */
export const FENCE_JOIN_NORTH = 1;
export const FENCE_JOIN_EAST = 2;
export const FENCE_JOIN_WEST = 4;
export const FENCE_FRAMES = 8;

export function fenceFrame(pieces: ReadonlySet<string>, tx: number, ty: number): number {
  return (
    (pieces.has(fenceKey(tx, ty - 1)) ? FENCE_JOIN_NORTH : 0) |
    (pieces.has(fenceKey(tx + 1, ty)) ? FENCE_JOIN_EAST : 0) |
    (pieces.has(fenceKey(tx - 1, ty)) ? FENCE_JOIN_WEST : 0)
  );
}

export const FENCE_NEEDS_WOOD = `A fence piece takes ${FENCE_WOOD_COST} Wood.`;
export const FENCE_FULL = `That's as much fence as one farm can stand (${FENCE_CAP} pieces).`;
export const FENCE_NOT_HERE = "Fences go on open grass.";
