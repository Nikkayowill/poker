import "server-only";

import { isStackAcresCrop, type SeedStock, type StackAcresCrop } from "@/lib/stackacres/catalogue";
import { adminClient } from "./supabase-admin";

/**
 * Ray's seed shelf: crop seeds bought but not planted yet, in
 * `homestead_seed_stock`.
 *
 * SAME SHAPE AS ./stackacres-soil-store.ts's soil-shelf half, keyed by crop
 * instead of soil tier: a service-role-only table, a Supabase RPC, and an
 * in-process Map fallback that enforces the same "never negative" rule the
 * DB does, so dev behaves like prod. Unlike soil, there is no second table
 * here for a placed/planted layout -- a seed is either on the shelf or it is
 * spent, consumed the instant `stockStackAcres` plants it; there is no
 * intermediate "laid down but not yet a unit" state a crop seed passes
 * through the way a soil bag passes through a map tile.
 */

export type { SeedStock } from "@/lib/stackacres/catalogue";

declare global {
  var __riverRoomStackAcresSeedStock: Map<string, Map<StackAcresCrop, number>> | undefined;
}

const memorySeedStock =
  globalThis.__riverRoomStackAcresSeedStock ?? new Map<string, Map<StackAcresCrop, number>>();
globalThis.__riverRoomStackAcresSeedStock = memorySeedStock;

/** Test seam: drop every in-memory seed shelf. */
export function __resetStackAcresSeedStockForTest(): void {
  memorySeedStock.clear();
}

function memoryStock(profileId: string): Map<StackAcresCrop, number> {
  let held = memorySeedStock.get(profileId);
  if (!held) {
    held = new Map<StackAcresCrop, number>();
    memorySeedStock.set(profileId, held);
  }
  return held;
}

export async function readStackAcresSeedStock(profileId: string): Promise<SeedStock> {
  const supabase = adminClient();
  if (!supabase) {
    return Object.fromEntries(memoryStock(profileId)) as SeedStock;
  }
  const { data, error } = await supabase
    .from("homestead_seed_stock")
    .select("crop, quantity")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not read the seed shelf: ${error.message}`);
  const out: SeedStock = {};
  for (const row of (data ?? []) as { crop: string; quantity: number | string }[]) {
    // Unknown crops are DROPPED rather than degraded to a known one: unlike a
    // placed unit (which stands on the map and must render somehow), an
    // unrecognised seed has nothing to grow into and folding it into another
    // crop's count would hand the player free seed of something else.
    if (isStackAcresCrop(row.crop)) out[row.crop] = Number(row.quantity);
  }
  return out;
}

/**
 * Moves one crop's seed count. Returns the new quantity, or null when the
 * move would go negative -- "you have none in stock" for a spend, and a lost
 * race for two plantings racing the last seed.
 *
 * Null, never a throw, for the same reason `spendGoldByProfile` and
 * `adjustStackAcresSoilStock` return null on an empty balance: the caller's
 * job is to refuse the action cleanly, and a refusal is not an error
 * condition.
 */
export async function adjustStackAcresSeedStock(
  profileId: string,
  crop: StackAcresCrop,
  delta: number,
): Promise<number | null> {
  const supabase = adminClient();
  if (!supabase) {
    const held = memoryStock(profileId);
    const next = (held.get(crop) ?? 0) + delta;
    // Mirrors the DB's own `quantity >= 0` CHECK so dev behaves like prod.
    if (next < 0) return null;
    held.set(crop, next);
    return next;
  }
  const { data, error } = await supabase.rpc("adjust_homestead_seed_stock", {
    p_profile_id: profileId,
    p_crop: crop,
    p_delta: delta,
  });
  if (error) {
    // 23514 is the quantity CHECK refusing to go negative.
    if (error.code === "23514") return null;
    throw new Error(`Could not move that seed stock: ${error.message}`);
  }
  return typeof data === "number" ? data : Number(data);
}
