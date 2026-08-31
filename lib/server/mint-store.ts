import "server-only";
import { randomUUID } from "crypto";
import type { MintPlotRow } from "@/lib/mint/plots";
import type { MintNodeType } from "@/lib/mint/nodes";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the Sovereign Mint's plot grid: one row per owned plot,
 * carrying at most one growing node.
 *
 * Same twin-branch shape as ante-up-store.ts (Supabase when configured, an
 * in-process Map otherwise), and the same two invariants: one row per
 * (profile, plot) -- caught from the unique index (23505) rather than a
 * read-first check -- and a version that only ever advances from the value
 * the caller last saw.
 *
 * The write that matters is harvestMintNode: a single guarded UPDATE from
 * growing back to empty that also re-checks ripeness against the database's
 * own view of `matures_at`. It returns null on a lost race, a stale version,
 * or an early tap, and null must never pay -- that guard is the settlement
 * idempotency key that makes a double-tapped tower credit once.
 */

export interface StoredMintPlot extends MintPlotRow {
  id: string;
  profileId: string;
  createdAt: string;
}

declare global {
  var __riverRoomMintPlots: Map<string, StoredMintPlot> | undefined;
  var __riverRoomMintHarvests: MintHarvestEntry[] | undefined;
}

const memoryPlots = globalThis.__riverRoomMintPlots ?? new Map<string, StoredMintPlot>();
globalThis.__riverRoomMintPlots = memoryPlots;

const memoryHarvests = globalThis.__riverRoomMintHarvests ?? [];
globalThis.__riverRoomMintHarvests = memoryHarvests;

/** Test seam only: the memory branch is process-global. */
export function __resetMintPlotsForTest(): void {
  memoryPlots.clear();
  memoryHarvests.length = 0;
}

/** Test seam only: what the memory-branch harvest ledger recorded. */
export function __mintHarvestsForTest(): readonly MintHarvestEntry[] {
  return memoryHarvests;
}

/** Thrown when this plot already has a row (a replayed or racing purchase). */
export class MintPlotExists extends Error {
  constructor() {
    super("You already own this plot.");
    this.name = "MintPlotExists";
  }
}

const PLOT_COLUMNS =
  "id, profile_id, plot_index, status, node_type, stake, payout, planted_at, matures_at, version, created_at";

interface PlotDbRow {
  id: string;
  profile_id: string;
  plot_index: number | string;
  status: string;
  node_type: string | null;
  stake: number | string | null;
  payout: number | string | null;
  planted_at: string | null;
  matures_at: string | null;
  version: number | string;
  created_at: string;
}

function fromRow(row: PlotDbRow): StoredMintPlot {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    plotIndex: Number(row.plot_index),
    status: row.status === "growing" ? "growing" : "empty",
    nodeType: (row.node_type as MintNodeType | null) ?? null,
    stake: row.stake === null ? null : Number(row.stake),
    payout: row.payout === null ? null : Number(row.payout),
    plantedAt: row.planted_at ? String(row.planted_at) : null,
    maturesAt: row.matures_at ? String(row.matures_at) : null,
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}

function clone(plot: StoredMintPlot): StoredMintPlot {
  return { ...plot };
}

/** Every plot the player owns, in grid order. What renders the treasury. */
export async function listMintPlots(profileId: string): Promise<StoredMintPlot[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryPlots.values()]
      .filter((plot) => plot.profileId === profileId)
      .sort((a, b) => a.plotIndex - b.plotIndex)
      .map(clone);
  }

  const { data, error } = await supabase
    .from("mint_plots")
    .select(PLOT_COLUMNS)
    .eq("profile_id", profileId)
    .order("plot_index", { ascending: true });
  if (error) throw new Error(`Could not load your treasury: ${error.message}`);
  return (data as PlotDbRow[]).map(fromRow);
}

/** One plot by grid position, or null while it is still locked/unowned. */
export async function getMintPlot(profileId: string, plotIndex: number): Promise<StoredMintPlot | null> {
  const supabase = adminClient();
  if (!supabase) {
    const found = [...memoryPlots.values()].find(
      (plot) => plot.profileId === profileId && plot.plotIndex === plotIndex,
    );
    return found ? clone(found) : null;
  }

  const { data, error } = await supabase
    .from("mint_plots")
    .select(PLOT_COLUMNS)
    .eq("profile_id", profileId)
    .eq("plot_index", plotIndex)
    .maybeSingle();
  if (error) throw new Error(`Could not load that plot: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/**
 * Creates an empty plot row. Throws MintPlotExists when the player already
 * owns it, from the unique index rather than a read-first check, so a
 * double-clicked purchase refunds cleanly instead of charging twice.
 */
export async function createMintPlot(profileId: string, plotIndex: number): Promise<StoredMintPlot> {
  const supabase = adminClient();
  const now = new Date().toISOString();

  if (!supabase) {
    const exists = [...memoryPlots.values()].some(
      (plot) => plot.profileId === profileId && plot.plotIndex === plotIndex,
    );
    if (exists) throw new MintPlotExists();
    const plot: StoredMintPlot = {
      id: randomUUID(),
      profileId,
      plotIndex,
      status: "empty",
      nodeType: null,
      stake: null,
      payout: null,
      plantedAt: null,
      maturesAt: null,
      version: 1,
      createdAt: now,
    };
    memoryPlots.set(plot.id, clone(plot));
    return clone(plot);
  }

  const { data, error } = await supabase
    .from("mint_plots")
    .insert({ profile_id: profileId, plot_index: plotIndex, status: "empty", version: 1 })
    .select(PLOT_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new MintPlotExists();
    throw new Error(`Could not claim that plot: ${error.message}`);
  }
  return fromRow(data as PlotDbRow);
}

/** How many nodes this player has growing right now, for the concurrent cap. */
export async function countGrowingMintNodes(profileId: string): Promise<number> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryPlots.values()].filter(
      (plot) => plot.profileId === profileId && plot.status === "growing",
    ).length;
  }

  const { count, error } = await supabase
    .from("mint_plots")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("status", "growing");
  if (error) throw new Error(`Could not count your growing nodes: ${error.message}`);
  return count ?? 0;
}

/**
 * Plants a node on an empty plot: a guarded UPDATE from the exact row the
 * service just read. Returns null on a lost race (another tab planted, or
 * anything else moved the row), and the caller must refund on null -- the
 * stake was already debited under rule 1.
 */
export async function plantMintNode(
  current: StoredMintPlot,
  node: { nodeType: MintNodeType; stake: number; payout: number; plantedAt: Date; maturesAt: Date },
): Promise<StoredMintPlot | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const next = {
    status: "growing" as const,
    nodeType: node.nodeType,
    stake: node.stake,
    payout: node.payout,
    plantedAt: node.plantedAt.toISOString(),
    maturesAt: node.maturesAt.toISOString(),
    version,
  };

  if (!supabase) {
    const stored = memoryPlots.get(current.id);
    if (!stored || stored.status !== "empty" || stored.version !== current.version) return null;
    const updated: StoredMintPlot = { ...stored, ...next };
    memoryPlots.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("mint_plots")
    .update({
      status: next.status,
      node_type: next.nodeType,
      stake: next.stake,
      payout: next.payout,
      planted_at: next.plantedAt,
      matures_at: next.maturesAt,
      version,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "empty")
    .select(PLOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not plant that node: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/**
 * Settles a ripe node back to empty. The one write that pays: guarded on
 * id + version + status AND on the database's own matures_at <= now, so a
 * doctored client clock, a double-tap, or two tabs can produce at most one
 * non-null return -- and only a non-null return is ever credited.
 */
export async function harvestMintNode(current: StoredMintPlot, now: Date): Promise<StoredMintPlot | null> {
  const supabase = adminClient();
  const version = current.version + 1;
  const cleared = {
    status: "empty" as const,
    nodeType: null,
    stake: null,
    payout: null,
    plantedAt: null,
    maturesAt: null,
    version,
  };

  if (!supabase) {
    const stored = memoryPlots.get(current.id);
    if (
      !stored ||
      stored.status !== "growing" ||
      stored.version !== current.version ||
      !stored.maturesAt ||
      Date.parse(stored.maturesAt) > now.getTime()
    ) {
      return null;
    }
    const updated: StoredMintPlot = { ...stored, ...cleared };
    memoryPlots.set(current.id, clone(updated));
    return clone(updated);
  }

  const { data, error } = await supabase
    .from("mint_plots")
    .update({
      status: cleared.status,
      node_type: cleared.nodeType,
      stake: cleared.stake,
      payout: cleared.payout,
      planted_at: cleared.plantedAt,
      matures_at: cleared.maturesAt,
      version,
    })
    .eq("id", current.id)
    .eq("version", current.version)
    .eq("status", "growing")
    .lte("matures_at", now.toISOString())
    .select(PLOT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Could not harvest that node: ${error.message}`);
  return data ? fromRow(data as PlotDbRow) : null;
}

/** One settled harvest, for the append-only economy ledger. */
export interface MintHarvestEntry {
  profileId: string;
  plotIndex: number;
  nodeType: MintNodeType;
  stake: number;
  payout: number;
  plantedAt: string;
  harvestedAt: string;
}

/**
 * Best-effort telemetry, written after the credit. A Mint node is a
 * guaranteed win, so the economy dashboard's view of how much this faucet
 * pours matters more than usual -- but a ledger failure must never turn a
 * settled, paid harvest into an error response.
 */
export async function recordMintHarvest(entry: MintHarvestEntry): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryHarvests.push({ ...entry });
    return;
  }

  const { error } = await supabase.from("mint_harvests").insert({
    profile_id: entry.profileId,
    plot_index: entry.plotIndex,
    node_type: entry.nodeType,
    stake: entry.stake,
    payout: entry.payout,
    planted_at: entry.plantedAt,
    harvested_at: entry.harvestedAt,
  });
  if (error) console.error("mint.harvest_ledger_failed", { entry, error });
}
