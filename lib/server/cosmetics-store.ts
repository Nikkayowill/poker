import "server-only";
import {
  cosmetics,
  cosmeticById,
  isFreeCosmetic,
  isPurchasable,
  normalizeEquipped,
  type EquippedCosmetics,
} from "@/lib/cosmetics/catalog";
import type { PlayerProfile } from "@/lib/profile/types";
import { ensureProfile, setEquippedInMemory, spendGold } from "./profile-store";
import { adminClient } from "./supabase-admin";

declare global {
  var __riverRoomCosmetics: Map<string, Set<string>> | undefined;
}

/** Memory-mode ownership, keyed by profile id to mirror the real table. */
const memoryOwned = globalThis.__riverRoomCosmetics ?? new Map<string, Set<string>>();
globalThis.__riverRoomCosmetics = memoryOwned;

/**
 * Every cosmetic a profile can currently equip. Free items are granted to
 * everyone implicitly rather than written to the ownership table, so the
 * table only ever holds things that were actually earned or bought.
 */
export async function listOwnedCosmetics(profileId: string): Promise<string[]> {
  const free = cosmetics.filter(isFreeCosmetic).map((item) => item.id);

  const supabase = adminClient();
  if (!supabase) {
    return [...new Set([...free, ...(memoryOwned.get(profileId) ?? [])])];
  }

  const { data, error } = await supabase
    .from("player_cosmetics")
    .select("cosmetic_id")
    .eq("profile_id", profileId);
  if (error) throw new Error(`Could not load your collection: ${error.message}`);
  return [...new Set([...free, ...(data ?? []).map((row) => String(row.cosmetic_id))])];
}

export interface PurchaseResult {
  profile: PlayerProfile;
  owned: string[];
}

/**
 * Buys a cosmetic. Price and eligibility come from the catalog on the server,
 * never from the request, so a client cannot name its own price or buy
 * something that isn't for sale.
 *
 * The Supabase path defers to the purchase_cosmetic RPC, which does the
 * balance check, the debit and the ownership insert in one locked
 * transaction -- otherwise two concurrent clicks could spend once and own
 * twice, or own once and pay twice.
 */
export async function purchaseCosmetic(
  token: string,
  profile: PlayerProfile,
  cosmeticId: string,
): Promise<PurchaseResult> {
  const item = cosmeticById(cosmeticId);
  if (!item) throw new Error("That item doesn't exist.");
  if (isFreeCosmetic(item)) throw new Error("That item is already yours.");
  if (!isPurchasable(item)) {
    // Signature items are earned. Refusing here rather than pricing them is
    // the rule that keeps the best-looking things at the table unbuyable.
    throw new Error("That item can only be earned, not bought.");
  }
  const price = item.price as number;

  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryOwned.get(profile.id) ?? new Set<string>();
    if (owned.has(cosmeticId)) throw new Error("You already own that item.");
    if (!profile.unlimitedGold && profile.goldBalance < price) {
      throw new Error("Not enough Gold.");
    }
    const updated = profile.unlimitedGold ? profile : await spendGold(token, price);
    owned.add(cosmeticId);
    memoryOwned.set(profile.id, owned);
    return { profile: updated, owned: await listOwnedCosmetics(profile.id) };
  }

  const { data, error } = await supabase
    .rpc("purchase_cosmetic", { p_token: token, p_cosmetic_id: cosmeticId, p_price: price })
    .single();
  if (error) throw new Error(`Could not complete that purchase: ${error.message}`);
  const result = data as { ok: boolean; reason: string; new_balance: number } | null;
  if (!result?.ok) {
    if (result?.reason === "already_owned") throw new Error("You already own that item.");
    if (result?.reason === "insufficient") throw new Error("Not enough Gold.");
    throw new Error("Could not complete that purchase.");
  }

  return { profile: await ensureProfile(token), owned: await listOwnedCosmetics(profile.id) };
}

/**
 * Equips an owned cosmetic. Ownership is re-checked server-side: the store UI
 * only offers what you have, but the endpoint cannot assume that.
 */
export async function equipCosmetic(
  token: string,
  profile: PlayerProfile,
  cosmeticId: string,
): Promise<EquippedCosmetics> {
  const item = cosmeticById(cosmeticId);
  if (!item) throw new Error("That item doesn't exist.");

  const owned = await listOwnedCosmetics(profile.id);
  if (!owned.includes(cosmeticId)) throw new Error("You don't own that item yet.");

  const equipmentKey = item.slot === "avatar" ? "avatar2d" : item.slot;
  const next = normalizeEquipped({ ...profile.equipped, [equipmentKey]: cosmeticId });
  const now = new Date().toISOString();

  const supabase = adminClient();
  if (!supabase) {
    setEquippedInMemory(token, next, now);
    return next;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ equipped: next, updated_at: now })
    .eq("session_token", token);
  if (error) throw new Error(`Could not equip that item: ${error.message}`);
  return next;
}

/** Grants a cosmetic without payment -- the path Signature awards will use. */
export async function awardCosmetic(profileId: string, cosmeticId: string): Promise<void> {
  const item = cosmeticById(cosmeticId);
  if (!item) throw new Error("That item doesn't exist.");

  const supabase = adminClient();
  if (!supabase) {
    const owned = memoryOwned.get(profileId) ?? new Set<string>();
    owned.add(cosmeticId);
    memoryOwned.set(profileId, owned);
    return;
  }
  const { error } = await supabase
    .from("player_cosmetics")
    .upsert(
      { profile_id: profileId, cosmetic_id: cosmeticId, source: "award" },
      { onConflict: "profile_id,cosmetic_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Could not award that item: ${error.message}`);
}
