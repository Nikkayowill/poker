/**
 * The pen fence's geometry, shared by the painter that draws a bay and the
 * scene that lays the bays around a district. Here rather than in the art
 * module because both need the same numbers -- the scene steps its runs by
 * one bay, the painter anchors on that bay's first post -- and letting those
 * two drift is how a fence comes apart at the corners.
 *
 * Nothing here draws. Keeping it as plain numbers over ./iso.ts is what
 * makes the invariant that matters testable: a bay's rails have to lean by
 * exactly what `isoProject` does to a bay-length world step. The fence this
 * replaced failed that -- it was plan-view art rotated flat into the ground
 * plane, so it lay in the grass instead of standing up out of it.
 */

import { ISO_K, isoProject } from "./iso";

/** One bay's length in world units along its own axis. The scene steps its
 *  runs by this; `bayFitsDistrict` is the check that a district is a whole
 *  number of them, so a run closes on the corner with nothing left over. */
export const FENCE_BAY = 16;

/** How far a bay's far end sits below its near end on screen. Both axes drop
 *  by the same amount, which is why one box serves both edge directions. */
export const FENCE_BAY_DROP = (FENCE_BAY * ISO_K) / 2;

export const FENCE_POST_W = 3.8;

/** Roughly a hen's own height (the `hen` painter is 14 units tall) and well
 *  under a cow's back, so a pen reads as fenced rather than as walled in. */
export const FENCE_POST_H = 13;

/** Rail centres, measured up from the foot of the post. */
export const FENCE_RAIL_AT = [4.6, 9.4] as const;

export const FENCE_RAIL_T = 2.5;

/** The post's top face is a 2:1 diamond, like every other horizontal surface
 *  in this world; its half-height is the headroom the box needs above the
 *  post itself. */
export const FENCE_CAP_H = FENCE_POST_W / 4;

export interface FenceBox {
  /** The painter's box, in world units. */
  w: number;
  h: number;
  /** Where the near post's foot sits inside that box, for a bay running
   *  along world +x. The +y bay is this mirrored in x. */
  footX: number;
  footY: number;
  /** ...expressed as a painter origin, so `put()` lands that foot on the
   *  world point it was given. */
  ax: number;
  ay: number;
}

export const FENCE_BOX: FenceBox = (() => {
  const w = FENCE_BAY + FENCE_POST_W;
  const h = FENCE_CAP_H + FENCE_POST_H + FENCE_BAY_DROP;
  const footX = FENCE_POST_W / 2;
  const footY = FENCE_CAP_H + FENCE_POST_H;
  return { w, h, footX, footY, ax: footX / w, ay: footY / h };
})();

/** The screen step from a bay's near post to its far one. */
export function fenceBayStep(axis: "x" | "y"): { x: number; y: number } {
  return axis === "x" ? isoProject(FENCE_BAY, 0) : isoProject(0, FENCE_BAY);
}

/** Whether a district's edge is a whole number of bays. A run is laid from
 *  one corner in fixed steps, and each bay carries a post at both ends, so a
 *  remainder would leave the last bay hanging past the corner. */
export function bayFitsDistrict(edge: number): boolean {
  return edge > 0 && edge % FENCE_BAY === 0;
}
