import "server-only";
import {
  FORGE_ENCHANTMENTS,
  computeForgedToolStats,
  forgeEnchantmentItemId,
  isForgeEnchantmentId,
  type ForgeBaseStats,
  type StackAcresForgedStats,
} from "@/lib/stackacres/forge";
import {
  forgeStackAcresEnchantment,
  listOwnedStackAcresEnchantments,
  type ForgeEnchantmentOutcome,
} from "./stackacres-forge-store";

/**
 * The service-layer wiring lib/stackacres/forge.ts's own header names as
 * future work -- written now for the same reason stackacres-synergy-
 * service.ts sits between the route and stackacres-synergy-store.ts: this
 * is the one place that resolves a bare catalogue id (what the client sends
 * and FORGE_ENCHANTMENTS is keyed by) to the versioned item_id the store and
 * migration actually persist, so neither side has to know the other's
 * naming convention.
 *
 * MONEY-ORDERING: this file moves Gold and a processing-track material
 * exactly once (`forgeEnchantment`), and that spend is delegated whole to
 * `forge_stackacres_enchantment`, which checks both resources under row
 * locks before mutating either -- see the migration's own comment. Nothing
 * here is a second, parallel way to spend either resource.
 */

export type ForgeEnchantmentResult =
  | { success: true; enchantmentId: string; goldBalance: number; materialBalance: number }
  | {
      success: false;
      reason:
        | "unknown_enchantment"
        | Exclude<ForgeEnchantmentOutcome, { success: true }>["reason"];
      goldBalance?: number;
      materialBalance?: number;
    };

/**
 * Forges one catalogue enchantment permanently, at its catalogued Gold cost
 * and material price. `enchantmentId` is the bare catalogue key (e.g.
 * `"sunwoven_edge"`), never the versioned wrapper -- that conversion happens
 * here, once, via `forgeEnchantmentItemId`, so a client never needs to know
 * the version suffix exists.
 */
export async function forgeEnchantment(
  profileId: string,
  enchantmentId: string,
): Promise<ForgeEnchantmentResult> {
  if (!isForgeEnchantmentId(enchantmentId)) {
    return { success: false, reason: "unknown_enchantment" };
  }
  const def = FORGE_ENCHANTMENTS[enchantmentId];
  const outcome = await forgeStackAcresEnchantment(
    profileId,
    forgeEnchantmentItemId(def.id),
    def.goldCost,
    def.materialItem,
    def.materialQuantity,
  );
  if (outcome.success) {
    return {
      success: true,
      enchantmentId: def.id,
      goldBalance: outcome.goldBalance,
      materialBalance: outcome.materialBalance,
    };
  }
  return {
    success: false,
    reason: outcome.reason,
    goldBalance: outcome.goldBalance,
    materialBalance: outcome.materialBalance,
  };
}

/** Every enchantment catalogue id (bare, not versioned) this profile has
 *  permanently forged. Stale/renamed item_ids in the ownership table are
 *  silently dropped, same posture `listUnlockedSynergyArchetypes` takes for
 *  a stale perk item_id. */
export async function listOwnedForgeEnchantmentIds(profileId: string): Promise<string[]> {
  const owned = await listOwnedStackAcresEnchantments(profileId);
  const ids: string[] = [];
  for (const itemId of owned) {
    for (const id of Object.keys(FORGE_ENCHANTMENTS)) {
      // Versioned forward, not parsed backward (unlike
      // parseSynergyPerkItemId): the forge catalogue is small enough that
      // checking every known id's current wrapper against the stored value
      // is simpler than writing a second parser, and it naturally treats a
      // stale v1 row as unowned once a v2 rebalance ships -- exactly the
      // "a rebalance is a new purchase" contract forgeEnchantmentItemId's
      // own doc comment describes.
      if (forgeEnchantmentItemId(id) === itemId) {
        ids.push(id);
        break;
      }
    }
  }
  return ids;
}

/**
 * THE FORGED-STATS READER, three call sites, all in
 * lib/server/stackacres-service.ts's `harvestStackAcres`: computes this
 * profile's forged crit chance/bonus/reach from whichever enchantments it
 * owns, layered onto the tool tier's own base numbers -- see forge.ts's own
 * header for why `computeForgedToolStats` first, `applySynergyEffects`
 * second is the required order.
 */
export async function forgedToolStatsFor(
  profileId: string,
  baseTool: ForgeBaseStats,
): Promise<StackAcresForgedStats> {
  const owned = await listOwnedForgeEnchantmentIds(profileId);
  return computeForgedToolStats(baseTool, owned);
}
