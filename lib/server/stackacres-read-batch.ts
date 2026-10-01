import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * The raw shape `stackacres_read_batch` (migration
 * 20260914011736_stackacres_read_batch.sql) hands back: one field per table,
 * whole rows, exactly as `to_jsonb`/`jsonb_agg` serialize them -- untyped
 * beyond "an object" or "an array of objects" on purpose. Nothing here
 * parses or defaults anything; that stays where it always lived, in the
 * `*FromBatchRow`/`*FromBatchRows` helper colocated next to each existing
 * reader in lib/server/stackacres-*-store.ts, so both the batched path and
 * the original per-table read run the exact same parsing code. This module
 * only knows how to fetch the batch, never what any field in it means.
 */
export interface StackAcresReadBatch {
  units: Record<string, unknown>[];
  feed: Record<string, unknown> | null;
  water: Record<string, unknown> | null;
  capacity: Record<string, unknown>[];
  sectors: Record<string, unknown>[];
  upkeep: Record<string, unknown> | null;
  museum: Record<string, unknown>[];
  tool: Record<string, unknown> | null;
  wheat_plots: Record<string, unknown>[];
  machines: Record<string, unknown>[];
  inventory: Record<string, unknown>[];
  contract: Record<string, unknown> | null;
  influence: Record<string, unknown> | null;
  secret_ledger: Record<string, unknown>[];
  greenhouse: Record<string, unknown> | null;
  crop_fields: Record<string, unknown> | null;
  perk_unlocks: Record<string, unknown>[];
  blueprints: Record<string, unknown>[];
  blueprint_progress: Record<string, unknown>[];
  prestige: Record<string, unknown> | null;
  tool_enchantments: Record<string, unknown>[];
  crossbreed_plots: Record<string, unknown>[];
  crossbreed_inventory: Record<string, unknown>[];
  pipes: Record<string, unknown>[];
  soil_tiles: Record<string, unknown>[];
  soil_stock: Record<string, unknown>[];
  seed_stock: Record<string, unknown>[];
  devotion: Record<string, unknown> | null;
  friendship: Record<string, unknown>[];
  /** Every sealed manifest, one per aging machine (the Vat and the
   *  Preserves Cellar). Added by the Chapter 5 migration. */
  aging_manifests: Record<string, unknown>[];
  cutters: Record<string, unknown>[];
  story: Record<string, unknown> | null;
  /** Today's Daily Farm Board row, and this week's. Null until the player's
   *  first read of that period draws one. Added by
   *  20261001180411_stackacres_farm_board.sql. */
  farm_board_daily: Record<string, unknown> | null;
  farm_board_weekly: Record<string, unknown> | null;
  /** Absent until the Chapter 1 migration redefines the batch. */
  energy?: Record<string, unknown> | null;
  /** Absent until the clock migration (20260924045748) redefines the batch. */
  clock?: Record<string, unknown> | null;
  /** Absent until the Far Field batch migration (20260928232207) redefines the batch. */
  wood_nodes?: Record<string, unknown>[];
  land_obstacles?: Record<string, unknown>[];
  forage_nodes?: Record<string, unknown>[];
  axe?: Record<string, unknown> | null;
  fences?: Record<string, unknown>[];
  empire_buildings?: Record<string, unknown>[];
  grocery?: Record<string, unknown> | null;
  /** The wild acres a farm owns. Absent until the acres migration redefines the batch. */
  acres?: Record<string, unknown>[];
}

/**
 * One Postgres round trip in place of the ~37 `view()` used to fire in
 * parallel -- see the migration's own header for which two reads are
 * deliberately NOT folded in here (they're already their own aggregate/
 * idle-sweep RPCs, not a plain per-table select), plus Stone's global read
 * (not per-profile, so it can't be a batch RPC argument), and why whole
 * rows, not a hand-typed column list, cross this boundary.
 *
 * Returns null in memory mode (no Supabase configured) -- there is no batch
 * to fetch, and callers fall back to the exact same per-table reads this
 * function exists to replace, unchanged. Never throws for a brand new
 * profile with no rows anywhere; every field in the batch degrades to `[]`
 * or `null` on its own, same as each individual reader's own "missing row"
 * default does today.
 */
export async function readStackAcresBatch(
  profileId: string,
  day: string,
): Promise<StackAcresReadBatch | null> {
  const supabase = adminClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("stackacres_read_batch", {
    p_profile_id: profileId,
    p_day: day,
  });
  if (error) throw new Error(`Could not load your farm: ${error.message}`);
  return data as StackAcresReadBatch;
}
