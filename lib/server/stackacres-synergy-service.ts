import "server-only";
import {
  SYNERGY_MAX_ACTIVE_SLOTS,
  SYNERGY_PERKS,
  applySynergyEffects,
  isSynergyArchetype,
  synergyPerkItemId,
  type StackAcresBaseStats,
  type StackAcresBuffedStats,
  type SynergyArchetype,
} from "@/lib/stackacres/synergy-perks";
import {
  activateStackAcresSessionPerk,
  clearStackAcresSessionPerks,
  getActiveStackAcresSynergies,
  listOwnedStackAcresPerks,
  unlockStackAcresPerk,
  type ActivatePerkOutcome,
  type UnlockPerkOutcome,
} from "./stackacres-synergy-store";

/**
 * MONEY-ORDERING: this file moves Gold exactly once (`unlockSynergyPerk`),
 * and that debit is delegated whole to `unlock_stackacres_perk`/
 * `unlockStackAcresPerk`, which itself is a thin wrapper around
 * `spend_gold_by_profile` -- the same row-locking RPC every other Gold spend
 * in this app goes through. Nothing here is a second, parallel way to move
 * Gold; if a future perk needs a different price on activation (not just on
 * unlock), that has to grow this same call, not a new one.
 *
 * Buff aggregation itself never touches Gold and is safe to call as often as
 * a gameplay loop needs -- it is a read of two small tables plus arithmetic.
 */

export interface UnlockSynergyPerkResult {
  archetype: SynergyArchetype;
  outcome: UnlockPerkOutcome;
}

/** Buys a perk archetype permanently, at its catalogued Gold cost. */
export async function unlockSynergyPerk(
  profileId: string,
  archetype: SynergyArchetype,
): Promise<UnlockSynergyPerkResult> {
  const def = SYNERGY_PERKS[archetype];
  const outcome = await unlockStackAcresPerk(profileId, synergyPerkItemId(archetype), def.unlockCostGold);
  return { archetype, outcome };
}

/**
 * Slots an already-unlocked perk into the current session's loadout. `slot`
 * must be within [0, SYNERGY_MAX_ACTIVE_SLOTS) -- checked here as a clean
 * 400 rather than relying solely on the DB's own CHECK, which would surface
 * as a raw constraint-violation error to whatever route calls this.
 */
export async function activateSynergyPerk(
  profileId: string,
  archetype: SynergyArchetype,
  slot: number,
): Promise<ActivatePerkOutcome | { success: false; reason: "invalid_slot" }> {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SYNERGY_MAX_ACTIVE_SLOTS) {
    return { success: false, reason: "invalid_slot" };
  }
  return activateStackAcresSessionPerk(profileId, synergyPerkItemId(archetype), slot);
}

/** Every archetype this profile has permanently unlocked, regardless of
 *  whether it's currently slotted for the session. */
export async function listUnlockedSynergyArchetypes(profileId: string): Promise<SynergyArchetype[]> {
  const owned = await listOwnedStackAcresPerks(profileId);
  const archetypes: SynergyArchetype[] = [];
  for (const itemId of owned) {
    // item_id is "perk_<archetype>_v<n>" -- strip both wrappers rather than
    // assuming v1, so a future rebalance's v2 unlock is still recognized as
    // the same archetype for display purposes (its buff math still comes
    // from the current SYNERGY_PERKS entry either way).
    const match = /^perk_(.+)_v\d+$/.exec(itemId);
    if (match && isSynergyArchetype(match[1])) archetypes.push(match[1]);
  }
  return archetypes;
}

/** Ends the current session's loadout early (sign-out, leaving the table). */
export async function clearSynergyLoadout(profileId: string): Promise<void> {
  await clearStackAcresSessionPerks(profileId);
}

/**
 * THE ATOMIC BUFF INJECTOR.
 *
 * Aggregates whichever perks are currently active for this profile's session
 * (owned AND slotted -- an unlocked-but-unslotted perk contributes nothing,
 * by design: the Synergy Tree is a loadout choice per session, not a passive
 * stat pile) and applies them to `baseStats`, the caller's own pre-perk
 * numbers for this request.
 *
 * `baseStats` is supplied by the caller rather than read from here on
 * purpose -- this function has no opinion about where `harvestCritChance`
 * (equipment.ts), `farmhandSpeed` (farmhand.ts's FARMHAND_SPEED) or
 * `millDoubleOutputChance` come from, only about what a synergy does to
 * them once handed a value. That keeps this the one seam three otherwise
 * unrelated gameplay loops share, without importing any of their modules.
 *
 * Call sites (not wired up by this pass -- see this feature's own notes on
 * why editing those files was left alone):
 *   - lib/stackacres/equipment.ts's `rollHarvestCrit` would roll against
 *     `buffed.harvestCritChance` instead of the tool tier's own bare
 *     `critChance`.
 *   - lib/stackacres/farmhand.ts's tick loop would use
 *     `buffed.farmhandSpeed` in place of the bare `FARMHAND_SPEED` constant
 *     when it computes `stride`.
 *   - A future `collectStackAcresMachine` roll would compare a random draw
 *     against `buffed.millDoubleOutputChance` before crediting
 *     `output.quantity` vs. double it.
 */
export async function applySynergyBuffs(
  baseStats: StackAcresBaseStats,
  profileId: string,
): Promise<StackAcresBuffedStats> {
  const activeArchetypes = await getActiveStackAcresSynergies(profileId);
  return applySynergyEffects(baseStats, activeArchetypes);
}
