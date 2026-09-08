import "server-only";
import { adminClient } from "./supabase-admin";

/**
 * I/O for the Sunlight Forge. Same split as every other StackAcres
 * subsystem, and the same shape as stackacres-synergy-store.ts specifically:
 * this file knows about Postgres and memory-mode fallback (CLAUDE.md:
 * "absent env vars, stores use memory"); lib/stackacres/forge.ts knows
 * nothing about either and is what actually computes the forged stats.
 *
 * Memory-mode mirrors forge_stackacres_enchantment's contract by hand rather
 * than sharing code with it -- there is no SQL to fall back to in
 * memory-mode, the same reason every sibling store here has two branches.
 * Memory-mode also has no shared processing-inventory ledger to charge
 * against here (the same gap stackacres-synergy-store.ts's own memory
 * branch notes for Gold): forging always succeeds in memory-mode once, the
 * same simplification unlockStackAcresPerk's memory branch already takes.
 */

interface MemoryForgeOwnership {
  owned: Set<string>;
}

declare global {
  var __riverRoomStackAcresForgeOwnership: Map<string, MemoryForgeOwnership> | undefined;
}

const memoryOwnership =
  globalThis.__riverRoomStackAcresForgeOwnership ?? new Map<string, MemoryForgeOwnership>();
globalThis.__riverRoomStackAcresForgeOwnership = memoryOwnership;

export type ForgeEnchantmentOutcome =
  | { success: true; goldBalance: number; materialBalance: number }
  | {
      success: false;
      reason: "already_owned" | "insufficient_material" | "insufficient_gold" | "no_such_profile";
      goldBalance: number;
      materialBalance: number;
    };

/**
 * Permanently forges one enchantment, debiting Gold AND a processing-track
 * material in the same call. Mirrors `forge_stackacres_enchantment`'s
 * contract exactly -- see its own migration comment for the row-locking
 * sequence that makes this safe against a short balance on either resource.
 */
export async function forgeStackAcresEnchantment(
  profileId: string,
  itemId: string,
  goldCostGold: number,
  materialItem: string,
  materialQuantity: number,
): Promise<ForgeEnchantmentOutcome> {
  const supabase = adminClient();
  if (!supabase) {
    const record = memoryOwnership.get(profileId) ?? { owned: new Set<string>() };
    memoryOwnership.set(profileId, record);
    if (record.owned.has(itemId)) {
      return { success: false, reason: "already_owned", goldBalance: 0, materialBalance: 0 };
    }
    record.owned.add(itemId);
    return { success: true, goldBalance: 0, materialBalance: 0 };
  }

  const { data, error } = await supabase.rpc("forge_stackacres_enchantment", {
    p_profile_id: profileId,
    p_item_id: itemId,
    p_gold_cost: goldCostGold,
    p_material_item: materialItem,
    p_material_quantity: materialQuantity,
  });
  if (error) throw new Error(`Could not forge enchantment: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("forge_stackacres_enchantment returned no row");
  if (row.success) {
    return {
      success: true,
      goldBalance: Number(row.gold_balance),
      materialBalance: Number(row.material_balance),
    };
  }
  return {
    success: false,
    reason: row.reason as "already_owned" | "insufficient_material" | "insufficient_gold" | "no_such_profile",
    goldBalance: Number(row.gold_balance ?? 0),
    materialBalance: Number(row.material_balance ?? 0),
  };
}

/** Every permanently-forged enchantment item_id for a profile (quantity > 0). */
export async function listOwnedStackAcresEnchantments(profileId: string): Promise<string[]> {
  const supabase = adminClient();
  if (!supabase) {
    return [...(memoryOwnership.get(profileId)?.owned ?? [])];
  }

  const { data, error } = await supabase
    .from("stackacres_tool_enchantments")
    .select("item_id")
    .eq("profile_id", profileId)
    .gt("quantity", 0);
  if (error) throw new Error(`Could not read owned enchantments: ${error.message}`);
  return (data ?? []).map((row) => String(row.item_id));
}
