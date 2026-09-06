/**
 * Where the farm's dirt roads and paths run.
 *
 * Pure layout: a handful of polylines in world units, and the one question the open
 * world asks of them -- "is this point on or beside a path?" -- so wild
 * scenery never grows across the road. The renderer (components/arcade/
 * stackacres/art-paths.ts) smooths and wobbles these into the strips the
 * player sees; the polylines here are what the exclusion is measured from,
 * and a smoothed curve always stays inside its own polyline's corners, so a
 * margin on the polyline covers the drawn strip too.
 *
 * Widths follow the tiers in ./roads.ts: a main road (the lane, the road and
 * the two district connectors) is never laid thinner than
 * `ARTERIAL_ROAD_MIN_WIDTH`, two and a half tiles, so it carries real weight
 * on a phone the way Stardew's or Mistria's do; a track is a tile and a
 * half; a service spur to a pen is one tile.
 *
 * Types only from ./world. This module is imported BY world.ts (for
 * `chunkScenery`), so a runtime import back of any of its constants would be
 * read before world.ts has finished evaluating and throw. Every number here
 * is therefore a literal: the Hen Coop block sits at x 170..330, y 200..360,
 * the barn's feet are on y 34 with its door centred on x 108, and nothing
 * below may touch a grow area.
 */

import { roadWidth, type PathTier } from "./roads";
import type { WorldPoint, WorldRect } from "./world";

export interface PathSpec {
  /** Texture key suffix and the seed for this path's wobble. */
  key: string;
  /** Which rung of the road hierarchy this is; sets the width floor. */
  tier: PathTier;
  /** Body width in world units, already held to its tier's floor. */
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

/** A spec with its width evaluated against its tier's floor. */
function path(spec: Omit<PathSpec, "width"> & { width: number }): PathSpec {
  return { ...spec, width: roadWidth(spec.tier, spec.width) };
}

/**
 * The paths.
 *
 * `lane`: out of the barn door as a wide apron, a short leg south, then west
 * and down the verge between the Hen Coop and the woods, ending where the
 * mailbox stands. At x 50 its body spans 30..70 and its feathered mud rim
 * reaches ~24..76: clear of the coop block at 170, with the lamp posts
 * standing on its west verge at x 26.
 *
 * `road`: from the lane's corner east along the front of the barn yard at
 * y 58 (body 38..78; the barn's feet are on 34, so the road's north rim laps
 * the barn's own muddy yard), then curving north-east out of the home frame,
 * so the map invites a pan. It starts inside the lane's body so the two read
 * as one T-junction, not two strips near each other.
 *
 * `track`: the way out of the farm, forking off the lane's corner north-west
 * into the woods. A tier down from the road and the lane; a track, not a
 * road.
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
  path({
    key: "lane",
    tier: "arterial",
    width: 18,
    points: [
      { x: 108, y: 36 },
      { x: 108, y: 58 },
      { x: 70, y: 58 },
      { x: 50, y: 58 },
      { x: 50, y: 78 },
      { x: 50, y: 402 },
    ],
    stones: 1,
    stonesFrom: 100,
  }),
  path({
    key: "road",
    tier: "arterial",
    width: 20,
    points: [
      { x: 108, y: 58 },
      { x: 150, y: 59 },
      { x: 300, y: 58 },
      { x: 380, y: 60 },
      { x: 430, y: 56 },
      { x: 468, y: 32 },
      { x: 496, y: -4 },
      { x: 520, y: -48 },
    ],
    stones: 0,
  }),
  path({
    key: "track",
    tier: "track",
    width: 15,
    points: [
      { x: 60, y: 58 },
      { x: 20, y: -14 },
      { x: -40, y: -120 },
      { x: -90, y: -190 },
      { x: -140, y: -260 },
    ],
    stones: -1,
  }),
  path({
    key: "spur",
    tier: "service",
    width: 12,
    points: [
      { x: 50, y: 118 },
      { x: 26, y: 118 },
    ],
    stones: 0,
  }),

  /*
   * The two connectors to the outer districts (see ./zones.ts). Both start
   * INSIDE an existing path's body so the junction reads as a fork rather
   * than as two strips that happen to nearly touch -- the same trick the
   * road and the track already play on the lane -- and both are listed after
   * the path they leave, so the renderer's junction repaint covers them.
   *
   * They are separate specs rather than extra points on `lane` and `road`
   * for a reason worth keeping: `pathBounds` pads a spec's whole polyline
   * box into one baked texture, and paths.test.ts holds that box's projected
   * footprint under 1024 units a side. Carrying the road all the way to the
   * ox fields on one polyline would span ~730 units and blow straight
   * through that ceiling; two shorter bakes cost one draw call each and stay
   * inside it.
   *
   * `wallow` gets no connector at all: the track already ends at (-140,
   * -260), which is inside the Fold's own eastern corner. The road that
   * was already there arrives -- it just had nothing to arrive at.
   */
  path({
    // Out of the lane's end at the mailbox, south into the Long Meadow.
    // Starts exactly at y 402, the lane's own last vertex, so the two read
    // as one road south rather than a lane and a stub.
    key: "meadowLane",
    tier: "arterial",
    width: 18,
    points: [
      { x: 50, y: 402 },
      { x: 56, y: 460 },
      { x: 78, y: 520 },
      { x: 120, y: 566 },
      { x: 176, y: 600 },
    ],
    stones: 0,
  }),
  path({
    // Forks off the road where it turns north-east (430, 56) and carries on
    // east instead, ending at the Ox Fields' gate. The road's own north-east
    // leg is deliberately left running off the map: a world that visibly
    // continues past its last destination is the point of an open map.
    key: "oxRoad",
    tier: "arterial",
    width: 20,
    points: [
      { x: 426, y: 57 },
      { x: 470, y: 82 },
      { x: 520, y: 108 },
      { x: 580, y: 132 },
      { x: 640, y: 162 },
    ],
    stones: -1,
    stonesFrom: 60,
  }),
];

/** The closest point ON a segment to (px, py), plus how far away it is. The
 *  shared projection every distance/nearest-point question in this file
 *  reduces to: clamp the dot-product parameter to the segment, then measure
 *  straight to that point. */
function nearestPointOnSegment(px: number, py: number, a: WorldPoint, b: WorldPoint): { point: WorldPoint; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, distance: Math.hypot(px - point.x, py - point.y) };
}

/** Distance from a point to the nearest segment of a path's polyline. */
export function distanceToPath(x: number, y: number, spec: PathSpec): number {
  return nearestOnPath(x, y, spec).distance;
}

/** The closest point on a single spec's polyline to (x, y), the distance to
 *  it, and which segment it lies on -- what `generatePathwaysBetweenNodes`
 *  walks a whole network of these to find, and what ./path-junctions.ts
 *  reads the trunk's own direction off. */
export function nearestOnPath(x: number, y: number, spec: PathSpec): { point: WorldPoint; distance: number; segment: number } {
  let best = { point: spec.points[0], distance: Infinity, segment: 0 };
  const points = spec.points;
  for (let i = 1; i < points.length; i += 1) {
    const candidate = nearestPointOnSegment(x, y, points[i - 1], points[i]);
    if (candidate.distance < best.distance) best = { ...candidate, segment: i - 1 };
  }
  return best;
}

/** The closest point on ANY spec in a network to (x, y) -- the anchor a new
 *  connector spur is drawn from. */
function nearestPointOnNetwork(x: number, y: number, network: readonly PathSpec[]): { point: WorldPoint; distance: number } {
  let best: { point: WorldPoint; distance: number } = { point: { x, y }, distance: Infinity };
  for (const spec of network) {
    const candidate = nearestOnPath(x, y, spec);
    if (candidate.distance < best.distance) best = candidate;
  }
  return best;
}

/** True within a path's body plus PATH_CLEARANCE either side. Checked
 *  against `ALL_FARM_PATHS` (the hand-authored six plus whatever
 *  `generatePathwaysBetweenNodes` grew below), not `FARM_PATHS` alone, so a
 *  generated connector keeps wild scenery off itself exactly like a
 *  hand-placed one does. Cheap: eight polylines today, a couple of dozen
 *  segments in all, called once per scenery candidate. */
export function nearPath(x: number, y: number): boolean {
  for (const spec of ALL_FARM_PATHS) {
    if (distanceToPath(x, y, spec) < spec.width / 2 + PATH_CLEARANCE) return true;
  }
  return false;
}

/**
 * A fixed destination `generatePathwaysBetweenNodes` should reach -- the
 * farm's own name for it, and the point on its edge a spur may end at
 * without running into it (see the function's own header for why that
 * matters).
 */
export interface PathwayNode {
  id: string;
  x: number;
  y: number;
}

/**
 * The two Farmstead destinations FARM_PATHS never reached. Every other
 * district got a road the day it was added (see ./zones.ts); the Farmstead's
 * own two working plots did not, because neither existed as a place yet
 * when the lane and the road were laid: the Hen Coop is `./world.ts`'s
 * `GROW_AREA.farmstead` (x 170..330, y 200..360) and the wheat field is
 * `./world.ts`'s `WHEAT_FIELD` (x 348..432, y 140..320) -- restated here as
 * literals for the same import-cycle reason every other coordinate in this
 * file is (see the file header).
 *
 * There is a third destination the brief asks for that has no point to give
 * it: a processing Mill (`./machines.ts`) is a row in `homestead_machines`,
 * not a place on this map -- it has never been placed in world space, so it
 * is not a node here. Wiring one in is a follow-up for whenever the Mill
 * gets a footprint of its own, not a gap in this function.
 *
 * Both points sit just outside their destination's own fenced edge (the
 * approach a connector lands at, not the middle of the pen) -- the same
 * clearance `nearPath`'s own "off every grow area's corners and centre"
 * invariant holds every hand-authored path to, checked by hand against
 * `SERVICE_PATH_WIDTH` rather than left to come out right by luck:
 *   henCoop:    20 units clear of the Hen Coop's own north edge (y 200),
 *               and inside the coop's own muddy yard mat (world.ts's
 *               `YARD_MATS`), so the spur ends in mud rather than on grass.
 *   wheatField: 20 units clear of the wheat field's own north edge (y 140),
 *               and clear of the scarecrow's footprint (x 392..412) on top.
 */
export const FARMSTEAD_PATH_NODES: readonly PathwayNode[] = [
  { id: "henCoop", x: 280, y: 180 },
  { id: "wheatField", x: 378, y: 120 },
];

/**
 * Straight service spurs from the existing path network out to every node
 * in `nodes` the network does not already reach.
 *
 * The real "distance vector" math the brief asks for: each node is walked in
 * the order given, `nearestPointOnNetwork` finds the closest point on
 * whatever is already built (the hand-authored six, or a spur laid earlier
 * in this same pass), and -- unless the node is already inside that path's
 * own body -- a new two-point spur is drawn as the straight vector from that
 * anchor to the node and folded into the network before the next node is
 * placed. That growing network is what lets two nearby nodes share one fork
 * instead of each running its own line all the way back to the lane, the
 * same shape a minimum-spanning greedy walk has, just seeded from a
 * hand-built base instead of starting from nothing.
 *
 * Pure and deterministic: same nodes and base network in, same spurs out,
 * every time -- there is nothing here for a seed to vary, unlike
 * ./zones.ts's scatter.
 */
export function generatePathwaysBetweenNodes(
  nodes: readonly PathwayNode[] = FARMSTEAD_PATH_NODES,
  base: readonly PathSpec[] = FARM_PATHS,
): PathSpec[] {
  const network = [...base];
  const spurs: PathSpec[] = [];
  const width = roadWidth("service", 16);
  for (const node of nodes) {
    const nearest = nearestPointOnNetwork(node.x, node.y, network);
    // Already inside an existing path's own body (or a spur laid earlier
    // this pass): the node already reads as served, nothing to add.
    if (nearest.distance < width / 2 + PATH_CLEARANCE) continue;
    const spur: PathSpec = {
      key: `spur-${node.id}`,
      tier: "service",
      width,
      points: [nearest.point, { x: node.x, y: node.y }],
      stones: 0,
    };
    spurs.push(spur);
    network.push(spur);
  }
  return spurs;
}

/** The generated Farmstead connectors, computed once at module load exactly
 *  like `FARM_PATHS` itself is a fixed literal -- there is no per-session
 *  variance to recompute, so every caller shares one array rather than
 *  re-running the walk. */
export const FARMSTEAD_PATHWAYS: readonly PathSpec[] = generatePathwaysBetweenNodes();

/** Every path the world actually has: the six hand-authored ones plus
 *  whatever `generatePathwaysBetweenNodes` grew on top. `nearPath` and the
 *  scene's own painter both read this, never `FARM_PATHS` alone, so a
 *  generated spur is indistinguishable from a hand-placed path everywhere
 *  that matters -- ground-cover exclusion, wild scenery, and the render. */
export const ALL_FARM_PATHS: readonly PathSpec[] = [...FARM_PATHS, ...FARMSTEAD_PATHWAYS];

/** Padding a path's bake needs around its polyline: the feathered mud
 *  margin, its blur and the parcel stones all sit outside the body, and the
 *  edge wobble adds a couple more. */
export function pathBakePadding(spec: PathSpec): number {
  return spec.width / 2 + 16;
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
