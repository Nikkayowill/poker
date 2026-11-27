/**
 * Where each strip of a building's picture sorts against the people walking past it. Pure;
 * components/arcade/stackacres-td/scene.ts cuts the picture along these.
 *
 * A building is drawn as one flat picture but stands on a footprint, and one sort line for the whole picture is
 * wrong in two places. A farmer in the doorway is north of the picture's base, so the porch was drawn over his
 * legs. A farmer beside a wall is north of it too, so the wall's edge was drawn over his shoulder. Cutting the
 * picture into strips fixes both: each strip sorts at the front line of the footprint under it, and a strip within
 * a body's width of an opening or a side sorts at the footprint's back edge, so anyone beside it is drawn in
 * front and only someone behind the building is covered.
 */

import { BODY_POINTS } from "./see-through";

/** How far a body reaches to either side of his feet. */
export const BODY_HALF_WIDTH = Math.max(...BODY_POINTS.map((point) => Math.abs(point.x)));

/** A run of the picture's columns, from `x0` up to but not including `x1` (world px), and the depth they sort at. */
export interface DepthStrip {
  readonly x0: number;
  readonly x1: number;
  readonly depth: number;
}

export interface BuildingDepthInput {
  /** The picture's left and right edges, in world px. */
  readonly left: number;
  readonly right: number;
  /** Where the picture meets the ground: the sort line it has as one piece. */
  readonly baseY: number;
  /** The tiles the building blocks. */
  readonly blocks: readonly (readonly [number, number])[];
  readonly tile: number;
  /**
   * Where the building stops at the back, in world px. The picture's top edge, not the blocked tiles' top: the
   * roof above the walls is open ground he can walk in behind, so what is blocked starts lower than what is drawn.
   * Without it the top of the blocked tiles is the back.
   */
  readonly backY?: number;
}

/**
 * The strips of one building, left to right, with neighbours that sort alike joined. A building that blocks
 * nothing, or sorts the same all the way across, comes back as the one strip it always was.
 */
export function depthStrips({ left, right, baseY, blocks, tile, backY }: BuildingDepthInput): DepthStrip[] {
  const first = Math.floor(left);
  const last = Math.ceil(right);
  if (blocks.length === 0 || last <= first) return [{ x0: first, x1: last, depth: baseY }];

  const lowestRow = new Map<number, number>();
  let top = Infinity;
  for (const [tx, ty] of blocks) {
    lowestRow.set(tx, Math.max(lowestRow.get(tx) ?? -Infinity, ty));
    top = Math.min(top, ty);
  }
  const back = Math.min(baseY, backY ?? top * tile);
  // A column with something built on it sorts where the building's front stops there; a column with nothing
  // (the doorway is not blocked) lets people stand right up to it, and one outside the footprint is an overhang.
  const front = (column: number): number => {
    const row = lowestRow.get(column);
    return row === undefined ? back : Math.min(baseY, (row + 1) * tile);
  };
  // Within a body's width of a column that sorts further back, someone standing there must be drawn in front.
  const depthAt = (x: number): number => {
    let depth = Infinity;
    for (let column = Math.floor((x - BODY_HALF_WIDTH) / tile); column <= Math.floor((x + BODY_HALF_WIDTH) / tile); column += 1) {
      depth = Math.min(depth, front(column));
    }
    return depth;
  };

  const strips: DepthStrip[] = [];
  for (let x = first; x < last; x += 1) {
    const depth = depthAt(x + 0.5);
    const previous = strips[strips.length - 1];
    if (previous && previous.depth === depth) strips[strips.length - 1] = { ...previous, x1: x + 1 };
    else strips.push({ x0: x, x1: x + 1, depth });
  }
  return strips;
}
