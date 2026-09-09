import "server-only";

import { soilTileKey, type SoilTile, type SoilTileOrigin } from "@/lib/stackacres/soil";
import {
  SOIL_DEFAULT_TIER,
  isSoilTier,
  toSoilTier,
  type SoilStock,
  type SoilTier,
} from "@/lib/stackacres/soil-tiers";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for placed soil tiles, in `homestead_soil_tiles`.
 *
 * ITS OWN TABLE AND RPCs, same shape as ./stackacres-pipe-store.ts: a small
 * per-row table, service-role only, a Supabase branch and an in-process Map
 * fallback that enforces the same rules the DB does so dev behaves like
 * prod.
 *
 * ONLY PURCHASED TILES LIVE HERE. A free starter grant USED TO exist,
 * derived fresh on every load rather than written here -- see
 * lib/stackacres/soil.ts's "starter kit" section for why it was removed
 * outright. This store's `origin` column exists only so
 * `removeStackAcresSoilTile` can refuse a row it did not create, but in
 * practice every row here reads `'purchased'`.
 */

export type StoredSoilTile = SoilTile;

interface SoilTileDbRow {
  tx: number | string;
  ty: number | string;
  tile_order: number | string;
  origin: string;
  tier: string | null;
}

const SOIL_TILE_COLUMNS = "tx, ty, tile_order, origin, tier";

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
    // Degrades to the plain bed rather than throwing: a row predating the
    // tier column reads null here, and that row IS a plain bed.
    tier: toSoilTier(row.tier),
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

/** What one call to `placeStackAcresSoilTile` actually did. A bed is one
 *  tile now (lib/stackacres/soil.ts's `plantSoilTile`, the pure version of
 *  this same decision), so the only two outcomes left are a fresh bed or a
 *  coordinate already spoken for -- plus `raced` for the one failure mode
 *  that only exists once real concurrency is involved: a second request
 *  landing on the same bare coordinate a moment before this one's insert. */
export type PlaceSoilSlotOutcome =
  | { kind: "created"; tile: StoredSoilTile }
  | { kind: "occupied" }
  | { kind: "raced" };

/**
 * Plants one bed at `(tx, ty)`, tiered. A bare coordinate becomes a bed;
 * anything already standing there -- another bed, purchased or starter --
 * refuses outright rather than overwriting or growing. The caller treats
 * every refusal kind exactly like a lost race and refunds the bag it already
 * spent -- see `placeStackAcresSoilTile` in stackacres-service.ts.
 */
export async function placeStackAcresSoilTile(
  profileId: string,
  tx: number,
  ty: number,
  tier: SoilTier = SOIL_DEFAULT_TIER,
): Promise<PlaceSoilSlotOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const layout = memoryLayout(profileId);
    const key = soilTileKey(tx, ty);
    if (layout.has(key)) return { kind: "occupied" };
    let maxOrder = -1;
    for (const t of layout.values()) maxOrder = Math.max(maxOrder, t.order);
    const tile: StoredSoilTile = { tx, ty, order: maxOrder + 1, origin: "purchased", tier };
    layout.set(key, tile);
    return { kind: "created", tile: { ...tile } };
  }

  const { data, error } = await supabase.rpc("place_homestead_soil_tile", {
    p_profile_id: profileId,
    p_tx: tx,
    p_ty: ty,
    p_tier: tier,
  });
  if (error) {
    // ST003 is the migration's own custom SQLSTATE for a bed already
    // standing at this coordinate.
    if (error.code === "ST003") return { kind: "occupied" };
    if (error.code === "23505") return { kind: "raced" };
    throw new Error(`Could not place that soil tile: ${error.message}`);
  }
  if (!data) return { kind: "raced" };
  return { kind: "created", tile: fromRow(data as SoilTileDbRow) };
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

/* ------------------------------------------------------------------ */
/* Ray's soil shelf: bags bought but not laid down yet                 */
/* ------------------------------------------------------------------ */

/**
 * Unplaced bags per tier, in `homestead_soil_stock`.
 *
 * SEPARATE FROM THE TILE TABLE ABOVE on purpose: one is a map, the other is a
 * purse. Buying moves Gold and never touches a coordinate; placing moves a
 * coordinate and never touches Gold. Keeping them apart is what stops a
 * failed placement from having to reason about a refund in two currencies.
 */
export type { SoilStock } from "@/lib/stackacres/soil-tiers";

declare global {
  var __riverRoomStackAcresSoilStock: Map<string, Map<SoilTier, number>> | undefined;
}

const memorySoilStock =
  globalThis.__riverRoomStackAcresSoilStock ?? new Map<string, Map<SoilTier, number>>();
globalThis.__riverRoomStackAcresSoilStock = memorySoilStock;

/** Test seam: drop every in-memory soil shelf. */
export function __resetStackAcresSoilStockForTest(): void {
  memorySoilStock.clear();
}

function memoryStock(profileId: string): Map<SoilTier, number> {
  let held = memorySoilStock.get(profileId);
  if (!held) {
    held = new Map<SoilTier, number>();
    memorySoilStock.set(profileId, held);
  }
  return held;
}

export async function readStackAcresSoilStock(profileId: string): Promise<SoilStock> {
  const supabase = adminClient();
  if (!supabase) {
    return Object.fromEntries(memoryStock(profileId)) as SoilStock;
  }
  const { data, error } = await supabase
    .from("homestead_soil_stock")
    .select("tier, quantity")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read the soil shelf: ${error.message}`);
  const out: SoilStock = {};
  for (const row of (data ?? []) as { tier: string; quantity: number | string }[]) {
    // Unknown tiers are DROPPED rather than degraded to dirt here: unlike a
    // placed bed (which exists on the map and must render somehow), an
    // unrecognised bag has nothing to show and folding it into the dirt count
    // would hand the player free plain beds for a tier we retired.
    if (isSoilTier(row.tier)) out[row.tier] = Number(row.quantity);
  }
  return out;
}

/**
 * Moves one tier's bag count. Returns the new quantity, or null when the move
 * would go negative -- which is "you have none in stock" for a spend, and a
 * lost race for two placements racing the last bag.
 *
 * Null, never a throw, for the same reason `spendGoldByProfile` returns null on
 * an empty purse: the caller's job is to refuse the action cleanly, and a
 * refusal is not an error condition.
 */
export async function adjustStackAcresSoilStock(
  profileId: string,
  tier: SoilTier,
  delta: number,
): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const held = memoryStock(profileId);
    const next = (held.get(tier) ?? 0) + delta;
    // Mirrors the DB's own `quantity >= 0` CHECK so dev behaves like prod.
    if (next < 0) return null;
    held.set(tier, next);
    return next;
  }
  const { data, error } = await supabase.rpc("adjust_homestead_soil_stock", {
    p_profile_id: profileId,
    p_tier: tier,
    p_delta: delta,
  });
  if (error) {
    // 23514 is the quantity CHECK refusing to go negative.
    if (error.code === "23514") return null;
    throw new Error(`Could not move that soil stock: ${error.message}`);
  }
  return typeof data === "number" ? data : Number(data);
}
