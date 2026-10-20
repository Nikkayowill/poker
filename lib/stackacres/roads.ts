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

