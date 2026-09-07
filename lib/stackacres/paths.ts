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
 * ONE RING AND ITS SPURS, since the 2026-09-07 map re-lay. The network used to
 * be three spokes off the farmyard, because there were three districts hanging
 * off the three roads that already left it. There are nine districts now, laid
 * out on Kayo's map proposal, and the shape that proposal draws is a single
 * ring road around the central field with a spur into every place.
 *
 * WHY THE RING IS EIGHT SPECS AND NOT ONE. `pathBounds` pads a spec's whole
 * polyline into one baked texture, and paths.test.ts holds that box's PROJECTED
 * footprint under 1024 units a side -- `isoProject` can grow a diagonal box by
 * up to sqrt(2)x, so the ceiling bites well before the raw world box does. The
 * ring is about 3,600 units around; carried on one polyline it would blow
 * through that ceiling several times over. The legs are cut as long as the
 * budget allows and no longer, with one extra rule: a leg ENDS on a vertex that
 * sits inside an outer district wherever it can, because zones.test.ts needs a
 * path ending in every district the signpost lists. That is why `ring3` stops
 * at the Coastal Market, and why the Market has no spur of its own -- the ring
 * itself is what arrives there.
 *
 * The spurs are each listed AFTER the leg they fork off, so the renderer's
 * junction repaint covers them -- the same ordering rule the old `road` and
 * `track` followed against `lane`.
 *
 * THE YARD'S OWN THREE keep the literals they were drawn with, wrapped in
 * ./yard.ts's `yardPoint`. The Farmstead moved as a rigid body, so the lane
 * still runs past the same lamp posts to the same mailbox, and every number in
 * the comments below is still the number in the code. `yardRoad` replaces the
 * old `road`: it leaves the barn front east exactly as that did, and its last
 * vertex is `ring1`'s first, so the yard joins the ring as a T-junction rather
 * than stopping short of it.
 *
 * Every vertex below was fitted against the five invariants the tests hold --
 * projected bake size, no vertex or body in a grow area, a gate within 90 units
 * of a path vertex, a path ending in every outer district, and nothing in the
 * pond's open water -- and the fit was checked rather than eyeballed.
 */
export const FARM_PATHS: readonly PathSpec[] = [
  /* ---------------------------------------------------------------- */
  /* The ring                                                         */
  /* ---------------------------------------------------------------- */
  path({
    // West of the Grand Farm, climbing north past Hen Haven's gate.
    key: "ring1",
    tier: "arterial",
    width: 44,
    points: [
      { x: -390, y: 422 },
      { x: -444, y: 298 },
      { x: -466, y: 174 },
      { x: -438, y: 36 },
      { x: -360, y: -96 },
    ],
    stones: 0,
  }),
  path({
    // North-west, between the field and the hills; the mine's spur leaves it.
    key: "ring2",
    tier: "arterial",
    width: 44,
    points: [
      { x: -360, y: -96 },
      { x: -260, y: -234 },
      { x: -154, y: -352 },
      { x: -10, y: -446 },
    ],
    stones: 0,
  }),
  path({
    // North, out to the shore. Ends INSIDE the Coastal Market, which is
    // why that district needs no spur of its own.
    key: "ring3",
    tier: "arterial",
    width: 44,
    points: [
      { x: -10, y: -446 },
      { x: 152, y: -526 },
      { x: 326, y: -602 },
      { x: 486, y: -628 },
    ],
    stones: 0,
  }),
  path({
    // Down the coast road, south past the Fold.
    key: "ring4",
    tier: "arterial",
    width: 44,
    points: [
      { x: 486, y: -628 },
      { x: 612, y: -558 },
      { x: 706, y: -446 },
      { x: 766, y: -284 },
      { x: 796, y: -112 },
    ],
    stones: 0,
  }),
  path({
    // The eastern turn, past the Ancestral Oak's gate.
    key: "ring5",
    tier: "arterial",
    width: 44,
    points: [
      { x: 796, y: -112 },
      { x: 734, y: 74 },
      { x: 600, y: 248 },
    ],
    stones: 1,
    stonesFrom: 60,
  }),
  path({
    // South-east, back in toward the farm.
    key: "ring6",
    tier: "arterial",
    width: 44,
    points: [
      { x: 600, y: 248 },
      { x: 424, y: 408 },
      { x: 240, y: 554 },
    ],
    stones: 1,
    stonesFrom: 60,
  }),
  path({
    // The southern run, past Town Square's fork and the Cattle Pasture.
    key: "ring7",
    tier: "arterial",
    width: 44,
    points: [
      { x: 240, y: 554 },
      { x: 54, y: 694 },
      { x: -102, y: 754 },
      { x: -222, y: 668 },
      { x: -284, y: 522 },
    ],
    stones: 0,
  }),
  path({
    // The last leg, closing the loop where the yard road meets it.
    key: "ring8",
    tier: "arterial",
    width: 44,
    points: [
      { x: -284, y: 522 },
      { x: -390, y: 422 },
    ],
    stones: 0,
  }),

  /* ---------------------------------------------------------------- */
  /* The spurs, each listed after the leg it forks off                */
  /* ---------------------------------------------------------------- */
  path({
    // North-west off the ring to the Hen Coops' gate.
    key: "henhavenSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: -360, y: -96 },
      { x: -388, y: -114 },
      { x: -418, y: -132 },
    ],
    stones: 0,
  }),
  path({
    // The short fork into the Grand Farm's own field.
    key: "meadowSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: -200, y: -300 },
      { x: -180, y: -280 },
      { x: -158, y: -262 },
    ],
    stones: 0,
  }),
  path({
    // Off the southern run into the Cattle Pasture.
    key: "oxfieldsSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: -274, y: 544 },
      { x: -252, y: 536 },
      { x: -230, y: 526 },
    ],
    stones: 0,
  }),
  path({
    // West off the coast road into the Fold.
    key: "wallowSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: 742, y: -348 },
      { x: 652, y: -316 },
      { x: 562, y: -282 },
    ],
    stones: 0,
  }),
  path({
    // South off the ring, down to Town Square. Wild ground, but the road
    // reaches it: a place you can walk to is what makes it a promise rather
    // than an empty rectangle.
    key: "townsquareSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: -102, y: 754 },
      { x: -160, y: 842 },
      { x: -218, y: 930 },
    ],
    stones: 0,
  }),
  path({
    // North off the ring, up to the mine's door. Wild ground.
    key: "mineSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: -156, y: -350 },
      { x: -296, y: -476 },
      { x: -436, y: -602 },
    ],
    stones: 0,
  }),
  path({
    // East off the ring's turn to the old tree. Wild ground.
    key: "oakSpur",
    tier: "arterial",
    width: 26,
    points: [
      { x: 796, y: -112 },
      { x: 894, y: -92 },
      { x: 992, y: -72 },
    ],
    stones: 0,
  }),

  /* ---------------------------------------------------------------- */
  /* The Farmstead's own yard, carried over by YARD_DELTA             */
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
    // north rim, which is how it has always been), out of the yard and onto the
    // ring. Its last vertex IS ring1's first, so the two read as one
    // T-junction rather than two roads that nearly touch.
    key: "yardRoad",
    tier: "arterial",
    width: 20,
    points: [
      yardPoint(108, 58),
      yardPoint(200, 60),
      yardPoint(300, 66),
      yardPoint(380, 74),
      // Its last vertex IS ring1's first: a real T-junction, not a near miss.
      { x: -390, y: 422 },
    ],
    stones: 0,
  }),
  path({
    // A few steps west off the lane to the dock on the pond (see
    // ./water.ts): it ends on the sand beside the dock's root, where the pond's
    // own art paints over its end cap.
    key: "dockSpur",
    tier: "service",
    width: 12,
    points: [
      yardPoint(50, 118),
      yardPoint(26, 118),
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
 *   henCoop:    20 units clear of the Hen Coop's own north edge (y 200),
 *               and inside the coop's own muddy yard mat (world.ts's
 *               `YARD_MATS`), so the spur ends in mud rather than on grass.
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
