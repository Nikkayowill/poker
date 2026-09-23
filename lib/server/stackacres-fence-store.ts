import "server-only";

import { FENCE_CAP, FENCE_WOOD_COST, fenceKey, type FencePiece } from "@/lib/stackacres/fences";
import { adjustStackAcresInventory } from "./stackacres-store";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the fences a player builds (lib/stackacres/fences.ts), in
 * `homestead_fences`.
 *
 * Wood moves in the same transaction as the piece: `place_homestead_fence`
 * takes it as the piece goes up, `remove_homestead_fence` gives it back as the
 * piece comes down (20260924120000_stackacres_fences.sql). The memory branch
 * does the same with a debit, then the insert, then a refund if the insert is
 * refused, which is safe in one process.
 */

declare global {
  var __riverRoomStackAcresFences: Map<string, Set<string>> | undefined;
}

const memoryFences = globalThis.__riverRoomStackAcresFences ?? new Map<string, Set<string>>();
globalThis.__riverRoomStackAcresFences = memoryFences;

export function __resetStackAcresFencesForTest(): void {
  memoryFences.clear();
}

export type FencePlacement = "placed" | "taken" | "full" | "short";

function parseKey(key: string): FencePiece {
  const [tx, ty] = key.split(",").map(Number);
  return { tx, ty };
}

export async function listStackAcresFences(profileId: string): Promise<FencePiece[]> {
  const supabase = adminClient();
  if (!supabase) return [...(memoryFences.get(profileId) ?? [])].map(parseKey);
  const { data, error } = await supabase.from("homestead_fences").select("tx, ty").eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your fences: ${error.message}`);
  return (data ?? []).map((row) => ({ tx: Number(row.tx), ty: Number(row.ty) }));
}

export async function placeStackAcresFence(profileId: string, tx: number, ty: number): Promise<FencePlacement> {
  const supabase = adminClient();
  if (!supabase) {
    const pieces = memoryFences.get(profileId) ?? new Set<string>();
    if (pieces.has(fenceKey(tx, ty))) return "taken";
    if (pieces.size >= FENCE_CAP) return "full";
    if ((await adjustStackAcresInventory(profileId, "wood", -FENCE_WOOD_COST)) === null) return "short";
    pieces.add(fenceKey(tx, ty));
    memoryFences.set(profileId, pieces);
    return "placed";
  }
  const { data, error } = await supabase.rpc("place_homestead_fence", {
    p_profile_id: profileId,
    p_tx: tx,
    p_ty: ty,
    p_wood: FENCE_WOOD_COST,
    p_cap: FENCE_CAP,
  });
  if (error) throw new Error(`Could not put the fence up: ${error.message}`);
  const outcome = String(data);
  if (outcome === "placed" || outcome === "taken" || outcome === "full" || outcome === "short") return outcome;
  throw new Error(`place_homestead_fence answered ${outcome}`);
}

/** True when this call took the piece down (and gave its Wood back). */
export async function removeStackAcresFence(profileId: string, tx: number, ty: number): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const pieces = memoryFences.get(profileId);
    if (!pieces?.delete(fenceKey(tx, ty))) return false;
    await adjustStackAcresInventory(profileId, "wood", FENCE_WOOD_COST);
    return true;
  }
  const { data, error } = await supabase.rpc("remove_homestead_fence", {
    p_profile_id: profileId,
    p_tx: tx,
    p_ty: ty,
    p_wood: FENCE_WOOD_COST,
  });
  if (error) throw new Error(`Could not take the fence down: ${error.message}`);
  return data === true;
}
