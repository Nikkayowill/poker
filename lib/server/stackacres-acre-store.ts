import "server-only";

import { isAcreId, type AcreId, type AcreSource, type OwnedAcre } from "@/lib/stackacres/acres";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the acres a farm owns (lib/stackacres/acres.ts), in
 * `homestead_acres`: one row per (profile, acre).
 *
 * The table only keeps what was bought or grandfathered. Where a bed or fence
 * may go is the pure `acreGate`'s call. Money moves in the service, before the
 * row exists (`buyStackAcresAcre`), so this file never touches a purse.
 */

declare global {
  var __riverRoomStackAcresAcres: Map<string, Map<AcreId, AcreSource>> | undefined;
}

const memoryAcres = globalThis.__riverRoomStackAcresAcres ?? new Map<string, Map<AcreId, AcreSource>>();
globalThis.__riverRoomStackAcresAcres = memoryAcres;

export function __resetStackAcresAcresForTest(): void {
  memoryAcres.clear();
}

/** Test seam: a farm that already owned ground before acres existed. */
export function __grantStackAcresAcreForTest(profileId: string, id: AcreId, source: AcreSource): void {
  const owned = memoryAcres.get(profileId) ?? new Map<AcreId, AcreSource>();
  owned.set(id, source);
  memoryAcres.set(profileId, owned);
}

/** Rows come in from `stackacres_read_batch` whole. An id this build does not know is skipped, not trusted. */
export function stackAcresAcresFromBatchRows(rows: readonly { acre_id: string; source: string }[]): OwnedAcre[] {
  const out: OwnedAcre[] = [];
  for (const row of rows) {
    if (!isAcreId(row.acre_id)) continue;
    out.push({ id: row.acre_id, source: row.source === "grandfathered" ? "grandfathered" : "bought" });
  }
  return out;
}

export async function listStackAcresAcres(profileId: string): Promise<OwnedAcre[]> {
  const supabase = adminClient();
  if (!supabase) return [...(memoryAcres.get(profileId) ?? [])].map(([id, source]) => ({ id, source }));
  const { data, error } = await supabase.from("homestead_acres").select("acre_id, source").eq("profile_id", profileId);
  if (error) throw new Error(`Could not read your acres: ${error.message}`);
  return stackAcresAcresFromBatchRows((data ?? []) as { acre_id: string; source: string }[]);
}

/**
 * Writes one bought acre. True when this call wrote it, false when the farm
 * already held it (a second tap, or another tab), so the caller can put the
 * price back. The insert ignores a duplicate and returns the row at most once.
 */
export async function insertStackAcresAcre(profileId: string, id: AcreId): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryAcres.get(profileId) ?? new Map<AcreId, AcreSource>();
    if (owned.has(id)) return false;
    owned.set(id, "bought");
    memoryAcres.set(profileId, owned);
    return true;
  }
  const { data, error } = await supabase
    .from("homestead_acres")
    .upsert({ profile_id: profileId, acre_id: id, source: "bought" }, { onConflict: "profile_id,acre_id", ignoreDuplicates: true })
    .select("acre_id");
  if (error) throw new Error(`Could not record your acre: ${error.message}`);
  return (data ?? []).length > 0;
}
