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

/** What `insertStackAcresAcre` did: wrote it, found it already owned, or found the farm's acre count moved. */
export type AcreAddition = "added" | "owned" | "stale";

/**
 * Writes one bought acre, under a per-farm lock (`add_homestead_acre`).
 * `expectedOwned` is the count the price was worked out from; when another
 * purchase landed since, the write is refused as "stale" so the caller can put
 * the price back instead of selling a later acre at an earlier price.
 */
export async function insertStackAcresAcre(profileId: string, id: AcreId, expectedOwned: number): Promise<AcreAddition> {
  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryAcres.get(profileId) ?? new Map<AcreId, AcreSource>();
    if (owned.has(id)) return "owned";
    if (owned.size !== expectedOwned) return "stale";
    owned.set(id, "bought");
    memoryAcres.set(profileId, owned);
    return "added";
  }
  const { data, error } = await supabase.rpc("add_homestead_acre", {
    p_profile_id: profileId,
    p_acre_id: id,
    p_expected_owned: expectedOwned,
  });
  if (error) throw new Error(`Could not record your acre: ${error.message}`);
  const outcome = String(data);
  if (outcome === "added" || outcome === "owned" || outcome === "stale") return outcome;
  throw new Error(`Could not record your acre: unexpected answer ${outcome}`);
}
