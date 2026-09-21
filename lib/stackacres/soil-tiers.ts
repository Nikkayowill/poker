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
 * ONE TIER TODAY. Enriched Substrate (a faster cycle) and Hydro Soil (a bed
 * that waters its own tile) were sold for a while and are gone: a bag of soil
 * is soil and nothing more, and keeping a crop watered is the player's job,
 * not something a bag buys. The tier column and the per-tier stock table
 * stay, so a second tier can be added later without a schema change, but what
 * a tier may change is not defined again until one exists. The bean-fed
 * `enriched` flag on a bed (./soil-enrich.ts) is a different mechanic and is
 * untouched.
 *
 * A tier NEVER changes a bed's geometry. Every tier is one `SOIL_TILE`
 * square on the same lattice, so `soilTileAt`/`soilTileRect`/
 * `soilTileDiamond` are tier-blind and the unique (profile, tx, ty) index
 * keeps meaning exactly what it meant before.
 */

export const SOIL_TIERS = ["dirt"] as const;

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
   * Gold, PER BAG. A bag is `SOIL_PLOTS_PER_BAG` planting squares -- a bed is
   * one tile, one plant (./soil.ts's own header on `SOIL_TILE`) -- so a single
   * plot works out at a tenth of this.
   */
  price: number;
}

export const SOIL_TIER_DEFS: Readonly<Record<SoilTier, SoilTierDef>> = {
  dirt: {
    label: "Soil bag",
    blurb: "Ten worked planting squares, no frills.",
    price: 100,
  },
};

/**
 * How many planting squares one bag makes. The shelf counts SQUARES, not bags:
 * buying a bag adds this many, and every bed the hoe lays spends one. Counting
 * squares is also what keeps every farm that already held single-square bags
 * whole -- a stock of 7 is still 7 beds, with no migration -- and it means a
 * half-used bag is simply a smaller number rather than a state to track.
 */
export const SOIL_PLOTS_PER_BAG = 10;

/**
 * The most bags one purchase may buy. A CEILING ON A SINGLE REQUEST, not on
 * how many a player may own: they can buy again. It exists because every
 * money-moving route in this codebase needs an upper bound on the quantity a
 * body can name -- the Ante Up farming fix landed after finding routes whose
 * only bound was the player's own balance. 20 bags is 200 squares and 2,000
 * Gold.
 */
export const SOIL_BAGS_PER_PURCHASE = 20;

/**
 * Planting squares of each tier a player owns but has not laid down yet (a
 * bag is `SOIL_PLOTS_PER_BAG` of them).
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
 * whole farm.
 */
export function toSoilTier(value: unknown): SoilTier {
  return isSoilTier(value) ? value : SOIL_DEFAULT_TIER;
}

export function soilTierPrice(tier: SoilTier): number {
  return SOIL_TIER_DEFS[tier].price;
}
