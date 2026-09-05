import "server-only";
import { randomUUID } from "crypto";
import {
  isInCrossbreedGrid,
  type StackAcresCrossbreedPlotRow,
} from "@/lib/stackacres/crossbreeding";
import type { StackAcresStock } from "@/lib/stackacres/catalogue";
import { isCrossbreedItem, type CrossbreedItem } from "@/lib/stackacres/crossbreed-items";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for StackAcres Crossbreeding Beds: one row per planted grid
 * cell, plus the hybrid inventory a mutated harvest credits.
 *
 * A DELIBERATELY NEW STORE, NOT AN EXTENSION OF stackacres-store.ts's own
 * `homestead_units`/`homestead_plots` history -- see
 * supabase/migrations/20260905130000_stackacres_crossbreeding.sql's own
 * header for why this feature could not reuse either. Same twin-branch
 * shape every other StackAcres store uses (Supabase when configured, an
 * in-process Map otherwise), and the same core invariant: a write is a
 * version-guarded UPDATE/DELETE and a lost race returns null, which must
 * never be treated as a successful harvest.
 *
 * `harvestStackAcresCrossbreedPlot` is the one write that matters here, and
 * it deliberately does NOT decide whether a harvest mutates -- that decision
 * is lib/stackacres/crossbreeding.ts's own pure `resolveCrossbreedHarvest`,
 * run by the caller (lib/server/stackacres-crossbreeding-service.ts) against
 * a fresh read of the grid, with a real random source. This store's job is
 * only to commit that decision atomically, and only if it is still valid --
 * see the RPC's own migration comment for the race that guards against.
 */

export interface StoredCrossbreedPlot extends StackAcresCrossbreedPlotRow {
  profileId: string;
  startedAt: string;
  version: number;
  createdAt: string;
}

declare global {
  var __riverRoomStackAcresCrossbreedPlots: Map<string, StoredCrossbreedPlot> | undefined;
  var __riverRoomStackAcresCrossbreedInventory: Map<string, number> | undefined;
}

const memoryPlots: Map<string, StoredCrossbreedPlot> = (globalThis.__riverRoomStackAcresCrossbreedPlots ??=
  new Map());
const memoryInventory: Map<string, number> = (globalThis.__riverRoomStackAcresCrossbreedInventory ??=
  new Map());

const PLOT_COLUMNS = "id, profile_id, row_index, col_index, stock, started_at, ready_at, version, created_at";

interface CrossbreedPlotDbRow {
  id: string;
  profile_id: string;
  row_index: number;
  col_index: number;
  stock: string;
  started_at: string;
  ready_at: string;
  version: number | string;
  created_at: string;
}

function plotFromRow(row: CrossbreedPlotDbRow): StoredCrossbreedPlot {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    row: Number(row.row_index),
    col: Number(row.col_index),
    stock: row.stock as StackAcresStock,
    startedAt: String(row.started_at),
    readyAt: String(row.ready_at),
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}

/** Every plot this player has planted, any cell, any readiness -- the raw
 *  material the caller maps through
 *  lib/stackacres/crossbreeding.ts's own `toCrossbreedBedPlot` to build the
 *  grid snapshot `evaluateMutationChance` reads. */
export async function listStackAcresCrossbreedPlots(profileId: string): Promise<StoredCrossbreedPlot[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryPlots.values()]
      .filter((plot) => plot.profileId === profileId)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((plot) => ({ ...plot }));
  }

  const { data, error } = await supabase
    .from("stackacres_crossbreed_plots")
    .select(PLOT_COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load your Crossbreeding Bed: ${error.message}`);
  return (data as CrossbreedPlotDbRow[]).map(plotFromRow);
}

export async function getStackAcresCrossbreedPlot(
  profileId: string,
  plotId: string,
): Promise<StoredCrossbreedPlot | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = memoryPlots.get(plotId);
    return found && found.profileId === profileId ? { ...found } : null;
  }

  const { data, error } = await supabase
    .from("stackacres_crossbreed_plots")
    .select(PLOT_COLUMNS)
    .eq("id", plotId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not load that plot: ${error.message}`);
  return data ? plotFromRow(data as CrossbreedPlotDbRow) : null;
}

/**
 * Plants one grid cell. Returns null when that cell is already occupied --
 * the database's own `stackacres_crossbreed_plots_one_row_per_cell` unique
 * index is the real guard (caught here as 23505, same convention
 * `homestead_plots_one_row_per_plot` established), so a double-tapped plant
 * request cannot silently overwrite a neighbor mid-cross. `row`/`col` are
 * validated against the fixed grid bounds before either branch runs, since a
 * bad coordinate should never reach a 23505 guess either way.
 */
export async function plantStackAcresCrossbreedPlot(
  profileId: string,
  entry: { row: number; col: number; stock: StackAcresStock; startedAt: Date; readyAt: Date },
): Promise<StoredCrossbreedPlot | null> {
  if (!isInCrossbreedGrid(entry.row, entry.col)) {
    throw new Error(`plantStackAcresCrossbreedPlot: (${entry.row}, ${entry.col}) is outside the bed`);
  }

  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const occupied = [...memoryPlots.values()].some(
      (plot) => plot.profileId === profileId && plot.row === entry.row && plot.col === entry.col,
    );
    if (occupied) return null;
    const plot: StoredCrossbreedPlot = {
      id: randomUUID(),
      profileId,
      row: entry.row,
      col: entry.col,
      stock: entry.stock,
      startedAt: entry.startedAt.toISOString(),
      readyAt: entry.readyAt.toISOString(),
      version: 1,
      createdAt: now,
    };
    memoryPlots.set(plot.id, { ...plot });
    return { ...plot };
  }

  const { data, error } = await supabase
    .from("stackacres_crossbreed_plots")
    .insert({
      profile_id: profileId,
      row_index: entry.row,
      col_index: entry.col,
      stock: entry.stock,
      started_at: entry.startedAt.toISOString(),
      ready_at: entry.readyAt.toISOString(),
      version: 1,
    })
    .select(PLOT_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`Could not plant that: ${error.message}`);
  }
  return plotFromRow(data as CrossbreedPlotDbRow);
}

/** What one already-resolved harvest commits. Built by the caller from
 *  lib/stackacres/crossbreeding.ts's own `CrossbreedHarvestResult`, plus the
 *  version each plot was read at -- this store never re-evaluates the
 *  matrix, only re-verifies these two rows still match that read. */
export interface CrossbreedHarvestDecision {
  plot: { id: string; version: number };
  /** Present only for a mutation the roll actually hit. */
  neighbor: { id: string; version: number; hybrid: CrossbreedItem; quantity: number } | null;
}

export interface CrossbreedHarvestOutcome {
  hybridItem: CrossbreedItem | null;
  hybridQuantity: number | null;
  /** False for a plain harvest AND for a mutation whose neighbor lost its
   *  own race in the meantime -- see the RPC's own doc comment. Both read
   *  identically to a caller: only the tapped plot actually cleared. */
  neighborCleared: boolean;
}

/**
 * Commits one already-decided harvest atomically. Returns null when the
 * HARVESTED plot itself lost its race (wrong version, already gone, not yet
 * ripe) -- a lost race or a stale request, and null must never credit
 * inventory. See `harvest_stackacres_crossbreed_plot`'s own migration
 * comment for the full state machine, including why a neighbor losing ITS
 * race downgrades to a plain harvest rather than failing the whole request.
 */
export async function harvestStackAcresCrossbreedPlot(
  profileId: string,
  decision: CrossbreedHarvestDecision,
  now: Date,
): Promise<CrossbreedHarvestOutcome | null> {
  const supabase = adminClient();

  if (!supabase) {
    const plot = memoryPlots.get(decision.plot.id);
    if (
      !plot ||
      plot.profileId !== profileId ||
      plot.version !== decision.plot.version ||
      Date.parse(plot.readyAt) > now.getTime()
    ) {
      return null;
    }
    memoryPlots.delete(decision.plot.id);

    if (!decision.neighbor) {
      return { hybridItem: null, hybridQuantity: null, neighborCleared: false };
    }

    const neighbor = memoryPlots.get(decision.neighbor.id);
    if (
      !neighbor ||
      neighbor.profileId !== profileId ||
      neighbor.version !== decision.neighbor.version ||
      Date.parse(neighbor.readyAt) > now.getTime()
    ) {
      // The plot above is already deleted and stays deleted: a player who
      // tapped a ripe row gets their harvest even if the neighbor it might
      // have crossed with is no longer there to cross with.
      return { hybridItem: null, hybridQuantity: null, neighborCleared: false };
    }
    memoryPlots.delete(decision.neighbor.id);

    const key = `${profileId}:${decision.neighbor.hybrid}`;
    const total = (memoryInventory.get(key) ?? 0) + decision.neighbor.quantity;
    memoryInventory.set(key, total);
    return { hybridItem: decision.neighbor.hybrid, hybridQuantity: total, neighborCleared: true };
  }

  const { data, error } = await supabase
    .rpc("harvest_stackacres_crossbreed_plot", {
      p_profile_id: profileId,
      p_plot_id: decision.plot.id,
      p_plot_version: decision.plot.version,
      p_neighbor_plot_id: decision.neighbor?.id ?? null,
      p_neighbor_version: decision.neighbor?.version ?? null,
      p_hybrid_item: decision.neighbor?.hybrid ?? null,
      p_hybrid_quantity: decision.neighbor?.quantity ?? null,
    })
    .maybeSingle();
  if (error) throw new Error(`Could not settle that harvest: ${error.message}`);
  // Zero rows back is the RPC's own "the harvested plot lost its race"
  // signal -- maybeSingle() surfaces that as a null `data`, not an error.
  if (!data) return null;

  const row = data as { hybrid_item: string | null; hybrid_quantity: number | null; neighbor_cleared: boolean };
  const hybridItem = row.hybrid_item && isCrossbreedItem(row.hybrid_item) ? row.hybrid_item : null;
  return {
    hybridItem,
    hybridQuantity: hybridItem ? row.hybrid_quantity : null,
    neighborCleared: row.neighbor_cleared,
  };
}

/** Wipes both in-process maps between tests. No-op against real Supabase --
 *  memory-mode-only, same contract every other store's own
 *  `__resetStackAcresForTest` carries. */
export function __resetStackAcresCrossbreedForTest(): void {
  memoryPlots.clear();
  memoryInventory.clear();
}

/** Every hybrid item this player holds. A missing key is 0, same convention
 *  `readStackAcresInventory` uses for the processing track. */
export async function readStackAcresCrossbreedInventory(
  profileId: string,
): Promise<Partial<Record<CrossbreedItem, number>>> {
  const supabase = adminClient();
  if (!supabase) {
    const out: Partial<Record<CrossbreedItem, number>> = {};
    for (const [key, quantity] of memoryInventory) {
      const [id, item] = key.split(":");
      if (id === profileId && isCrossbreedItem(item)) out[item] = quantity;
    }
    return out;
  }

  const { data, error } = await supabase
    .from("stackacres_crossbreed_inventory")
    .select("item, quantity")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your hybrids: ${error.message}`);
  const out: Partial<Record<CrossbreedItem, number>> = {};
  for (const row of (data ?? []) as { item: string; quantity: number | string }[]) {
    if (isCrossbreedItem(row.item)) out[row.item] = Number(row.quantity);
  }
  return out;
}
