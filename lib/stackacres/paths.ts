/**
 * Where the farm's dirt roads and paths run.
 *
 * Pure layout: a handful of polylines in world units, and the one question the open
 * world asks of them -- "is this point on or beside a path?" -- so wild
 * scenery never grows across the road. The renderer is ./terrain.ts: a
 * point within `dirtReach` of a polyline is dirt, and the dirt is cut into
 * the terrain pack's tiles with the rest of the ground; the polylines here
 * are what both the exclusion and the tiles are measured from.
 *
 * Widths follow the tiers in ./roads.ts: a main road (the ring, its spurs and
 * the yard road) is never laid thinner than
 * `ARTERIAL_ROAD_MIN_WIDTH`, two and a half tiles, so it carries real weight
 * on a phone the way Stardew's or Mistria's do; a track is a tile and a
 * half; a service spur to a pen is one tile.
 *
 * Types only from ./world. This module is imported BY world.ts (for
 * `chunkScenery`), so a runtime import back of any of its constants would be
 * read before world.ts has finished evaluating and throw. ./yard.ts is a strict
 * leaf that imports nothing, so a value import of THAT is safe from here, and
 * it is how the yard's own three paths keep their original literals: the barn's
 * feet are still on y 34 with its door centred on x 108, in the yard's own
 * frame. Nothing below may touch a grow area.
 */

import { roadWidth, type PathTier } from "./roads";
// A strict leaf (./yard.ts imports nothing), so no cycle. Holds the offset
// the Farmstead's yard moved by in the 2026-09-07 re-lay.
import { yardPoint } from "./yard";
import type { WorldPoint } from "./world";

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
 * A GRID, since 2026-09-09: Kayo's Grid Bench layout (see ./zones.ts's
 * header). The pens sit on a 32-unit cell lattice anchored on the Crop
 * Fields' beds, and the roads are the one-cell lines between them, drawn
 * straight and axis-aligned: a north road along the beds' top margin
 * (y -288..-256), a south road along their bottom (y 256..288), a middle
 * road between the yard and the beds (x -288..-256), an east road past the
 * beds (x 256..288), and the short fold road splitting the Fold from the
 * Oak (y -128..-96). Every pen's edge IS the edge of one of those roads, so
 * there are no spurs into districts any more; a district's `approach` is
 * simply a point just inside its pen on the road side.
 *
 * The long roads are split at the middle road into east and west legs, a
 * habit from when each spec baked its own texture; the tiles do not care,
 * and the split is kept because ./path-junctions.ts reads a branch's START
 * on an earlier road, and every spec after `midRoad` starts on one.
 *
 * THE YARD'S OWN THREE keep the literals they were drawn with, wrapped in
 * ./yard.ts's `yardPoint`: the lane still runs past the same lamp posts to
 * the same mailbox in the yard's own frame, and every number in the
 * comments below is still the number in the code. `yardRoad` now runs out
 * of the yard's east edge onto the middle road, which is how the yard
 * joins the grid.
 */
export const FARM_PATHS: readonly PathSpec[] = [
  /* ---------------------------------------------------------------- */
  /* The Farmstead's own yard, carried over by YARD_DELTA. Listed first: */
  /* every spoke below forks off `yardRoad`, directly or by way of      */
  /* another spoke, and a branch has to be listed after the trunk it    */
  /* forks off.                                                         */
  /* ---------------------------------------------------------------- */
  path({
    // Out of the barn door as a wide apron, a short leg south, then west
    // and down the verge, ending where the mailbox stands. Unchanged in shape
    // from the day it was drawn -- only the yard under it moved.
    key: "lane",
    tier: "arterial",
    width: 18,
    points: [
      yardPoint(108, 36),
      yardPoint(108, 58),
      yardPoint(70, 58),
      yardPoint(50, 58),
      yardPoint(50, 78),
      yardPoint(50, 402),
    ],
    stones: 1,
    stonesFrom: 100,
  }),
  path({
    // East along the front of the barn yard (the barn's feet are on the
    // north rim, which is how it has always been), then straight on out of
    // the yard's east edge onto the middle road, which is the yard's way
    // onto the grid.
    key: "yardRoad",
    tier: "arterial",
    // Evaluates to the 2.5-tile arterial floor (40). This is the stretch
    // along the barn front past Grandfather Ray, and it is as wide as the
    // yard allows: the monk's shrine (monk.ts's MONK_HOUSE_FOOTPRINT) stands
    // 27.6 units south of the centreline and the signpost 25.5 off it, so
    // anything past ~42 puts one of them inside the road's clearance band
    // (props.test.ts, monk.test.ts). A truck up to about two tiles parks on
    // it; a bigger one means moving the shrine, not widening the road.
    width: 20,
    points: [
      yardPoint(108, 58),
      yardPoint(200, 60),
      yardPoint(300, 66),
      yardPoint(380, 74),
      { x: -272, y: -101 },
    ],
    stones: 0,
  }),
  path({
    // A few steps west off the lane to the dock on the pond (see
    // ./water.ts): it ends on the sand beside the dock's root, where the
    // ground turns from the road's dirt to the pond's own beach
    // (./terrain.ts draws both).
    key: "dockSpur",
    tier: "service",
    width: 12,
    points: [
      yardPoint(50, 118),
      yardPoint(14, 118),
    ],
    stones: 0,
  }),

  /* ---------------------------------------------------------------- */
  /* The grid roads: straight, one cell (32) wide, every pen's edge on  */
  /* one of them. `midRoad` is the second trunk; everything after it     */
  /* starts on a road already laid, so the junction repaint covers it.  */
  /* ---------------------------------------------------------------- */
  path({
    // Between the yard and the Crop Fields, north road to south road. The
    // body runs x -288..-256: flush with the wheat field's east edge, over
    // the Crop Fields' own west margin (which has no fence of its own).
    key: "midRoad",
    tier: "track",
    width: 32,
    points: [
      { x: -272, y: -288 },
      { x: -272, y: 288 },
    ],
    stones: 0,
  }),
  path({
    // The north road, east leg: along the Crop Fields' top margin, with
    // Hen Haven and the Coastal Market on its far side and the Fold's top
    // corner on its near side. Split at the middle road so each leg's bake
    // stays inside the 1024 px budget (paths.test.ts).
    key: "northRoadEast",
    tier: "track",
    width: 32,
    points: [
      { x: -272, y: -272 },
      { x: 416, y: -272 },
    ],
    stones: 0,
  }),
  path({
    // The north road, west leg: over the yard's north wall with the Mine on
    // its far side, out to the yard's own west edge.
    key: "northRoadWest",
    tier: "track",
    width: 32,
    points: [
      { x: -272, y: -272 },
      { x: -700, y: -272 },
    ],
    stones: 0,
  }),
  path({
    // The south road, east leg: Town Square and Cattle Pasture sit on it.
    key: "southRoadEast",
    tier: "track",
    width: 32,
    points: [
      { x: -272, y: 272 },
      { x: 416, y: 272 },
    ],
    stones: 0,
  }),
  path({
    // The south road, west leg: under the yard, past the mailbox's end of
    // the lane, out to the yard's own west edge.
    key: "southRoadWest",
    tier: "track",
    width: 32,
    points: [
      { x: -272, y: 272 },
      { x: -700, y: 272 },
    ],
    stones: 0,
  }),
  path({
    // The east road, north road to south road, with the Fold and the Oak
    // on its far side. Starts inside the north road's body, so it forks
    // off it as a tee.
    key: "eastRoad",
    tier: "track",
    width: 32,
    points: [
      { x: 272, y: -272 },
      { x: 272, y: 288 },
    ],
    stones: 0,
  }),
  path({
    // The one-cell road splitting the Fold from the Oak.
    key: "foldRoad",
    tier: "track",
    width: 32,
    points: [
      { x: 272, y: -112 },
      { x: 416, y: -112 },
    ],
    stones: 0,
  }),
  path({
    // The short hop off the middle road into the Crop Fields, ending short
    // of the beds. Keeps its pre-merge name (see ./zones.ts).
    key: "meadowSpur",
    tier: "track",
    width: 32,
    points: [
      { x: -272, y: 0 },
      { x: -230, y: 0 },
    ],
    stones: 0,
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
 *   henCoop:    20 units clear of the old Hen Coop block's north edge
 *               (y 200). The block is plain lawn now that the hens live in
 *               Hen Haven, so the spur simply ends on the grass there.
 *   wheatField: 20 units clear of the wheat field's own north edge (y 140),
 *               and clear of the scarecrow's footprint (x 392..412) on top.
 */
export const FARMSTEAD_PATH_NODES: readonly PathwayNode[] = [
  // Yard literals, so they move with the yard. 20 units clear of the old Hen
  // Coop block's north edge (y 200) and of the wheat field's (y 140), which is
  // what those numbers have always meant.
  { id: "henCoop", ...yardPoint(280, 180) },
  { id: "wheatField", ...yardPoint(378, 120) },
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

