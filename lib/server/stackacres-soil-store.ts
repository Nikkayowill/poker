import "server-only";

import { soilTileKey, type SoilTile, type SoilTileOrigin } from "@/lib/stackacres/soil";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for placed soil tiles, in `homestead_soil_tiles`.
 *
 * ITS OWN TABLE AND RPCs, same shape as ./stackacres-pipe-store.ts: a small
 * per-row table, service-role only, a Supabase branch and an in-process Map
 * fallback that enforces the same rules the DB does so dev behaves like
 * prod.
 *
 * ONLY PURCHASED TILES LIVE HERE. Starter tiles are derived fresh on every
 * load by `starterSoilTiles` (lib/stackacres/soil.ts) and never written --
 * see that function's own header for why they are deliberately not
 * persisted. This store's `origin` column exists only so `removeStackAcresSoilTile`
 * can refuse a row it did not create, but in practice every row here reads
 * `'purchased'`.
 */

export type StoredSoilTile = SoilTile;

interface SoilTileDbRow {
  tx: number | string;
  ty: number | string;
  tile_order: number | string;
  origin: string;
}

const SOIL_TILE_COLUMNS = "tx, ty, tile_order, origin";

function isSoilTileOrigin(value: string): value is SoilTileOrigin {
  return value === "starter" || value === "purchased";
}

function fromRow(row: SoilTileDbRow): StoredSoilTile {
  const origin = String(row.origin);
  return {
    tx: Number(row.tx),
    ty: Number(row.ty),
    order: Number(row.tile_order),
    origin: isSoilTileOrigin(origin) ? origin : "purchased",
  };
}

declare global {
  var __riverRoomStackAcresSoilTiles: Map<string, Map<string, StoredSoilTile>> | undefined;
}

const memorySoilTiles =
  globalThis.__riverRoomStackAcresSoilTiles ?? new Map<string, Map<string, StoredSoilTile>>();
globalThis.__riverRoomStackAcresSoilTiles = memorySoilTiles;

/** Test seam: drop every in-memory placed-soil layout. Mirrors
 *  `__resetStackAcresPipesForTest` in the sibling store. */
export function __resetStackAcresSoilTilesForTest(): void {
  memorySoilTiles.clear();
}

function memoryLayout(profileId: string): Map<string, StoredSoilTile> {
  let layout = memorySoilTiles.get(profileId);
  if (!layout) {
    layout = new Map<string, StoredSoilTile>();
    memorySoilTiles.set(profileId, layout);
  }
  return layout;
}

export async function listStackAcresSoilTiles(profileId: string): Promise<StoredSoilTile[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...memoryLayout(profileId).values()].map((tile) => ({ ...tile }));
  }
  const { data, error } = await supabase
    .from("homestead_soil_tiles")
    .select(SOIL_TILE_COLUMNS)
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read the placed soil: ${error.message}`);
  return ((data ?? []) as SoilTileDbRow[]).map(fromRow);
}

/**
 * Places one purchased tile. Returns null when the cell is already occupied
 * (by a starter or a purchased tile -- both share the same unique index) or
 * a concurrent write beat this one to it; the caller treats null exactly
 * like a lost race and refunds the Gold it already spent, the same contract
 * `placeStackAcresPipe` already follows for its own layout.
 */
export async function placeStackAcresSoilTile(
  profileId: string,
  tx: number,
  ty: number,
): Promise<StoredSoilTile | null> {
  const supabase = adminClient();
  if (!supabase) {
    const layout = memoryLayout(profileId);
    const key = soilTileKey(tx, ty);
    if (layout.has(key)) return null;
    let maxOrder = -1;
    for (const tile of layout.values()) maxOrder = Math.max(maxOrder, tile.order);
    const tile: StoredSoilTile = { tx, ty, order: maxOrder + 1, origin: "purchased" };
    layout.set(key, tile);
    return { ...tile };
  }

  const { data, error } = await supabase.rpc("place_homestead_soil_tile", {
    p_profile_id: profileId,
    p_tx: tx,
    p_ty: ty,
  });
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`Could not place that soil tile: ${error.message}`);
  }
  return data ? fromRow(data as SoilTileDbRow) : null;
}

/** Removes one purchased tile. Returns whether a row was actually deleted --
 *  false for a missing coordinate and, deliberately, for a starter tile: a
 *  starter bed is permanent and this never removes one. */
export async function removeStackAcresSoilTile(
  profileId: string,
  tx: number,
  ty: number,
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const layout = memoryLayout(profileId);
    const key = soilTileKey(tx, ty);
    const existing = layout.get(key);
    if (!existing || existing.origin !== "purchased") return false;
    return layout.delete(key);
  }
  const { data, error } = await supabase.rpc("remove_homestead_soil_tile", {
    p_profile_id: profileId,
    p_tx: tx,
    p_ty: ty,
  });
  if (error) throw new Error(`Could not remove that soil tile: ${error.message}`);
  return Boolean(data);
}
