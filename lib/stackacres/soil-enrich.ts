import type { StackAcresStock } from "./catalogue";
import { STACKACRES_YIELDS } from "./items";
import type { SoilTile } from "./soil";

/** Crops whose harvest enriches the bed they grew on. */
export const SOIL_ENRICHING_CROPS: readonly StackAcresStock[] = ["green_bean"];

/** The next crop sown on an enriched bed takes this share of its normal time. */
export const ENRICHED_GROWTH_MULTIPLIER = 0.75;

export const SOIL_ENRICH_USE_LABEL = "Soil helper (next crop grows faster)";

export function enrichesSoil(stock: StackAcresStock): boolean {
  return SOIL_ENRICHING_CROPS.includes(stock);
}

/** True when a harvested item is the produce of an enriching crop. */
export function isSoilEnrichingItem(item: string): boolean {
  return SOIL_ENRICHING_CROPS.some((stock) => STACKACRES_YIELDS[stock].item === item);
}

export function isSoilTileEnriched(tile: Pick<SoilTile, "enriched">): boolean {
  return tile.enriched === true;
}

/** The growth multiplier a sow on this bed gets from enrichment alone. */
export function enrichedGrowthMultiplier(enriched: boolean): number {
  return enriched ? ENRICHED_GROWTH_MULTIPLIER : 1;
}

/** Whether a bed is enriched after `stock` is harvested from it. Never stacks. */
export function enrichedAfterHarvest(wasEnriched: boolean, stock: StackAcresStock): boolean {
  return wasEnriched || enrichesSoil(stock);
}
