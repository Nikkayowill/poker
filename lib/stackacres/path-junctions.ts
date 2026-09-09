/**
 * Where two paths meet, and what shape the meeting takes.
 *
 * A branch (the road, the track, a spur to a pen) starts inside the body of
 * the path it leaves. Each junction is reduced to a four-bit mask of which
 * compass directions a road leaves it in, the mask picks a shape from
 * `JUNCTION_SHAPES`, and the shape says how big a fillet each concave
 * corner gets. The roads are drawn as terrain tiles now (./terrain.ts), and
 * the tile set carries its own corner pieces, so no renderer reads the
 * fillets any more; what still does is ./props.ts, which keeps the yard's
 * clutter out of every junction's `reach`.
 *
 * Pure: polylines in, junction descriptors out, no renderer. path-
 * junctions.test.ts holds the mask arithmetic and the farm's own junctions.
 */

import { ALL_FARM_PATHS, nearestOnPath, type PathSpec } from "./paths";
import type { WorldPoint } from "./world";

/** The four arms a junction can have, as bits: world +y is south. */
export const ARM_N = 1;
export const ARM_E = 2;
export const ARM_S = 4;
export const ARM_W = 8;

export type JunctionShape = "cap" | "straight" | "corner" | "tee" | "cross";

/**
 * The lookup, indexed by mask. Sixteen entries, one per way four arms can
 * be present: no arms is a bare pad (drawn as a cap), one arm a cap, two
 * opposite arms a straight coupler, two adjacent arms a corner, three a
 * tee, four a cross.
 */
export const JUNCTION_SHAPES: readonly JunctionShape[] = Array.from({ length: 16 }, (_, mask) => {
  const bits = [ARM_N, ARM_E, ARM_S, ARM_W].filter((bit) => (mask & bit) !== 0).length;
  if (bits <= 1) return "cap";
  if (bits === 3) return "tee";
  if (bits === 4) return "cross";
  const opposite = mask === (ARM_N | ARM_S) || mask === (ARM_E | ARM_W);
  return opposite ? "straight" : "corner";
});

/**
 * How much of the narrower arm's half-width the fillet's tangent length
 * is, per shape. A corner rounds the most (it is nothing but its one
 * corner); a cross the least, since four fillets crowding one point start
 * to read as a roundabout.
 */
export const FILLET_FRACTION: Readonly<Record<JunctionShape, number>> = {
  cap: 0,
  straight: 0,
  corner: 0.9,
  tee: 0.7,
  cross: 0.55,
};

/** Arms closer together than this get no fillet: the two strips already
 *  overlap for most of their width, and a fillet in the sliver between
 *  them would reach further out than the junction's own texture. */
export const FILLET_MIN_GAP = (35 * Math.PI) / 180;

/** How far inside an arm's nominal edge the fillet's tangent point sits,
 *  so the pad overlaps the strip's own wobbled edge rather than leaving a
 *  hairline of grass between the two. */
export const FILLET_EDGE_INSET = 2.5;

export interface JunctionArm {
  /** Direction the arm leaves the junction in, radians, world axes. */
  angle: number;
  /** Body width of the path this arm belongs to. */
  width: number;
  /** Which of `ARM_N`..`ARM_W` this arm reads as. */
  bit: number;
  /** The path's key, for the tests. */
  key: string;
}

/** One rounded concave corner between two adjacent arms: the corner where
 *  their edges would have met, and the two points the fillet arc is tangent
 *  to those edges at. */
export interface JunctionFillet {
  corner: WorldPoint;
  a: WorldPoint;
  b: WorldPoint;
}

export interface PathJunction {
  /** `${branch}@${trunk}`: the branch that starts here and the path it leaves. */
  key: string;
  at: WorldPoint;
  mask: number;
  shape: JunctionShape;
  arms: readonly JunctionArm[];
  fillets: readonly JunctionFillet[];
  /** Half the side of the world square the junction's bake covers. */
  reach: number;
}

/** The compass bit a direction reads as: whichever axis it leans on most. */
export function compassBit(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ARM_E : ARM_W;
  return dy >= 0 ? ARM_S : ARM_N;
}

function unit(dx: number, dy: number): WorldPoint {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function arm(from: WorldPoint, to: WorldPoint, spec: PathSpec): JunctionArm {
  const d = unit(to.x - from.x, to.y - from.y);
  return { angle: Math.atan2(d.y, d.x), width: spec.width, bit: compassBit(d.x, d.y), key: spec.key };
}

/**
 * The directions a trunk leaves an anchor point on it in. At a vertex the
 * two legs meeting there are the arms (a corner turns, it does not carry
 * straight on); mid-segment, the segment runs both ways; at either end,
 * only back along the polyline.
 */
function trunkArms(spec: PathSpec, at: WorldPoint, segment: number): JunctionArm[] {
  const points = spec.points;
  const near = (p: WorldPoint) => Math.hypot(p.x - at.x, p.y - at.y) < 0.5;
  for (let k = 0; k < points.length; k += 1) {
    if (!near(points[k])) continue;
    const arms: JunctionArm[] = [];
    if (k > 0) arms.push(arm(points[k], points[k - 1], spec));
    if (k < points.length - 1) arms.push(arm(points[k], points[k + 1], spec));
    return arms;
  }
  const a = points[segment];
  const b = points[segment + 1];
  return [arm(at, b, spec), arm(at, a, spec)];
}

/** The line each arm's inner edge runs along, meeting the neighbouring
 *  arm's at the concave corner between them. */
function filletBetween(at: WorldPoint, first: JunctionArm, second: JunctionArm, length: number): JunctionFillet | null {
  const dA = { x: Math.cos(first.angle), y: Math.sin(first.angle) };
  const dB = { x: Math.cos(second.angle), y: Math.sin(second.angle) };
  // Each arm's edge on the side that faces the other arm.
  let nA = { x: -dA.y, y: dA.x };
  if (nA.x * dB.x + nA.y * dB.y < 0) nA = { x: -nA.x, y: -nA.y };
  let nB = { x: -dB.y, y: dB.x };
  if (nB.x * dA.x + nB.y * dA.y < 0) nB = { x: -nB.x, y: -nB.y };
  const offA = first.width / 2 - FILLET_EDGE_INSET;
  const offB = second.width / 2 - FILLET_EDGE_INSET;
  const pA = { x: at.x + nA.x * offA, y: at.y + nA.y * offA };
  const pB = { x: at.x + nB.x * offB, y: at.y + nB.y * offB };
  // pA + t dA = pB + u dB
  const det = dA.x * -dB.y - dA.y * -dB.x;
  if (Math.abs(det) < 1e-6) return null;
  const rx = pB.x - pA.x;
  const ry = pB.y - pA.y;
  const t = (rx * -dB.y - ry * -dB.x) / det;
  const corner = { x: pA.x + dA.x * t, y: pA.y + dA.y * t };
  return {
    corner,
    a: { x: corner.x + dA.x * length, y: corner.y + dA.y * length },
    b: { x: corner.x + dB.x * length, y: corner.y + dB.y * length },
  };
}

/**
 * The fillets a set of arms needs: one per pair of angularly adjacent arms
 * whose gap is wide enough to have a corner in it and narrower than a
 * straight line (two opposite arms share no concave corner).
 */
export function junctionFillets(at: WorldPoint, arms: readonly JunctionArm[], shape: JunctionShape): JunctionFillet[] {
  const fraction = FILLET_FRACTION[shape];
  if (fraction === 0 || arms.length < 2) return [];
  const sorted = [...arms].sort((p, q) => p.angle - q.angle);
  const fillets: JunctionFillet[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const first = sorted[i];
    const second = sorted[(i + 1) % sorted.length];
    let gap = second.angle - first.angle;
    if (gap <= 0) gap += Math.PI * 2;
    if (gap < FILLET_MIN_GAP || gap > Math.PI - 0.05) continue;
    const length = fraction * (Math.min(first.width, second.width) / 2);
    const fillet = filletBetween(at, first, second, length);
    if (fillet) fillets.push(fillet);
  }
  return fillets;
}

/** The trunk a branch's start point lies inside, if any: the nearest of the
 *  paths laid before it whose body contains that point. */
function trunkOf(branch: PathSpec, under: readonly PathSpec[]): { spec: PathSpec; point: WorldPoint; segment: number } | null {
  const start = branch.points[0];
  let best: { spec: PathSpec; point: WorldPoint; segment: number; distance: number } | null = null;
  for (const spec of under) {
    const near = nearestOnPath(start.x, start.y, spec);
    if (near.distance >= spec.width / 2) continue;
    if (!best || near.distance < best.distance) best = { spec, ...near };
  }
  return best;
}

/**
 * Every junction in a path network: for each path after the first, the
 * point it starts at inside an earlier path's body. Arms are the branch's
 * own first leg plus the trunk's directions at the anchor; the mask is the
 * OR of their compass bits; the shape is the mask's own lookup.
 */
export function findPathJunctions(paths: readonly PathSpec[] = ALL_FARM_PATHS): PathJunction[] {
  const junctions: PathJunction[] = [];
  paths.forEach((branch, i) => {
    if (i === 0 || branch.points.length < 2) return;
    const trunk = trunkOf(branch, paths.slice(0, i));
    if (!trunk) return;
    const at = branch.points[0];
    const arms = [arm(at, branch.points[1], branch), ...trunkArms(trunk.spec, trunk.point, trunk.segment)];
    const mask = arms.reduce((acc, a) => acc | a.bit, 0);
    const shape = JUNCTION_SHAPES[mask];
    const fillets = junctionFillets(at, arms, shape);
    const widest = Math.max(...arms.map((a) => a.width));
    let reach = widest / 2 + 12;
    for (const f of fillets) {
      for (const p of [f.a, f.b, f.corner]) reach = Math.max(reach, Math.hypot(p.x - at.x, p.y - at.y) + 8);
    }
    junctions.push({ key: `${branch.key}@${trunk.spec.key}`, at, mask, shape, arms, fillets, reach: Math.ceil(reach) });
  });
  return junctions;
}

/** The farm's own junctions, fixed at module load like the paths are. */
export const FARM_JUNCTIONS: readonly PathJunction[] = findPathJunctions();
