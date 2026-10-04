/**
 * Where the water is.
 *
 * Pure layout: the pond on the farm's west verge, the dock reaching out over
 * it, and the fixed decor -- lily pads, reeds, where the ripples spread and
 * the loop the duck paddles -- all in world units, plus the one question the
 * open world asks of it: "is this point in the pond's clearing?", so no wild
 * tree grows out of the water.
 *
 * The pond is DRAWN by ./terrain.ts, as tiles: the ellipse here is the
 * waterline it cuts the pack's shallow-water and sand tiles to, with
 * `POND_SHALLOW` of shallows inside it and `POND_SAND` of beach around it.
 * The decor is placed against the same ellipse, so a reed stands on the
 * sand and a lily floats on the water whichever way the tiles round it.
 *
 * The pond sits WEST of the lane, just outside the yard's own rect, in the
 * clearing `POND_ZONE` keeps for it. Its sand ring runs to within about
 * fifteen units of the lane's body, and the dock spur off the lane
 * (./paths.ts) reaches onto that sand beside the dock's root.
 *
 * Types only from ./world. This module is imported BY world.ts (through
 * ./terrain.ts, for `chunkScenery`), so a runtime import back of any of its
 * constants would be read before world.ts has finished evaluating and
 * throw. Every number here is therefore a literal in the yard's frame: the
 * lane's body is x 43..57 (centre 50, width 14), and nothing below may
 * touch it.
 */

import type { WorldPoint, WorldRect } from "./world";
// A strict leaf (./yard.ts imports nothing), so this is a plain value import
// with no cycle to work around. Carries the Farmstead yard's offset: the
// literals below are in the frame the yard was originally laid out in.
import { yardPoint, } from "./yard";

export interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** The waterline: an ellipse spanning x -92..4, y 80..160 in the yard's
 *  frame. Sized so that the sand ring, the shallows and a patch of deep
 *  water in the middle each get at least a tile's width. */
export const POND: Ellipse = { ...yardPoint(-44, 120), rx: 48, ry: 40 };

/** How far the sand runs out past the waterline, in units. */
export const POND_SAND = 22;

/** How far in from the waterline the shallows reach before the deep
 *  middle, in units. */
export const POND_SHALLOW = 24;

/** How far the open world keeps its scenery off the water, past the
 *  ellipse: the sand and a few units of bank. */
export const POND_CLEARANCE = 30;

/** The pond's clearing: the ellipse's box padded by POND_CLEARANCE, so a
 *  canopy at the edge of the zone still never leans over the sand. */
export const POND_ZONE: WorldRect = {
  x: POND.x - POND.rx - POND_CLEARANCE,
  y: POND.y - POND.ry - POND_CLEARANCE,
  width: (POND.rx + POND_CLEARANCE) * 2,
  height: (POND.ry + POND_CLEARANCE) * 2,
};

export function inPondZone(x: number, y: number): boolean {
  return (
    x >= POND_ZONE.x &&
    x <= POND_ZONE.x + POND_ZONE.width &&
    y >= POND_ZONE.y &&
    y <= POND_ZONE.y + POND_ZONE.height
  );
}

/**
 * A point's distance from the pond's centre, as a fraction of the ellipse:
 * under 1 is water, 1 the waterline, a little over 1 the sand.
 */
export function pondRadial(x: number, y: number, pond: Ellipse = POND): number {
  const dx = (x - pond.x) / pond.rx;
  const dy = (y - pond.y) / pond.ry;
  return Math.hypot(dx, dy);
}

/**
 * The dock, anchored at its EAST end (the end on the sand) and reaching
 * WEST out over the water. 34 units of deck: at y 118 the waterline is at
 * x 4, so the first eight units of deck stand on the sand and the rest is
 * over water, which is what makes it read as a pier root rather than a
 * raft. The spur path off the lane meets it here.
 */
export const DOCK: WorldPoint = yardPoint(12, 118);
export const DOCK_LENGTH = 34;

/** Where a cast lands: open water off the dock's end, past the shallows so
 *  the ripple reads as a real cast rather than a splash at your own feet.
 *  `pondRadial` here is under .4 -- inside the deep middle, well short of
 *  the waterline at 1. */
export const FISHING_SPOT: WorldPoint = yardPoint(-28, 118);

