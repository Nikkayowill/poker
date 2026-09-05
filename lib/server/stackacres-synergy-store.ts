import "server-only";
import { adminClient } from "./supabase-admin";
import {
  SYNERGY_SESSION_IDLE_MS,
  isSynergyArchetype,
  type SynergyArchetype,
} from "@/lib/stackacres/synergy-perks";

/**
 * I/O for the Synergy Tree. Same split as every other StackAcres subsystem:
 * this file knows about Postgres and memory-mode fallback (CLAUDE.md: "absent
 * env vars, stores use memory"); `lib/stackacres/synergy-perks.ts` knows
 * nothing about either and is what actually computes a buff.
 *
 * Memory-mode mirrors the RPCs' contracts by hand rather than sharing code
 * with them, the same posture stackacres-store.ts already takes for every
 * sibling table -- there is no SQL to fall back to in memory-mode, so the
 * two branches are necessarily two implementations of the same rule.
 */

interface MemoryPerkUnlocks {
  owned: Set<string>;
}

interface MemorySessionLoadout {
  slots: Map<number, { perkId: string; activatedAt: number }>;
  lastTouchedAt: number;
}

declare global {
  var __riverRoomStackAcresPerkUnlocks: Map<string, MemoryPerkUnlocks> | undefined;
  var __riverRoomStackAcresSessionLoadout: Map<string, MemorySessionLoadout> | undefined;
}

const memoryUnlocks = globalThis.__riverRoomStackAcresPerkUnlocks ?? new Map<string, MemoryPerkUnlocks>();
globalThis.__riverRoomStackAcresPerkUnlocks = memoryUnlocks;

const memoryLoadouts = globalThis.__riverRoomStackAcresSessionLoadout ?? new Map<string, MemorySessionLoadout>();
globalThis.__riverRoomStackAcresSessionLoadout = memoryLoadouts;

export type UnlockPerkOutcome =
  | { success: true; goldBalance: number }
  | { success: false; reason: "already_owned" | "insufficient_gold" | "no_such_profile"; goldBalance: number };

/**
 * Permanently unlocks a perk, debiting Gold in the same call. Mirrors
 * `unlock_stackacres_perk`'s contract exactly -- see its own migration
 * comment for why the debit and the grant are one atomic step live, and why
 * an already-owned perk is a no-op refusal rather than a second charge.
 */
export async function unlockStackAcresPerk(
  profileId: string,
  itemId: string,
  costGold: number,
): Promise<UnlockPerkOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const record = memoryUnlocks.get(profileId) ?? { owned: new Set<string>() };
    memoryUnlocks.set(profileId, record);
    if (record.owned.has(itemId)) {
      return { success: false, reason: "already_owned", goldBalance: 0 };
    }
    // Memory-mode has no shared Gold ledger to charge against here (the
    // poker/arcade memory stores that own gold_balance live elsewhere and
    // this store has no import path to them without a cycle) -- unlocking
    // always succeeds in memory-mode, the same simplification
    // stackacres-store.ts's own memory branches take for anything that
    // would otherwise need cross-store coordination purely for local/dev
    // testing.
    record.owned.add(itemId);
    return { success: true, goldBalance: 0 };
  }

  const { data, error } = await supabase.rpc("unlock_stackacres_perk", {
    p_profile_id: profileId,
    p_item_id: itemId,
    p_cost: costGold,
  });
  if (error) throw new Error(`Could not unlock perk: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("unlock_stackacres_perk returned no row");
  if (row.success) return { success: true, goldBalance: Number(row.gold_balance) };
  return {
    success: false,
    reason: row.reason as "already_owned" | "insufficient_gold" | "no_such_profile",
    goldBalance: Number(row.gold_balance ?? 0),
  };
}

/** Every permanently-owned perk item_id for a profile (quantity > 0). */
export async function listOwnedStackAcresPerks(profileId: string): Promise<string[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...(memoryUnlocks.get(profileId)?.owned ?? [])];
  }

  const { data, error } = await supabase
    .from("stackacres_perk_unlocks")
    .select("item_id")
    .eq("profile_id", profileId)
    .gt("quantity", 0);
  if (error) throw new Error(`Could not read owned perks: ${error.message}`);
  return (data ?? []).map((row) => String(row.item_id));
}

export type ActivatePerkOutcome = { success: true } | { success: false; reason: "not_owned" };

/**
 * Slots an owned perk into the session loadout. Ownership is re-checked
 * server-side (memory-mode) / database-side (live), never trusted from the
 * caller -- see activate_stackacres_session_perk's own comment.
 */
export async function activateStackAcresSessionPerk(
  profileId: string,
  perkId: string,
  slot: number,
): Promise<ActivatePerkOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryUnlocks.get(profileId)?.owned;
    if (!owned?.has(perkId)) return { success: false, reason: "not_owned" };
    const loadout = memoryLoadouts.get(profileId) ?? { slots: new Map(), lastTouchedAt: Date.now() };
    memoryLoadouts.set(profileId, loadout);
    for (const [existingSlot, entry] of loadout.slots) {
      if (entry.perkId === perkId && existingSlot !== slot) loadout.slots.delete(existingSlot);
    }
    loadout.slots.set(slot, { perkId, activatedAt: Date.now() });
    loadout.lastTouchedAt = Date.now();
    return { success: true };
  }

  const { data, error } = await supabase.rpc("activate_stackacres_session_perk", {
    p_profile_id: profileId,
    p_perk_id: perkId,
    p_slot: slot,
  });
  if (error) throw new Error(`Could not activate perk: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.success) return { success: true };
  return { success: false, reason: "not_owned" };
}

/**
 * The active loadout for this session, or an empty one once the session has
 * gone idle past `idleMs` -- the lazy sweep lives here (mirroring
 * get_active_stackacres_synergies), not in a background job. Filters out any
 * id that isn't a live archetype rather than surfacing it, matching
 * `applySynergyEffects`'s own "ignore, don't throw" posture for the same
 * shape of stale data.
 */
export async function getActiveStackAcresSynergies(
  profileId: string,
  idleMs: number = SYNERGY_SESSION_IDLE_MS,
): Promise<SynergyArchetype[]> {
  const supabase = adminClient();
  if (!supabase) {
    const loadout = memoryLoadouts.get(profileId);
    if (!loadout) return [];
    if (Date.now() - loadout.lastTouchedAt > idleMs) {
      memoryLoadouts.delete(profileId);
      return [];
    }
    return [...loadout.slots.values()]
      .map((entry) => entry.perkId)
      .filter(isSynergyArchetype);
  }

  const { data, error } = await supabase.rpc("get_active_stackacres_synergies", {
    p_profile_id: profileId,
    p_idle_ms: idleMs,
  });
  if (error) throw new Error(`Could not read active synergies: ${error.message}`);
  return (data ?? []).map((row: { perk_id: string }) => row.perk_id).filter(isSynergyArchetype);
}

/** Explicit early clear (sign-out, leaving the table) -- see
 *  clear_stackacres_session_perks's own comment on why this is a courtesy,
 *  not the mechanism that actually guarantees clearing. */
export async function clearStackAcresSessionPerks(profileId: string): Promise<void> {
  const supabase = adminClient();
  if (!supabase) {
    memoryLoadouts.delete(profileId);
    return;
  }

  const { error } = await supabase.rpc("clear_stackacres_session_perks", { p_profile_id: profileId });
  if (error) throw new Error(`Could not clear session perks: ${error.message}`);
}
