import "server-only";

import { isGroceryItemKind, type GroceryPlacement } from "@/lib/stackacres/grocery-layout";
import type { GroceryState } from "@/lib/stackacres/grocery";
import { adminClient } from "./supabase-admin";

/**
 * Persistence for the city grocery a player owns (lib/stackacres/grocery.ts), in `empire_grocery`
 * (20260930230000_stackacres_grocery.sql).
 *
 * Every write names the version it read and lands only if the row is still at it, bumping it by one. The
 * service reads, works out the change, and writes; a write that finds the row moved on changes nothing and
 * the service reads again. Paying for anything is the service's job.
 */

declare global {
  var __riverRoomStackAcresGrocery: Map<string, GroceryState> | undefined;
}

const memoryGrocery = globalThis.__riverRoomStackAcresGrocery ?? new Map<string, GroceryState>();
globalThis.__riverRoomStackAcresGrocery = memoryGrocery;

export function __resetStackAcresGroceryForTest(): void {
  memoryGrocery.clear();
}

const clone = (state: GroceryState): GroceryState => ({
  ...state,
  staff: [...state.staff],
  layout: state.layout.map((item) => ({ ...item })),
  till: { ...state.till },
});

function layoutOf(value: unknown): GroceryPlacement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const kind = String(item.kind);
    if (typeof item.id !== "string" || !isGroceryItemKind(kind)) return [];
    const tx = typeof item.tx === "number" ? item.tx : null;
    const ty = typeof item.ty === "number" ? item.ty : null;
    return [{ id: item.id, kind, tx: tx === null || ty === null ? null : tx, ty: tx === null || ty === null ? null : ty }];
  });
}

export async function readGrocery(profileId: string): Promise<GroceryState | null> {
  const supabase = adminClient();
  if (!supabase) {
    const state = memoryGrocery.get(profileId);
    return state ? clone(state) : null;
  }
  const { data, error } = await supabase
    .from("empire_grocery")
    .select("staff, layout, till_takings, till_wages, till_since, till_opened_at, collected, version")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read your store: ${error.message}`);
  if (!data) return null;
  return {
    staff: (data.staff ?? []).map(String),
    layout: layoutOf(data.layout),
    till: {
      takings: Number(data.till_takings),
      wages: Number(data.till_wages),
      since: new Date(String(data.till_since)).toISOString(),
      openedAt: new Date(String(data.till_opened_at)).toISOString(),
    },
    collected: Number(data.collected),
    version: Number(data.version),
  };
}

/** Takes the store over. False when this player already has it. */
export async function createGrocery(profileId: string, state: Omit<GroceryState, "version">): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    if (memoryGrocery.has(profileId)) return false;
    memoryGrocery.set(profileId, clone({ ...state, version: 0 }));
    return true;
  }
  const { data, error } = await supabase
    .from("empire_grocery")
    .upsert(
      {
        profile_id: profileId,
        staff: state.staff,
        layout: state.layout,
        till_takings: state.till.takings,
        till_wages: state.till.wages,
        till_since: state.till.since,
        till_opened_at: state.till.openedAt,
        collected: state.collected,
        version: 0,
      },
      { onConflict: "profile_id", ignoreDuplicates: true },
    )
    .select("profile_id");
  if (error) throw new Error(`Could not take the store over: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Writes the store as `next` if it is still at `expected` (the version it was read at), moving it on by one.
 * True when this call wrote it.
 */
export async function writeGrocery(profileId: string, expected: number, next: Omit<GroceryState, "version">): Promise<boolean> {
  const supabase = adminClient();
  if (!supabase) {
    const current = memoryGrocery.get(profileId);
    if (!current || current.version !== expected) return false;
    memoryGrocery.set(profileId, clone({ ...next, version: expected + 1 }));
    return true;
  }
  const { data, error } = await supabase
    .from("empire_grocery")
    .update({
      staff: next.staff,
      layout: next.layout,
      till_takings: next.till.takings,
      till_wages: next.till.wages,
      till_since: next.till.since,
      till_opened_at: next.till.openedAt,
      collected: next.collected,
      version: expected + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", profileId)
    .eq("version", expected)
    .select("profile_id");
  if (error) throw new Error(`Could not save your store: ${error.message}`);
  return (data ?? []).length > 0;
}
