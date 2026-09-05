/**
 * The Synergy Tree: three skill archetypes a player unlocks permanently and
 * then slots into a per-session loadout.
 *
 * Pure and tested, same posture as ./bounty.ts and ./machines.ts -- this
 * file has no opinions about Gold, Postgres, or the request that carries a
 * loadout in. `lib/server/stackacres-synergy-service.ts` owns all of that;
 * everything here is a function of the archetype table and a list of ids.
 *
 * WHY A DISCRIMINATED UNION FOR THE EFFECT, not three optional numeric
 * fields on one shape: a "0.05 crit bonus" perk and a "0.15 speed
 * multiplier" perk are not the same field with a different label, and a
 * struct with `critBonus?`, `speedMultiplier?`, `doubleChance?` all optional
 * would let a perk def leave two of the three set, which means nothing.
 * `applySynergyEffects`'s switch is exhaustive over `SynergyEffect["kind"]`,
 * so a fourth archetype that forgets to extend the switch is a compile
 * error, not a silently-ignored perk.
 */

export const SYNERGY_ARCHETYPES = [
  "sunlight_harvester",
  "automated_logistics",
  "high_yield_processing",
] as const;

export type SynergyArchetype = (typeof SYNERGY_ARCHETYPES)[number];

export function isSynergyArchetype(value: string): value is SynergyArchetype {
  return (SYNERGY_ARCHETYPES as readonly string[]).includes(value);
}

export type SynergyEffect =
  | {
      /** A flat addition to a harvest's crit chance -- see
       *  equipment.ts's `STACKACRES_TOOL_TIER_DEFS[tier].critChance`, which
       *  is what `rollHarvestCrit` rolls against. Additive with the tool's
       *  own odds, never multiplicative: a tool that already crits 25% of
       *  the time and a flat +5% perk crit 30% of the time, not 26.25%. */
      kind: "harvest_crit_chance";
      flatBonus: number;
    }
  | {
      /** A multiplier on `FARMHAND_SPEED` (farmhand.ts) -- the tiles/second
       *  the farmhand walks at. Multiplicative, not additive: a speed stat
       *  compounds with anything else that ever scales it (a future
       *  equipment tier, say) the way a percentage buff normally would. */
      kind: "farmhand_velocity";
      multiplierBonus: number;
    }
  | {
      /** Odds a finished Mill batch (machines.ts's `MACHINE_CATALOGUE`)
       *  pays double its `output.quantity` instead of the listed amount.
       *  There is no roll for this in machines.ts today -- collecting a
       *  batch is deterministic -- so this is the seam a future
       *  `collectStackAcresMachine` would roll against, the same way
       *  `rollHarvestCrit` already rolls harvest crit. Additive across
       *  perks of this kind, same reasoning as harvest_crit_chance. */
      kind: "mill_double_output_chance";
      chance: number;
    };

export interface SynergyPerkDef {
  id: SynergyArchetype;
  label: string;
  description: string;
  /**
   * Gold cost to unlock permanently. Gold, not Bushels -- StackAcres has had
   * exactly one currency since the 2026-09-04 single-currency change (see
   * items.ts's own header); a Bushels price here would reference a balance
   * that no longer exists anywhere in the schema.
   */
  unlockCostGold: number;
  effect: SynergyEffect;
}

export const SYNERGY_PERKS: Readonly<Record<SynergyArchetype, SynergyPerkDef>> = {
  sunlight_harvester: {
    id: "sunlight_harvester",
    label: "Sunlight Harvester",
    description: "+5% chance any harvest crits, on top of your tool's own odds.",
    unlockCostGold: 50_000,
    effect: { kind: "harvest_crit_chance", flatBonus: 0.05 },
  },
  automated_logistics: {
    id: "automated_logistics",
    label: "Automated Logistics",
    description: "The farmhand moves 15% faster between tasks.",
    unlockCostGold: 50_000,
    effect: { kind: "farmhand_velocity", multiplierBonus: 0.15 },
  },
  high_yield_processing: {
    id: "high_yield_processing",
    label: "High-Yield Processing",
    description: "10% chance a finished Mill batch pays double.",
    unlockCostGold: 50_000,
    effect: { kind: "mill_double_output_chance", chance: 0.1 },
  },
} as const;

/**
 * The item_id a permanent unlock is stored under in
 * `stackacres_perk_unlocks` -- versioned the same way `ANTE_UP_MEMORY_MAX_TURNS`-
 * style values are elsewhere, so a future rebalance of an archetype's effect
 * ships as perk_..._v2, a new unlock, rather than silently reinterpreting
 * what a v1 owner already paid for.
 */
export function synergyPerkItemId(archetype: SynergyArchetype, version = 1): string {
  return `perk_${archetype}_v${version}`;
}

/**
 * The inverse of `synergyPerkItemId`: recovers the archetype an owned or
 * slotted item_id names, stripping whichever version wrapper it carries --
 * null for anything that isn't one of this feature's ids at all (a stale row
 * from a deleted archetype, or garbage). NOT the same check as
 * `isSynergyArchetype`, which tests a BARE archetype name: `perk_id` columns
 * in both `stackacres_perk_unlocks.item_id` and
 * `stackacres_session_perks.perk_id` store the versioned wrapper, never the
 * bare name (see the migration), so a caller reading either column has to
 * unwrap through this first -- passing a raw row value straight to
 * `isSynergyArchetype` always misses.
 */
export function parseSynergyPerkItemId(itemId: string): SynergyArchetype | null {
  const match = /^perk_(.+)_v\d+$/.exec(itemId);
  if (!match || !isSynergyArchetype(match[1])) return null;
  return match[1];
}

/** How many perks a loadout can hold at once. Mirrors the DB CHECK on
 *  `stackacres_session_perks.slot` (0..2) in the migration by hand -- a
 *  trigger/CHECK cannot import a TypeScript module. */
export const SYNERGY_MAX_ACTIVE_SLOTS = 3;

/** How long a loadout survives with no traffic before the next read wipes
 *  it. Mirrors `get_active_stackacres_synergies`'s `p_idle_ms` default. */
export const SYNERGY_SESSION_IDLE_MS = 30 * 60 * 1000;

/** The subset of gameplay numbers a Synergy Tree perk can move. Each field
 *  is the value BEFORE any perk is applied -- e.g. `harvestCritChance`
 *  comes straight from `STACKACRES_TOOL_TIER_DEFS[tier].critChance`. */
export interface StackAcresBaseStats {
  harvestCritChance: number;
  farmhandSpeed: number;
  millDoubleOutputChance: number;
}

export interface StackAcresBuffedStats extends StackAcresBaseStats {
  /** Which archetypes actually contributed. Excludes any id in the input
   *  that isn't a known archetype -- a stale/renamed perk_id in a loadout
   *  row is ignored here rather than thrown, since the row is inert data,
   *  not a request this function can refuse. */
  appliedPerkIds: readonly SynergyArchetype[];
}

/**
 * The pure buff math: base stats in, modified stats out. No I/O, no
 * profile id -- `lib/server/stackacres-synergy-service.ts`'s
 * `applySynergyBuffs` is the thing that resolves a profile id to a set of
 * active ids and calls this.
 *
 * Chances are clamped to [0, 1] and floating-point-summed bonuses are not
 * otherwise rounded -- the same posture `bountifulHarvest`'s `round4` takes
 * for its own multiplier, kept separate here because these three effects
 * only ever add flat fractions (0.05, 0.1) that don't accumulate the same
 * binary-floating-point noise repeated multiplication does.
 */
export function applySynergyEffects(
  base: StackAcresBaseStats,
  activePerkIds: readonly string[],
): StackAcresBuffedStats {
  let harvestCritChance = base.harvestCritChance;
  let farmhandSpeed = base.farmhandSpeed;
  let millDoubleOutputChance = base.millDoubleOutputChance;
  const applied: SynergyArchetype[] = [];

  // De-duplicated defensively: a caller (or a loadout row written before a
  // future ownership check tightened) handing the same id twice must not
  // double-apply it.
  for (const id of new Set(activePerkIds)) {
    if (!isSynergyArchetype(id)) continue;
    applied.push(id);
    const { effect } = SYNERGY_PERKS[id];
    switch (effect.kind) {
      case "harvest_crit_chance":
        harvestCritChance += effect.flatBonus;
        break;
      case "farmhand_velocity":
        farmhandSpeed *= 1 + effect.multiplierBonus;
        break;
      case "mill_double_output_chance":
        millDoubleOutputChance += effect.chance;
        break;
    }
  }

  return {
    harvestCritChance: Math.min(1, harvestCritChance),
    farmhandSpeed,
    millDoubleOutputChance: Math.min(1, millDoubleOutputChance),
    appliedPerkIds: applied,
  };
}
