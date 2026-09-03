/**
 * Where the farm's dirt paths run.
 *
 * Pure layout: a handful of polylines in world units, and the one question the open
 * world asks of them -- "is this point on or beside a path?" -- so wild
 * scenery never grows across the road. The renderer (components/arcade/
 * stackacres/art-paths.ts) smooths and wobbles these into the strips the
 * player sees; the polylines here are what the exclusion is measured from,
 * and a smoothed curve always stays inside its own polyline's corners, so a
 * margin on the polyline covers the drawn strip too.
 *
 * Types only from ./world. This module is imported BY world.ts (for
 * `chunkScenery`), so a runtime import back of any of its constants would be
 * read before world.ts has finished evaluating and throw. Every number here
 * is therefore a literal: plots occupy x 64..384, y 64..384 (four 80-unit
 * cells from STACKACRES_MARGIN 64), the barn's feet are on y 34 with its door
 * centred on x 108, and nothing below may touch the plot square.
 */

import type { WorldPoint, WorldRect } from "./world";

export interface PathSpec {
  /** Texture key suffix and the seed for this path's wobble. */
  key: string;
  /** Body width in world units, 10..20. */
  width: number;
  /** The polyline, in world units. The renderer smooths it through the
   *  midpoints of its segments, so a vertex is a control point, not a place
   *  the drawn path passes through exactly. */
  points: readonly WorldPoint[];
  /**
   * Which side the row of cream parcel stones runs down: +1 is the right-hand
   * side facing along the path (the west of a leg heading south, the south of
   * a leg heading east), -1 the left, 0 no stones at all.
   */
  stones: -1 | 0 | 1;
  /**
   * Arc length along the path, in world units, before which no stone is laid.
   * The lane's first legs run along the barn's foot and its stones there read
   * as a clutch of eggs against the wall; the row starts after the corner.
   */
  stonesFrom?: number;
}

/** How far past a path's own edge scenery is kept off, in world units. */
export const PATH_CLEARANCE = 6;

/**
 * The paths.
 *
 * `lane`: out of the barn door, a short leg south, then west and down the
 * verge between the plots and the woods, ending where the mailbox will stand.
 * At x 50 its body spans 43..57 and its damp rim 40..60: clear of the plot
 * square at 64, with the lamp posts standing on its west verge.
 *
 * `road`: from the lane's corner east along the front of the barn yard at
 * y 46 (body 38..54; the barn's feet are on 34), then curving north-east out
 * of the home frame, so the map invites a pan. It starts inside the lane's
 * body so the two read as one T-junction, not two strips near each other.
 *
 * `track`: the way out of the farm, forking off the lane's corner north-west
 * into the woods. Narrower; a track, not a road.
 *
 * `spur`: a few steps west off the lane to the dock on the pond (see
 * ./water.ts): it starts inside the lane's body and ends on the sand beside
 * the dock's root, where the pond's own art paints over its end cap. Last,
 * so the lane it branches off is already under it and the junction repaint
 * in the renderer covers it like the road's and the track's.
 *
 * `meadowLane` and `oxRoad`: the two connectors out to the districts in
 * ./zones.ts, each documented at its own entry below.
 */
export const FARM_PATHS: readonly PathSpec[] = [
  {
    key: "lane",
    width: 14,
    points: [
      { x: 108, y: 36 },
      { x: 108, y: 50 },
      { x: 70, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 70 },
      { x: 50, y: 402 },
    ],
    stones: 1,
    stonesFrom: 88,
  },
  {
    key: "road",
    width: 16,
    points: [
      { x: 108, y: 46 },
      { x: 150, y: 47 },
      { x: 300, y: 46 },
      { x: 380, y: 48 },
      { x: 430, y: 44 },
      { x: 468, y: 20 },
      { x: 496, y: -16 },
      { x: 520, y: -60 },
    ],
    stones: 0,
  },
  {
    key: "track",
    width: 12,
    points: [
      { x: 60, y: 46 },
      { x: 20, y: -14 },
      { x: -40, y: -120 },
      { x: -90, y: -190 },
      { x: -140, y: -260 },
    ],
    stones: -1,
  },
  {
    key: "spur",
    width: 12,
    points: [
      { x: 50, y: 118 },
      { x: 26, y: 118 },
    ],
    stones: 0,
  },

  /*
   * The two connectors to the outer districts (see ./zones.ts). Both start
   * INSIDE an existing path's body so the junction reads as a fork rather
   * than as two strips that happen to nearly touch -- the same trick the
   * road and the track already play on the lane -- and both are listed after
   * the path they leave, so the renderer's junction repaint covers them.
   *
   * They are separate specs rather than extra points on `lane` and `road`
   * for a reason worth keeping: `pathBounds` pads a spec's whole polyline
   * box into one baked texture, and paths.test.ts holds that box under 2048
   * px a side at 4 px per unit. Carrying the road all the way to the ox
   * fields on one polyline would span ~730 units and blow straight through
   * that ceiling; two shorter bakes cost one draw call each and stay well
   * inside it.
   *
   * `wallow` gets no connector at all: the track already ends at (-140,
   * -260), which is inside the Wallow's own eastern corner. The road that
   * was already there arrives -- it just had nothing to arrive at.
   */
  {
    // Out of the lane's end at the mailbox, south into the Long Meadow.
    // Starts at y 394 (the lane's body runs to 402) and never touches the
    // plot square, which ends at y 384.
    key: "meadowLane",
    width: 12,
    points: [
      { x: 50, y: 394 },
      { x: 56, y: 460 },
      { x: 78, y: 520 },
      { x: 120, y: 566 },
      { x: 176, y: 600 },
    ],
    stones: 0,
  },
  {
    // Forks off the road where it turns north-east (430, 44) and carries on
    // east instead, ending at the Ox Fields' gate. The road's own north-east
    // leg is deliberately left running off the map: a world that visibly
    // continues past its last destination is the point of an open map.
    key: "oxRoad",
    width: 14,
    points: [
      { x: 426, y: 45 },
      { x: 470, y: 70 },
      { x: 520, y: 96 },
      { x: 580, y: 120 },
      { x: 640, y: 150 },
    ],
    stones: -1,
    stonesFrom: 60,
  },
];

function segmentDistance(px: number, py: number, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

/** Distance from a point to the nearest segment of a path's polyline. */
export function distanceToPath(x: number, y: number, spec: PathSpec): number {
  let best = Infinity;
  const points = spec.points;
  for (let i = 1; i < points.length; i += 1) {
    const d = segmentDistance(x, y, points[i - 1], points[i]);
    if (d < best) best = d;
  }
  return best;
}

/** True within a path's body plus PATH_CLEARANCE either side. Cheap: six
 *  polylines, a couple of dozen segments in all, called once per scenery
 *  candidate. */
export function nearPath(x: number, y: number): boolean {
  for (const spec of FARM_PATHS) {
    if (distanceToPath(x, y, spec) < spec.width / 2 + PATH_CLEARANCE) return true;
  }
  return false;
}

/** Padding a path's bake needs around its polyline: the damp rim, its blur
 *  and the parcel stones all sit outside the body, and the wobble adds two. */
export function pathBakePadding(spec: PathSpec): number {
  return spec.width / 2 + 10;
}

/** The world rectangle a path's texture covers: its polyline's box, padded. */
export function pathBounds(spec: PathSpec): WorldRect {
  const pad = pathBakePadding(spec);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of spec.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    x: Math.floor(minX - pad),
    y: Math.floor(minY - pad),
    width: Math.ceil(maxX - minX + pad * 2),
    height: Math.ceil(maxY - minY + pad * 2),
  };
}
