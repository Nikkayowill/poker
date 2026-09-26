import "server-only";

import { randomUUID } from "node:crypto";
import {
  EMPIRE_BUILDINGS,
  isEmpireBuildingKind,
  layoutFingerprint,
  type EmpireBuilding,
  type EmpireBuildingKind,
} from "@/lib/stackacres/empire-buildings";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the buildings a player owns on the Far Field (lib/stackacres/empire-buildings.ts), in
 * `empire_buildings`.
 *
 * Paying is the service's job and happens before a new building is written here. `place_empire_building`
 * (20260930220000_stackacres_empire_buildings.sql) is the only writer of a spot and refuses one that
 * overlaps another of the player's buildings, under a lock, so two taps can't stack them. The memory
 * branch makes the same check in one process.
 */

interface StoredBuilding extends EmpireBuilding {
  w: number;
  h: number;
}

declare global {
  var __riverRoomStackAcresEmpireBuildings: Map<string, StoredBuilding[]> | undefined;
}

const memoryBuildings = globalThis.__riverRoomStackAcresEmpireBuildings ?? new Map<string, StoredBuilding[]>();
globalThis.__riverRoomStackAcresEmpireBuildings = memoryBuildings;

export function __resetStackAcresEmpireBuildingsForTest(): void {
  memoryBuildings.clear();
}

export type EmpirePlacement = { placed: string } | "stale" | "overlap" | "missing";

function overlaps(a: { tx: number; ty: number; w: number; h: number }, b: { tx: number; ty: number; w: number; h: number }): boolean {
  return a.tx < b.tx + b.w && b.tx < a.tx + a.w && a.ty < b.ty + b.h && b.ty < a.ty + a.h;
}

export async function listEmpireBuildings(profileId: string): Promise<EmpireBuilding[]> {
  const supabase = adminClient();
  if (!supabase) return (memoryBuildings.get(profileId) ?? []).map(({ id, kind, tx, ty }) => ({ id, kind, tx, ty }));
  const { data, error } = await supabase
    .from("empire_buildings")
    .select("id, kind, tx, ty")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read your buildings: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const kind = String(row.kind);
    if (!isEmpireBuildingKind(kind)) return [];
    return [{ id: String(row.id), kind, tx: row.tx === null ? null : Number(row.tx), ty: row.ty === null ? null : Number(row.ty) }];
  });
}

/**
 * Puts down a new building (`id` null, already paid for) or one the player owns, moved or out of storage.
 * `expected` is the layout the caller checked the placement rules against (`layoutFingerprint`); if it has
 * changed since, nothing is written and the answer is "stale".
 */
export async function placeEmpireBuilding(
  profileId: string,
  id: string | null,
  kind: EmpireBuildingKind,
  tx: number,
  ty: number,
  expected: string,
): Promise<EmpirePlacement> {
  const { w, h } = EMPIRE_BUILDINGS[kind];
  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryBuildings.get(profileId) ?? [];
    if (layoutFingerprint(owned) !== expected) return "stale";
    const spot = { tx, ty, w, h };
    if (owned.some((b) => b.id !== id && b.tx !== null && b.ty !== null && overlaps({ tx: b.tx, ty: b.ty, w: b.w, h: b.h }, spot))) {
      return "overlap";
    }
    if (id === null) {
      const building: StoredBuilding = { id: randomUUID(), kind, tx, ty, w, h };
      memoryBuildings.set(profileId, [...owned, building]);
      return { placed: building.id };
    }
    const building = owned.find((b) => b.id === id);
    if (!building) return "missing";
    Object.assign(building, { tx, ty, w, h });
    return { placed: building.id };
  }
  const { data, error } = await supabase.rpc("place_empire_building", {
    p_profile_id: profileId,
    p_id: id,
    p_kind: kind,
    p_tx: tx,
    p_ty: ty,
    p_w: w,
    p_h: h,
    p_expected: expected,
  });
  if (error) throw new Error(`Could not put the building down: ${error.message}`);
  const outcome = String(data);
  if (outcome === "stale" || outcome === "overlap" || outcome === "missing") return outcome;
  return { placed: outcome };
}

/** Picks a placed building up into storage. True when this call moved it. */
export async function pickUpEmpireBuilding(profileId: string, id: string): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const building = memoryBuildings.get(profileId)?.find((b) => b.id === id);
    if (!building || building.tx === null) return false;
    building.tx = null;
    building.ty = null;
    return true;
  }
  const { data, error } = await supabase
    .from("empire_buildings")
    .update({ tx: null, ty: null, updated_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .eq("id", id)
    .not("tx", "is", null)
    .select("id");
  if (error) throw new Error(`Could not pick the building up: ${error.message}`);
  return (data ?? []).length > 0;
}
