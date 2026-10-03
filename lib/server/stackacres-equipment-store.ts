import "server-only";

import {
  ownedStackAcresEquipment,
  type StackAcresBuyableEquipment,
  type StackAcresEquipment,
} from "@/lib/stackacres/tractor";
import { adminClient } from "./supabase-admin";

/**
 * Farm equipment a player owns (lib/stackacres/tractor.ts), in
 * `homestead_equipment`. Same shape as `homestead_cutter`: the primary key is
 * the settlement guard, so paying is the service's job and happens first, and
 * a write that lands nothing tells it to refund.
 */

declare global {
  var __riverRoomStackAcresEquipment: Map<string, Set<StackAcresEquipment>> | undefined;
}

const memoryEquipment =
  globalThis.__riverRoomStackAcresEquipment ?? new Map<string, Set<StackAcresEquipment>>();
globalThis.__riverRoomStackAcresEquipment = memoryEquipment;

export function __resetStackAcresEquipmentForTest(): void {
  memoryEquipment.clear();
}

export async function readStackAcresEquipment(profileId: string): Promise<StackAcresEquipment[]> {
  const supabase = adminClient();
  if (!supabase) return ownedStackAcresEquipment([...(memoryEquipment.get(profileId) ?? [])]);
  const { data, error } = await supabase.from("homestead_equipment").select("kind").eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your equipment: ${error.message}`);
  return ownedStackAcresEquipment(((data ?? []) as { kind: unknown }[]).map((row) => row.kind));
}

/** Records a machine the caller has already paid for. True when this call wrote it, false when it was already owned. */
export async function recordStackAcresEquipment(
  profileId: string,
  kind: StackAcresBuyableEquipment,
): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryEquipment.get(profileId) ?? new Set<StackAcresEquipment>();
    if (owned.has(kind)) return false;
    owned.add(kind);
    memoryEquipment.set(profileId, owned);
    return true;
  }
  const { data, error } = await supabase
    .from("homestead_equipment")
    .upsert({ profile_id: profileId, kind }, { onConflict: "profile_id,kind", ignoreDuplicates: true })
    .select("kind");
  if (error) throw new Error(`Could not record your ${kind}: ${error.message}`);
  return (data ?? []).length > 0;
}
