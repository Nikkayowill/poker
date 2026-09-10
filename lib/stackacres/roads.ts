/**
 * The road hierarchy: how wide each tier of path is, and the organic edge
 * a wide dirt road wears.
 *
 * A leaf module on purpose -- nothing imported, only literals -- so both
 * ./world.ts and ./paths.ts can read it as a value without joining their
 * import cycle (see paths.ts's own header).
 *
 * The widths come from the cozy-farm playbook (Stardew, Mistria): a main
 * road is two to three tiles wide so it carries visual weight on a phone,
 * a track is a tile and a half, and a service path between a road and a
 * pen is one tile. One tile is `ROAD_TILE` art units; `roads.test.ts`
 * holds it equal to world.ts's `STACKACRES_TILE`.
 */

/** One art unit tile, restated from world.ts's `STACKACRES_TILE`. */
export const ROAD_TILE = 16;

export type PathTier = "arterial" | "track" | "service";

/**
 * What a road is surfaced with. Bare earth, or stone: only the entrance lane
 * is cobbled and the rest of the farm's roads are not (./paths.ts's `surface`
 * says which is which), and ./terrain.ts draws both from grass-edged tiles
 * cut the same way, so the two meet without a seam.
 */
export type PathSurface = "dirt" | "cobble";

/** Two and a half tiles: the floor every main road axis is held to. */
export const ARTERIAL_ROAD_MIN_WIDTH = 2.5 * ROAD_TILE;

/** A tile and a half for a track out of the farm. */
export const TRACK_MIN_WIDTH = 1.5 * ROAD_TILE;

/** One tile for a spur off a road to a pen or a field. */
export const SERVICE_PATH_WIDTH = ROAD_TILE;

/**
 * The width a path actually gets for its tier: a main road can never be
 * laid thinner than `ARTERIAL_ROAD_MIN_WIDTH`, however narrow the spec
 * asked for, and a track never thinner than `TRACK_MIN_WIDTH`. A service
 * path is drawn at exactly the width it asks for.
 */
export function roadWidth(tier: PathTier, requested: number): number {
  switch (tier) {
    case "arterial":
      return Math.max(ARTERIAL_ROAD_MIN_WIDTH, requested);
    case "track":
      return Math.max(TRACK_MIN_WIDTH, requested);
    case "service":
      return requested;
  }
}

/** A width expressed in tiles, for the tests and the doc comments. */
export function tilesWide(width: number): number {
  return width / ROAD_TILE;
}

/** The two phases that make one road's edges unlike another's. */
export interface EdgeWobblePhase {
  a: number;
  b: number;
}

/** Each side of the road wobbles on its own phase, so the two edges never
 *  swell and pinch together like a snake's belly. */
export function edgeWobblePhase(random: () => number): { left: EdgeWobblePhase; right: EdgeWobblePhase } {
  return {
    left: { a: random() * Math.PI * 2, b: random() * Math.PI * 2 },
    right: { a: random() * Math.PI * 2, b: random() * Math.PI * 2 },
  };
}

/** How much of the half-width the edge may wander, either way. */
export const EDGE_WOBBLE_FRACTION = 0.09;

/**
 * How far the edge of a road sits outside (positive) or inside (negative)
 * its nominal half-width at arc length `s`, in world units. Two slow sines
 * of different periods, scaled with the road's own width, so a wide road
 * has proportionally muddy, uneven margins rather than a ruler line -- and
 * a narrow one stays legible as a path. Never more than
 * `EDGE_WOBBLE_FRACTION` of the half-width, so the body is never pinched
 * thinner than about 80% of itself.
 */
export function roadEdgeWobble(s: number, width: number, phase: EdgeWobblePhase): number {
  const amp = (width / 2) * EDGE_WOBBLE_FRACTION;
  return amp * (0.65 * Math.sin(s / 23 + phase.a) + 0.35 * Math.sin(s / 9.1 + phase.b));
}

/**
 * How far past the wobbled edge the feathered mud margin reaches: the
 * alpha-blended rim that blends a road into the grass. Scales with width,
 * floored so a service path still has a soft edge.
 */
export function featherReach(width: number): number {
  return Math.max(6, width * 0.2);
}
