/**
 * What a soil bed is made of: the tier a player pays for when they till one.
 *
 * WHY THIS IS A SEPARATE FILE FROM ./soil.ts. That module is a runtime leaf --
 * ./world.ts and ./zones.ts both value-import it, so it may not value-import
 * them back (see its own header). This file has no such constraint and no
 * such importers, so it is free to be imported by the service, the store and
 * the shell alike. Keeping the tier table out of soil.ts also keeps soil.ts
 * about geometry, which is all its 600 lines are about today.
 *
 * WHAT A TIER IS ALLOWED TO CHANGE. Two things, and they are deliberately
 * the only two:
 *
 *   `growthMultiplier` -- scales a crop's `durationMs` at SOW TIME, exactly
 *   the way `greenhouseDurationMs` already scales it, and snapshotted onto
 *   the row the same way. This REVERSES soil.ts's standing "a bed never
 *   touches growth" note, which was true when only one kind of bed existed;
 *   that note is updated at its source rather than contradicted from here.
 *
 *   `selfHydrating` -- the bed is its own water source for its own tile,
 *   feeding the SAME `irrigated` flag `isStackAcresUnitDry` already honours
 *   (./irrigation.ts). It is NOT a second watering mechanic and NOT a way to
 *   skip the pipe network: a pipe still exists to carry water to tiles that
 *   do not make their own, and `PIPE_MAX_REACH` still bounds that. A
 *   self-hydrating bed only ever answers for the one tile it occupies.
 *
 * A tier NEVER changes a bed's geometry. Every tier is one `SOIL_TILE`
 * square on the same lattice, so `soilTileAt`/`soilTileRect`/
 * `soilTileDiamond` are tier-blind and the unique (profile, tx, ty) index
 * keeps meaning exactly what it meant before.
 */

export const SOIL_TIERS = ["dirt", "enriched", "hydro"] as const;

export type SoilTier = (typeof SOIL_TIERS)[number];

/** The tier a bed is when nothing says otherwise -- what every row written
 *  before the tier column existed reads as, and what the two free starter
 *  tiles are. Named rather than inlined because the migration's own column
 *  default has to match it by hand (a DDL default cannot import this). */
export const SOIL_DEFAULT_TIER: SoilTier = "dirt";

export interface SoilTierDef {
  label: string;
  blurb: string;
  /**
   * Gold, PER BED. A bed is one tile, one plant now -- see ./soil.ts's own
   * header on `SOIL_TILE` -- so this is simply what one planting square
   * costs, with no per-bed multiplier left to apply.
   */
  price: number;
  /** Multiplies a crop's own `durationMs` at sow time. Strictly `0 < m <= 1`
   *  -- a tier may shorten a cycle, never lengthen one, and never to zero
   *  (a zero would make a crop ready in the same tick it was sown, which
   *  `growthStage` reads as a divide-by-zero). Held to that by the tests. */
  growthMultiplier: number;
  /** Whether the bed waters its own tile. See the header: this feeds
   *  `irrigated`, it does not replace the pipe network. */
  selfHydrating: boolean;
  /**
   * A multiply tint laid over the ONE shared `soilSlot` picture, or null to
   * leave it alone.
   *
   * A TINT RATHER THAN ITS OWN ARTWORK, and that is a real constraint, not a
   * shortcut: `soil-slot.png` is the only planting-square soil art in the
   * repo. (`public/stackacres/tiles/soil-rich.png` exists but is a 16x16
   * orphan from the tile-extraction script with no code referencing it -- it
   * is not a slot plate.) Tinting one 256x128 texture keeps every tier at
   * the same source resolution, which matters here: the crops standing on
   * these squares are already starved of source pixels, and inventing
   * upscaled variants would repeat exactly that mistake. Swap a tier to its
   * own plate the day real art for it lands.
   */
  tint: number | null;
}

/**
 * The ladder. Prices climb faster than the benefits do, on purpose: a bed is
 * still mostly organisational (soil.ts's point stands -- it does not gate how
 * many crops can grow), so a tier is a convenience being sold, not a
 * multiplier the farm needs to stay viable.
 */
export const SOIL_TIER_DEFS: Readonly<Record<SoilTier, SoilTierDef>> = {
  dirt: {
    label: "Tillable Dirt",
    blurb: "One worked planting square, no frills.",
    price: 167,
    growthMultiplier: 1,
    selfHydrating: false,
    tint: null,
  },
  enriched: {
    label: "Enriched Substrate",
    blurb: "Composted through. Crops sown here come up a fifth faster.",
    price: 667,
    growthMultiplier: 0.8,
    selfHydrating: false,
    // Darker and warmer: composted earth reads richer than plain dirt.
    tint: 0xc98f5a,
  },
  hydro: {
    label: "Hydro Soil",
    blurb: "Holds its own water. This bed never needs a pipe run to it.",
    price: 1667,
    growthMultiplier: 0.9,
    selfHydrating: true,
    // Cool and damp. Pulled toward the `water` ramp's own top so a hydro bed
    // reads as related to the pipes rather than as a third unexplained hue.
    tint: 0x8fbfd0,
  },
};

/**
 * The most bags one purchase may buy. A CEILING ON A SINGLE REQUEST, not on
 * how many a player may own: they can buy again. It exists because every
 * money-moving route in this codebase needs an upper bound on the quantity a
 * body can name -- the Ante Up farming fix landed after finding routes whose
 * only bound was the player's own balance. Each bag is one planting square
 * now, not a whole bed, so 20 x the dearest tier is 33,340 Gold -- the
 * ceiling stayed the same count of bags across that repricing, which is why
 * it no longer reads as a huge number the way it did when a bag was a bed.
 */
export const SOIL_BAGS_PER_PURCHASE = 20;

/**
 * Bags of each tier a player owns but has not laid down yet.
 *
 * Lives HERE rather than beside its table in lib/server, because the shell
 * renders it: that store is `server-only`, and reaching into it even for a
 * type invites a value import later that breaks the client build. A missing
 * key and an explicit 0 mean the same thing everywhere this is read.
 */
export type SoilStock = Partial<Record<SoilTier, number>>;

export function soilTierDef(tier: SoilTier): SoilTierDef {
  return SOIL_TIER_DEFS[tier];
}

export function isSoilTier(value: unknown): value is SoilTier {
  return typeof value === "string" && (SOIL_TIERS as readonly string[]).includes(value);
}

/**
 * Narrows whatever a stored row or a request body actually held. DEGRADES
 * rather than throws, the same posture `toStackAcresToolTier` takes: an
 * unknown tier is a bed that still exists and still has crops standing on
 * it, so reading it as the cheapest tier is strictly better than 500ing the
 * whole farm. A tier this codebase has retired therefore stops paying its
 * bonus without stranding the row.
 */
export function toSoilTier(value: unknown): SoilTier {
  return isSoilTier(value) ? value : SOIL_DEFAULT_TIER;
}

export function soilTierPrice(tier: SoilTier): number {
  return SOIL_TIER_DEFS[tier].price;
}

/**
 * The multiplier a crop sown into this tier carries. Read ONCE, at sow, and
 * written onto the row -- never re-read at collection. Same rule as
 * `GREENHOUSE_GROWTH_MULTIPLIER` and as the Ante Up wager ladders: a retune
 * of this table must not change what an already-growing crop returns, and
 * the only way to guarantee that is for the growing row to carry its own
 * copy of the number.
 */
export function soilGrowthMultiplier(tier: SoilTier): number {
  return SOIL_TIER_DEFS[tier].growthMultiplier;
}

/** Whether a bed of this tier waters the tile it stands on. */
export function soilSelfHydrates(tier: SoilTier): boolean {
  return SOIL_TIER_DEFS[tier].selfHydrating;
}
