import "server-only";
import { STACKACRES_CATALOGUE, type StackAcresStock } from "@/lib/stackacres/catalogue";
import {
  CROSSBREED_YIELD_QUANTITY,
  resolveCrossbreedHarvest,
  toCrossbreedBedPlot,
  type CrossbreedGridSnapshot,
  type CrossbreedHarvestSettlement,
} from "@/lib/stackacres/crossbreeding";
import {
  getStackAcresCrossbreedPlot,
  harvestStackAcresCrossbreedPlot,
  listStackAcresCrossbreedPlots,
  plantStackAcresCrossbreedPlot,
  type StoredCrossbreedPlot,
} from "./stackacres-crossbreeding-store";

/**
 * Orchestrates lib/stackacres/crossbreeding.ts's pure engine against
 * lib/server/stackacres-crossbreeding-store.ts's persistence -- the same
 * split every other StackAcres feature keeps between "what the rules say"
 * and "what actually got written". Reached through
 * lib/server/stackacres-service.ts's `plantStackAcresCrossbreedBed` and
 * `harvestStackAcresCrossbreedBed`, which own the seed/Gold debit, the land
 * gates and the refusal wording; this file stays free of all three so the
 * engine's settlement path is testable on its own.
 */

/** What a Town Contract or a future market listing would read off a
 *  completed plant call -- re-exported here rather than making a caller
 *  reach into the store module directly for it. */
export type { StoredCrossbreedPlot, CrossbreedHarvestSettlement };

export async function plantCrossbreedBed(
  profileId: string,
  row: number,
  col: number,
  stock: StackAcresStock,
  now = new Date(),
): Promise<StoredCrossbreedPlot | null> {
  const def = STACKACRES_CATALOGUE[stock];
  return plantStackAcresCrossbreedPlot(profileId, {
    row,
    col,
    stock,
    startedAt: now,
    readyAt: new Date(now.getTime() + def.durationMs),
  });
}

/**
 * The whole harvest flow for one tapped bed cell, start to finish: read the
 * live grid, run the pure engine's evaluate-then-roll against it with a real
 * random source, and commit whatever it decided. Nothing about the decision
 * can go stale between the read above and the write below except the two
 * rows the store itself re-checks at commit time (see its own doc comment
 * for why a neighbor losing its own race downgrades rather than failing the
 * whole request).
 *
 * Returns null when the TAPPED plot itself is gone or not yet ripe by
 * settlement time -- a lost race, exactly like every other harvest path in
 * StackAcres, and null must never be read as "produced nothing" the way a
 * real plain harvest does; it means this call did not happen at all.
 */
export async function harvestCrossbreedBed(
  profileId: string,
  plotId: string,
  now = new Date(),
): Promise<CrossbreedHarvestSettlement | null> {
  const rows = await listStackAcresCrossbreedPlots(profileId);
  const plot = rows.find((row) => row.id === plotId);
  if (!plot) return null;

  const nowMs = now.getTime();
  const grid: CrossbreedGridSnapshot = rows.map((row) => toCrossbreedBedPlot(row, nowMs));
  const decision = resolveCrossbreedHarvest(plotId, grid, Math.random);

  const neighborId = decision.mutated ? decision.clearedPlotIds[1] : null;
  const neighborRow = neighborId ? (rows.find((row) => row.id === neighborId) ?? null) : null;

  const outcome = await harvestStackAcresCrossbreedPlot(
    profileId,
    {
      plot: { id: plot.id, version: plot.version },
      neighbor:
        decision.mutated && decision.hybrid && neighborRow
          ? {
              id: neighborRow.id,
              version: neighborRow.version,
              hybrid: decision.hybrid,
              quantity: CROSSBREED_YIELD_QUANTITY,
            }
          : null,
    },
    now,
  );
  if (!outcome) return null;

  return {
    clearedPlotIds: outcome.neighborCleared ? decision.clearedPlotIds : [plot.id],
    hybridItem: outcome.hybridItem,
    hybridQuantity: outcome.hybridQuantity,
  };
}

/** Read-only helper for a caller that only wants to know what a specific
 *  cell looks like right now (planted stock, ripeness), without harvesting
 *  it -- e.g. an inspector panel deciding whether to offer a "cross" hint
 *  before the player commits to a tap. Never mutates anything; the actual
 *  evaluate-against-neighbors step still needs the whole grid (see
 *  `harvestCrossbreedBed`), not just this one plot. */
export async function getCrossbreedBedPlotSnapshot(
  profileId: string,
  plotId: string,
  now = new Date(),
): Promise<ReturnType<typeof toCrossbreedBedPlot> | null> {
  const plot = await getStackAcresCrossbreedPlot(profileId, plotId);
  if (!plot) return null;
  return toCrossbreedBedPlot(plot, now.getTime());
}
