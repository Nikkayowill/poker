/**
 * What a soil bed is made of. There is one kind, dirt, and it is free: the hoe
 * breaks ground and nothing is bought or spent.
 *
 * Enriched Substrate, Hydro Soil and the soil bags they came in are gone. The
 * tier column on `homestead_soil_tiles` stays, so a second kind could come back
 * without a schema change, but nothing defines what a tier does until one
 * exists. The bean-fed `enriched` flag on a bed (./soil-enrich.ts) is a
 * different mechanic and is untouched.
 *
 * A tier never changes a bed's geometry: every bed is one `SOIL_TILE` square on
 * the same lattice.
 */

export const SOIL_TIERS = ["dirt"] as const;

export type SoilTier = (typeof SOIL_TIERS)[number];

/** The tier a bed is when nothing says otherwise. The migration's own column
 *  default has to match it by hand (a DDL default cannot import this). */
export const SOIL_DEFAULT_TIER: SoilTier = "dirt";

export function isSoilTier(value: unknown): value is SoilTier {
  return typeof value === "string" && (SOIL_TIERS as readonly string[]).includes(value);
}

/**
 * Narrows whatever a stored row actually held. Degrades rather than throws: an
 * unknown tier is a bed that still exists and may have a crop on it, so reading
 * it as dirt beats failing the whole farm.
 */
export function toSoilTier(value: unknown): SoilTier {
  return isSoilTier(value) ? value : SOIL_DEFAULT_TIER;
}
