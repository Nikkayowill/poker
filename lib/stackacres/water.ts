/**
 * Where the water is.
 *
 * Pure layout: the pond on the farm's west verge, the dock reaching out over
 * it, and the fixed decor -- lily pads, reeds, where the ripples spread and
 * the loop the duck paddles -- all in world units, plus the one question the
 * open world asks of it: "is this point in the pond's clearing?", so no wild
 * tree grows out of the water.
 *
 * The pond sits WEST of the lane, inside the opening shot: the home view
 * frames roughly x -88..536, y -72..184 on a phone, the DOM chrome covers the
 * right ~160 units (toolbelt, seed strip) and the top-left corner (title
 * chip, y < -41), and the west verge is the one region left clear. Water
 * there is the frame's second colour family against a lawn that is otherwise
 * one green.
 *
 * Types only from ./world. This module is imported BY world.ts (for
 * `chunkScenery`), so a runtime import back of any of its constants would be
 * read before world.ts has finished evaluating and throw. Every number here
 * is therefore a literal: the lane's body is x 43..57 (centre 50, width 14),
 * the plot square is x 64..384, y 64..384, and nothing below may touch
 * either.
 */

import type { WorldPoint, WorldRect } from "./world";

export interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** The water's edge: an ellipse spanning x -84..20, y 80..160. */
export const POND: Ellipse = { x: -32, y: 120, rx: 52, ry: 40 };

/** How far the sand ring runs out past the water, in units. */
export const POND_SAND = 7;

/** How far the open world keeps its scenery off the water, past the ellipse. */
export const POND_CLEARANCE = 22;

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

export function inPond(x: number, y: number, pond: Ellipse = POND): boolean {
  return pondRadial(x, y, pond) < 1;
}

/**
 * The dock, anchored at its EAST end (the end on the sand) and reaching
 * WEST out over the water. 34 units of deck: at y 100..114 the water's edge
 * is x 13..19, so the first five or six units of deck stand on the sand and
 * the rest is over water, which is what makes it read as a pier root rather
 * than a raft. The spur path off the lane meets it here.
 */
export const DOCK: WorldPoint = { x: 24, y: 118 };
export const DOCK_LENGTH = 34;
export const DOCK_DEPTH = 18;

/** The deck's box in world units, for keeping decor off it. */
export function dockRect(): WorldRect {
  return { x: DOCK.x - DOCK_LENGTH, y: DOCK.y - DOCK_DEPTH, width: DOCK_LENGTH, height: DOCK_DEPTH };
}

/** How close to the dock a lily pad may float. */
export const LILY_DOCK_CLEARANCE = 14;

/** Lily pads, on the water, well away from the dock and from each other.
 *  Two of them carry a flower. */
export const LILY_PADS: readonly (WorldPoint & { flower: boolean })[] = [
  { x: -62, y: 116, flower: true },
  { x: -52, y: 132, flower: false },
  { x: -30, y: 144, flower: true },
  { x: -72, y: 128, flower: false },
  { x: -58, y: 100, flower: false },
];

/** Reeds, feet on the sand at the water's edge: a stand along the north
 *  shore and another at the south-west. */
export const REEDS: readonly WorldPoint[] = [
  { x: -46, y: 80 },
  { x: -23, y: 79 },
  { x: -5, y: 84 },
  { x: -73, y: 147 },
  { x: -83, y: 134 },
  { x: -59, y: 156 },
  { x: -5, y: 156 },
];

/** Where the ripples spread from: one by the dock's posts, two out on the
 *  water. */
export const RIPPLE_SPOTS: readonly WorldPoint[] = [
  { x: -14, y: 116 },
  { x: -36, y: 120 },
  { x: -64, y: 140 },
];

/** The loop the duck paddles, on the open water north of the lilies. */
export const DUCK_ORBIT: Ellipse = { x: -30, y: 100, rx: 14, ry: 5 };

/**
 * The world rectangle the pond's texture covers: the ellipse, the sand ring,
 * the sand's wobble and the seam it feathers into the lawn with, padded so
 * the feather never meets the texture's edge.
 */
export const POND_BAKE_PADDING = POND_SAND + 8;

export function pondBounds(): WorldRect {
  const pad = POND_BAKE_PADDING;
  return {
    x: Math.floor(POND.x - POND.rx - pad),
    y: Math.floor(POND.y - POND.ry - pad),
    width: Math.ceil((POND.rx + pad) * 2),
    height: Math.ceil((POND.ry + pad) * 2),
  };
}
