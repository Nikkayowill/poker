import "server-only";
import { STACKACRES_CATALOGUE, type StackAcresStock } from "@/lib/stackacres/catalogue";
import {
  CROSSBREED_YIELD_QUANTITY,
  resolveCrossbreedHarvest,
  toCrossbreedBedPlot,
  type CrossbreedGridSnapshot,
} from "@/lib/stackacres/crossbreeding";
import type { CrossbreedItem } from "@/lib/stackacres/crossbreed-items";
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
 * and "what actually got written". Not yet wired into
 * lib/server/stackacres-service.ts's own action dispatcher or the
 * `/api/stackacres` route: this is the engine and its settlement path,
 * complete and independently testable, the same way
 * components/arcade/stackacres/game-juice-manager.ts shipped its three
 * triggers before anything called them. Wiring a "plant"/"harvest-crossbreed"
 * action into the live dispatcher, `StackAcresView`, and the farm's own UI is
 * its own pass.
 */

/** What a Town Contract or a future market listing would read off a
 *  completed plant call -- re-exported here rather than making a caller
 *  reach into the store module directly for it. */
export type { StoredCrossbreedPlot };

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

export interface CrossbreedHarvestSettlement {
  /** Every plot id this harvest actually cleared -- one for a plain
   *  harvest, two (the tapped plot and its cross) for a confirmed
   *  mutation. */
  clearedPlotIds: readonly string[];
  hybridItem: CrossbreedItem | null;
  /** The player's new running total of `hybridItem` after this credit, or
   *  null alongside a null `hybridItem`. Never the delta -- same contract
   *  every other inventory read in StackAcres returns. */
  hybridQuantity: number | null;
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
