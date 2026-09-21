import "server-only";

import {
  isPipeFacing,
  pipeKey,
  pipeSyncPayload,
  type NetworkGrid,
  type PipeFacing,
  type PipeKind,
  type PlacedPipe,
} from "@/lib/stackacres/irrigation";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the irrigation pipe network: one row per placed tile on
 * the STACKACRES_TILE lattice, in `homestead_pipes`.
 *
 * ITS OWN TABLE AND RPCs. Not `homestead_inventory` / the free-form
 * `adjust_homestead_inventory` -- that pair is the inert barn-era one (see
 * this store's sibling header). `homestead_pipes` +
 * `place_/remove_/sync_homestead_pipe_network` are this feature's own,
 * created by 20260906120000_stackacres_irrigation.sql.
 *
 * Same twin-branch shape as the rest of `lib/server/stackacres-*`: Supabase
 * when configured, an in-process Map otherwise, and the memory branch
 * enforces the same 120-tile / one-well cap the DB trigger does so dev
 * behaves like prod.
 *
 * `mask` / `hydrated` / `distance` are DERIVED. Nothing writes them by hand:
 * the service runs `recalculatePipeConnections` after every layout change
 * and hands the result to `syncStackAcresPipeNetwork`, which is the only
 * writer of those three columns. `facing` is NOT derived -- it is the
 * player's own cosmetic aim for a lone stub (20260909140000), written only
 * by `aimStackAcresPipe` below and never touched by the sync.
 */

export interface StoredPipe extends PlacedPipe {
  readonly mask: number;
  readonly hydrated: boolean;
  readonly distance: number | null;
  readonly facing: PipeFacing | null;
  readonly version: number;
}

/** How many tiles one farm may place, and it may have at most one well.
 *  Mirrors `homestead_pipes_enforce_cap()`. */
export const PIPE_LAYOUT_CAP = 120;

export interface PipeDbRow {
  tx: number | string;
  ty: number | string;
  kind: string;
  mask: number | string;
  hydrated: boolean;
  distance: number | string | null;
  facing?: number | string | null;
  version: number | string;
}

const PIPE_COLUMNS = "tx, ty, kind, mask, hydrated, distance, facing, version";

function isPipeKind(value: string): value is PipeKind {
  return value === "well" || value === "pipe";
}

export { fromRow as stackAcresPipeFromBatchRow };

function fromRow(row: PipeDbRow): StoredPipe {
  const kind = String(row.kind);
  // Degrades to "no aim" rather than throwing: a row read before the column
  // landed, or holding anything but one of the four bits, is a plain stub.
  const facing = row.facing === null || row.facing === undefined ? null : Number(row.facing);
  return {
    tx: Number(row.tx),
    ty: Number(row.ty),
    kind: isPipeKind(kind) ? kind : "pipe",
    mask: Number(row.mask),
    hydrated: Boolean(row.hydrated),
    distance: row.distance === null ? null : Number(row.distance),
    facing: isPipeFacing(facing) ? facing : null,
    version: Number(row.version),
  };
}

declare global {
  var __riverRoomStackAcresPipes: Map<string, Map<string, StoredPipe>> | undefined;
}

const memoryPipes =
  globalThis.__riverRoomStackAcresPipes ?? new Map<string, Map<string, StoredPipe>>();
globalThis.__riverRoomStackAcresPipes = memoryPipes;

/** Test seam: drop every in-memory irrigation layout. Mirrors
 *  `__resetStackAcresForTest` in the sibling store. */
export function __resetStackAcresPipesForTest(): void {
  memoryPipes.clear();
}

function memoryLayout(profileId: string): Map<string, StoredPipe> {
  let layout = memoryPipes.get(profileId);
  if (!layout) {
    layout = new Map<string, StoredPipe>();
    memoryPipes.set(profileId, layout);
  }
  return layout;
}

export async function listStackAcresPipes(profileId: string): Promise<StoredPipe[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryLayout(profileId).values()].map((pipe) => ({ ...pipe }));
  }
  const { data, error } = await supabase
    .from("homestead_pipes")
    .select(PIPE_COLUMNS)
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read the irrigation layout: ${error.message}`);
  return ((data ?? []) as PipeDbRow[]).map(fromRow);
}

/**
 * Writes the recomputed `mask` / `hydrated` / `distance` back for a whole
 * layout, in one atomic statement. Only tiles whose derived triple actually
 * moved are touched (and version-bumped).
 */
export async function syncStackAcresPipeNetwork(
  profileId: string,
  grid: NetworkGrid,
): Promise<void> {
  const payload = pipeSyncPayload(grid);
  const supabase = adminClient();
  if (!supabase) {
    const layout = memoryLayout(profileId);
    for (const node of payload) {
      const key = pipeKey(node.tx, node.ty);
      const existing = layout.get(key);
      if (!existing) continue;
      if (
        existing.mask === node.mask &&
        existing.hydrated === node.hydrated &&
        existing.distance === node.distance
      ) {
        continue;
      }
      layout.set(key, {
        ...existing,
        mask: node.mask,
        hydrated: node.hydrated,
        distance: node.distance,
        version: existing.version + 1,
      });
    }
    return;
  }
  const { error } = await supabase.rpc("sync_homestead_pipe_network", {
    p_profile_id: profileId,
    p_nodes: payload,
  });
  if (error) throw new Error(`Could not update the irrigation network: ${error.message}`);
}
