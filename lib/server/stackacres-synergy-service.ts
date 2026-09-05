import "server-only";
import {
  SYNERGY_MAX_ACTIVE_SLOTS,
  SYNERGY_PERKS,
  applySynergyEffects,
  parseSynergyPerkItemId,
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
    // Strips both wrappers rather than assuming v1, so a future rebalance's
    // v2 unlock is still recognized as the same archetype for display
    // purposes (its buff math still comes from the current SYNERGY_PERKS
    // entry either way).
    const archetype = parseSynergyPerkItemId(itemId);
    if (archetype) archetypes.push(archetype);
  }
  return archetypes;
}

/** Ends the current session's loadout early (sign-out, leaving the table). */
export async function clearSynergyLoadout(profileId: string): Promise<void> {
  await clearStackAcresSessionPerks(profileId);
}

/** Which archetypes are currently slotted (owned AND activated) for this
 *  profile's session -- what the HUD calls "active", as opposed to
 *  `listUnlockedSynergyArchetypes`'s "ever bought". A thin pass-through
 *  rather than a second implementation, kept here so
 *  lib/server/stackacres-service.ts has one synergy import surface instead
 *  of reaching past this file into the store directly. */
export async function listActiveSynergyArchetypes(profileId: string): Promise<SynergyArchetype[]> {
  return getActiveStackAcresSynergies(profileId);
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
 * WIRED UP, three call sites, all in lib/server/stackacres-service.ts:
 *   - `harvestStackAcres` folds `harvestCritChance` into `effectiveCritChance`'s
 *     result before `rollHarvestCrit` rolls it -- additive with both the
 *     tool's own odds and an armed Lucky Poker Dice boost.
 *   - `workStackAcres` reads `millDoubleOutputChance` once per pass and feeds
 *     it to `rollMillDoubleOutput` (lib/stackacres/machines.ts) right after
 *     each finished Mill batch's guarded collect lands.
 *   - `view()` derives `farmhandSpeedMultiplier` from `farmhandSpeed` (base
 *     1) for the client to apply to its own presentation-only
 *     `FARMHAND_SPEED` constant -- the farmhand himself never calls this
 *     directly, since he is client-side and this file is server-only.
 */
export async function applySynergyBuffs(
  baseStats: StackAcresBaseStats,
  profileId: string,
): Promise<StackAcresBuffedStats> {
  const activeArchetypes = await getActiveStackAcresSynergies(profileId);
  return applySynergyEffects(baseStats, activeArchetypes);
}
