/**
 * The isometric camera: a pure projection between the StackAcres's true
 * Cartesian world (everything in ./world.ts -- plot squares, animal walk
 * boxes, scenery chunks) and the diamond-tiled screen space the scene
 * actually draws into.
 *
 * Nothing in ./world.ts changes for this: a plot is still a CELL-square in
 * plain (x, y), `plotIndexAt` still does a plain divide, `stepCritter` still
 * walks a rectangle. This module is the seam -- every position handed to
 * Phaser goes through `isoProject` first, and every position Phaser hands
 * back (a pointer's world point) goes through `isoUnproject` before it is
 * allowed anywhere near a ./world.ts function.
 *
 * The projection is the classic 2:1 isometric shear, chosen and previewed
 * with Kayo before this was built (a slider morphing the old flat camera
 * into this one, at https://claude.ai/code/artifact/7dc4bdfc): a unit
 * square's diamond is twice as wide as it is tall. `ISO_K = 1` keeps the
 * numbers on world.ts's own scale (a shear, not a rescale) rather than
 * introducing a second unit system to keep in sync with ART_SCALE.
 *
 * Projection is linear (no additive offset), which is what makes the rest of
 * the scene simple: projecting a cell's origin and separately projecting a
 * child's cell-local offset and adding the two lands in exactly the same
 * place as projecting their sum directly (`isoProject` is verified additive
 * in iso.test.ts). So a container placed at the projected origin, holding
 * children placed at their own projected local offsets, draws correctly --
 * nothing needs to be projected relative to anything else.
 */

import type { WorldPoint, WorldRect } from "./world";

/** Half the diamond's width per world unit of (gx - gy); the diamond's
 *  height per unit works out to half of this, which is what makes the tile
 *  2:1. Kept as a named scale (not folded into the arithmetic) in case a
 *  future pass wants a flatter or steeper tile without re-deriving the
 *  formula -- see the preview's slider, which swept this exact knob. */
export const ISO_K = 1;

export function isoProject(x: number, y: number): WorldPoint {
  return { x: (x - y) * ISO_K, y: ((x + y) * ISO_K) / 2 };
}

/** Exact inverse of `isoProject` -- see iso.test.ts for the round-trip. */
export function isoUnproject(x: number, y: number): WorldPoint {
  const gy = y / ISO_K - x / (2 * ISO_K);
  const gx = x / ISO_K + gy;
  return { x: gx, y: gy };
}

/**
 * The four corners of a world rect, projected, in screen order: N (top,
 * farthest from camera), E (right), S (bottom, nearest camera), W (left).
 * `S` is always the corner with the largest (x + y) in world space -- the
 * one closest to the viewer -- which is what a building's visible walls and
 * a pen's near fence are drawn against.
 */
export interface DiamondCorners {
  n: WorldPoint;
  e: WorldPoint;
  s: WorldPoint;
  w: WorldPoint;
}

export function projectedCorners(rect: WorldRect): DiamondCorners {
  return {
    n: isoProject(rect.x, rect.y),
    e: isoProject(rect.x + rect.width, rect.y),
    s: isoProject(rect.x + rect.width, rect.y + rect.height),
    w: isoProject(rect.x, rect.y + rect.height),
  };
}

/**
 * The axis-aligned screen-space box a world rect's diamond actually
 * occupies. What camera framing (fit-to-viewport, a tracked plot's DOM
 * anchor rect) needs instead of the rect's own width/height, which is a
 * world-space measurement the diamond does not share.
 */
export function projectedBounds(rect: WorldRect): WorldRect {
  const c = projectedCorners(rect);
  const xs = [c.n.x, c.e.x, c.s.x, c.w.x];
  const ys = [c.n.y, c.e.y, c.s.y, c.w.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The world-space box a screen-space (projected/camera) rect could have come
 * from -- an over-approximation, not an inverse of `projectedBounds`: a
 * rectangle in screen space unprojects to a rotated parallelogram in world
 * space, and this returns that parallelogram's own axis-aligned box. Used
 * only to decide which scenery chunks might be visible, where drawing a
 * chunk or two more than strictly needed is harmless and cheap -- `tendWorld`
 * already prunes with a two-chunk margin for the same reason.
 */
export function unprojectBoundsApprox(rect: WorldRect): WorldRect {
  const corners = [
    isoUnproject(rect.x, rect.y),
    isoUnproject(rect.x + rect.width, rect.y),
    isoUnproject(rect.x + rect.width, rect.y + rect.height),
    isoUnproject(rect.x, rect.y + rect.height),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The scene-space depth key for a world point: the projected y, which is
 * monotonic in (worldX + worldY) by construction, so it is the correct
 * isometric near/far ordering and not just a stand-in for one. `nudge` is a
 * small scene-space tie-breaker for two things anchored at the same point --
 * it is added AFTER projection, never before, because a tie-break has no
 * direction in world space to be projected from.
 *
 * Shared by stackacres-scene.ts's own `depthAt` (a thin private wrapper kept
 * there for its call sites' brevity) and game-juice-manager.ts, which has no
 * scene instance of its own to delegate to -- a juice effect and the crop
 * layer it plays over must use the exact same formula or the effect can draw
 * on the wrong side of something it should pass behind.
 */
export function isoDepthAt(x: number, y: number, nudge = 0): number {
  return isoProject(x, y).y + nudge;
}

/**
 * The two edge directions every diamond tile has, as rotation angles for a
 * sprite that was drawn lying along a world-space axis (a fence rail, a
 * furrow line) and now needs to lie along the matching screen-space edge
 * instead. `alongX` is the angle for anything that ran along world +x (a
 * plot's north and south edges, both parallel); `alongY` is the mirror, for
 * anything that ran along world +y (the east and west edges). Both diamond
 * edges sharing one axis share one angle is not a simplification of the
 * geometry, it is the geometry: `isoProject` sends every +x step to the same
 * screen vector regardless of where it starts.
 */
const EDGE_ANGLE = Math.atan2(ISO_K / 2, ISO_K);
export const ISO_EDGE_ANGLE = { alongX: EDGE_ANGLE, alongY: -EDGE_ANGLE };
