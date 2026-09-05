/**
 * The Sunlight Forge: permanent enchantments layered onto the equipment
 * ladder (./equipment.ts).
 *
 * Pure and tested, same posture as ./synergy-perks.ts -- this file has no
 * opinions about Gold, Postgres, or the request that carries a forge action
 * in. `lib/server/stackacres-forge-service.ts` (not written by this pass --
 * see the note at the bottom of this file) would own all of that; everything
 * here is a function of the enchantment catalogue and a list of owned ids.
 *
 * WHY THIS DEFINES ITS OWN BASE-STATS SHAPE RATHER THAN IMPORTING
 * `StackAcresToolTierDef` FROM ./equipment.ts. synergy-perks.ts already made
 * this call for the identical reason: this module's caller (a route or a
 * component) is the thing that knows which tool tier is held and reads
 * `STACKACRES_TOOL_TIER_DEFS[tier]`; this module only needs to know the
 * shape of a bag of three numbers, not where they came from. `ForgeBaseStats`
 * is structurally compatible with `StackAcresToolTierDef`, so a caller can
 * hand that object straight in with no adapter.
 *
 * THERE IS NO PER-TOOL-INSTANCE ROW, AND THAT IS DELIBERATE. The live
 * equipment ladder (`homestead_tool`) is one scalar `tier` column per
 * profile -- there is no tool entity to attach metadata to, only a rung the
 * account has bought up to. An enchantment is therefore profile-scoped and
 * applies to whichever tier is currently held, exactly like a Synergy perk
 * applies regardless of which tier is held. See the migration
 * (20260905130000_stackacres_tool_enchantments.sql) for the storage side of
 * this same decision, including why it is its own table rather than the
 * dead `homestead_inventory`.
 *
 * WHY BOTH EFFECT KINDS FOLD ONTO ./equipment.ts's EXISTING TWO NUMBERS
 * (`critChance`, `critBonus`) INSTEAD OF ADDING A THIRD, INDEPENDENT ROLL.
 * The brief that produced this file asks for "chance to double harvest
 * yields" and "chance a harvest crits" as if they were two different rolls.
 * They are not, here: `critBonus` already IS the yield multiplier a crit
 * pays (1 means "a crit doubles the harvest" -- see equipment.ts's own
 * comment on the field), so "a chance to double yields" and "a wider crit
 * window" are the same single roll wearing two names -- one widens WHETHER
 * it fires, the other widens WHAT it pays when it does. Introducing a
 * genuinely second, independent roll into the settlement path has already
 * bitten this codebase once (see equipment.ts's own "A NEW RANDOMNESS
 * SOURCE IN A SETTLEMENT PATH BREAKS EXISTING TESTS TWO WAYS" note, restated
 * in the 2026-09-04 CLAUDE.md entry): every test that pins `Math.random`
 * for one roll would silently start driving a second one too, and every
 * unpinned harvest-balance assertion would go flaky. Folding both effects
 * into the same two numbers means the actual roll -- `rollHarvestCrit`/
 * `critGoldFor` in equipment.ts -- never changes shape at all; it just gets
 * handed forged numbers instead of the tier's bare ones. That is also what
 * keeps this safe under the one-faucet/one-ceiling rule those functions'
 * own comments describe: the crit still rides the SAME reservation a
 * harvest already took, forged or not.
 */

import type { MachineItemId } from "./machine-items";
import { type StackAcresInventory, inventoryQuantity } from "./inventory";

/** The subset of a tool tier's numbers a forge enchantment can move. Each
 *  field is the value BEFORE any enchantment is applied -- e.g. `critChance`
 *  comes straight from `STACKACRES_TOOL_TIER_DEFS[tier].critChance`. */
export interface ForgeBaseStats {
  critChance: number;
  critBonus: number;
  /** World units either side of a scythe drag one stroke cuts
   *  (`STACKACRES_TOOL_TIER_DEFS[tier].reach`). Purely client-side scenery,
   *  same as equipment.ts's own `reach` -- see that file's header for why
   *  nothing is at stake in it. */
  reach: number;
}

export type ForgeEnchantmentKind = "crit_chance_window" | "crit_yield_bonus" | "forge_tempo";

export type ForgeEnchantmentEffect =
  | {
      /** A flat addition to `critChance`, additive with the held tier's own
       *  base chance and with the Synergy Tree's own `harvest_crit_chance`
       *  bonus (all three layers sum, then clamp to 1) -- the in-universe
       *  flavor is "widening the window the crit roll has to land in." */
      kind: "crit_chance_window";
      flatChanceBonus: number;
    }
  | {
      /** A flat addition to `critBonus` -- the payout multiplier a crit
       *  already pays. Raising this toward or past 1 is what "a chance to
       *  double harvest yields" actually means here: the chance is still
       *  `critChance`'s job, this is what the chance pays when it lands. */
      kind: "crit_yield_bonus";
      flatBonusIncrease: number;
    }
  | {
      /** A multiplier on `reach`, mirroring how a paid tool tier already
       *  states its own reach as a multiple of the starting one. Called
       *  "tempo" rather than "reach" in the catalogue because a forged
       *  enchantment is sold as making the tool feel faster to swing, not
       *  as a second reach stat competing with the tier's own -- the two
       *  compose multiplicatively (tier reach * (1 + tempo)), same
       *  reasoning ./synergy-perks.ts gives for `farmhand_velocity` being
       *  multiplicative rather than additive. */
      kind: "forge_tempo";
      multiplierBonus: number;
    };

export interface ForgeEnchantmentDef {
  id: string;
  label: string;
  description: string;
  /** Gold, paid once, permanent -- same sink direction as every StackAcres
   *  Gold price. Zero is valid (a material-only enchantment). */
  goldCost: number;
  /** The processing-track item (./machine-items.ts) this enchantment also
   *  consumes, once, permanently. Deliberately a real, already-storable
   *  item rather than a new resource invented for this feature --
   *  `homestead_processing_inventory`'s own CHECK constraint only allows
   *  ('wheat', 'flour') today, so a forge material must be one of those
   *  until that CHECK is widened by its own migration. */
  materialItem: MachineItemId;
  materialQuantity: number;
  effect: ForgeEnchantmentEffect;
}

export const FORGE_ENCHANTMENTS: Readonly<Record<string, ForgeEnchantmentDef>> = {
  sunwoven_edge: {
    id: "sunwoven_edge",
    label: "Sunwoven Edge",
    description: "+8% chance any harvest crits, on top of your tool's own odds.",
    goldCost: 40_000,
    materialItem: "flour",
    materialQuantity: 25,
    effect: { kind: "crit_chance_window", flatChanceBonus: 0.08 },
  },
  gilded_bounty: {
    id: "gilded_bounty",
    label: "Gilded Bounty",
    description: "A crit pays 50% more on top of what your tool already promises.",
    goldCost: 60_000,
    materialItem: "flour",
    materialQuantity: 40,
    effect: { kind: "crit_yield_bonus", flatBonusIncrease: 0.5 },
  },
  quickened_haft: {
    id: "quickened_haft",
    label: "Quickened Haft",
    description: "Swing 20% faster -- clears an overgrown swathe in fewer passes.",
    goldCost: 30_000,
    materialItem: "flour",
    materialQuantity: 15,
    effect: { kind: "forge_tempo", multiplierBonus: 0.2 },
  },
} as const;

/** The item_id an enchantment is stored under in
 *  `stackacres_tool_enchantments` -- versioned the same way
 *  `synergyPerkItemId` versions a perk, so a future rebalance ships as
 *  `enchant_..._v2`, a new purchase, rather than silently reinterpreting
 *  what a v1 owner already paid for. */
export function forgeEnchantmentItemId(id: string, version = 1): string {
  return `enchant_${id}_v${version}`;
}

export function isForgeEnchantmentId(value: string): value is keyof typeof FORGE_ENCHANTMENTS {
  return Object.prototype.hasOwnProperty.call(FORGE_ENCHANTMENTS, value);
}

export interface StackAcresForgedStats extends ForgeBaseStats {
  /** Which enchantments actually contributed. Excludes any id in the input
   *  that isn't a known enchantment -- a stale/renamed item_id in an
   *  ownership row is ignored here rather than thrown, same posture
   *  `applySynergyEffects` takes for a stale perk id. */
  appliedEnchantmentIds: readonly string[];
}

/**
 * The pure forge math: a tool tier's base stats in, forged stats out. No
 * I/O, no profile id -- a future `lib/server/stackacres-forge-service.ts`
 * would resolve a profile id to a list of owned item_ids (mirroring
 * `stackacres-synergy-service.ts`'s `listOwnedStackAcresPerks`) and call
 * this with that list.
 *
 * `critChance` is clamped to [0, 1] (a chance cannot exceed certainty).
 * `critBonus` is NOT clamped upward -- it is a multiplier a settled harvest
 * already reserves against before rolling (equipment.ts's own
 * `critGoldFor`/the harvest's optimistic reservation), so an arbitrarily
 * large bonus is still bounded by that reservation, never by this function.
 * `reach` composes multiplicatively, same as `applySynergyEffects` composes
 * `farmhandSpeed`.
 */
export function computeForgedToolStats(
  baseTool: ForgeBaseStats,
  appliedEnchantments: readonly string[],
): StackAcresForgedStats {
  let critChance = baseTool.critChance;
  let critBonus = baseTool.critBonus;
  let reach = baseTool.reach;
  const applied: string[] = [];

  // De-duplicated defensively: a caller (or an ownership row written before
  // a future ownership check tightened) handing the same id twice must not
  // double-apply it.
  for (const id of new Set(appliedEnchantments)) {
    if (!isForgeEnchantmentId(id)) continue;
    applied.push(id);
    const { effect } = FORGE_ENCHANTMENTS[id];
    switch (effect.kind) {
      case "crit_chance_window":
        critChance += effect.flatChanceBonus;
        break;
      case "crit_yield_bonus":
        critBonus += effect.flatBonusIncrease;
        break;
      case "forge_tempo":
        reach *= 1 + effect.multiplierBonus;
        break;
    }
  }

  return {
    critChance: Math.min(1, Math.max(0, critChance)),
    critBonus: Math.max(0, critBonus),
    reach,
    appliedEnchantmentIds: applied,
  };
}

export interface ForgeMaterialStatus {
  item: MachineItemId;
  required: number;
  held: number;
  met: boolean;
}

/**
 * What the material side of forging one enchantment looks like against a
 * player's actual, live inventory (./inventory.ts) -- the "material
 * validation counters" the Sunlight Forge Table renders per slot. Pure and
 * synchronous: the caller is responsible for having already fetched
 * `inventory` (the same snapshot-then-render split every other StackAcres
 * surface follows), this function does not reach for a store itself.
 */
export function forgeMaterialStatus(
  def: ForgeEnchantmentDef,
  inventory: StackAcresInventory,
): ForgeMaterialStatus {
  const held = inventoryQuantity(inventory, def.materialItem);
  return {
    item: def.materialItem,
    required: def.materialQuantity,
    held,
    met: held >= def.materialQuantity,
  };
}

/**
 * Whether forging `def` is currently possible for a player holding
 * `goldBalance` Gold and `inventory` materials -- both conditions, not just
 * one, since `forge_stackacres_enchantment` (the migration's RPC) refuses
 * the whole purchase if either is short. Purely advisory for the client:
 * the server re-checks both under a row lock regardless, the same
 * "client state is never trusted" rule every staked StackAcres action
 * already follows.
 */
export function canAffordForge(
  def: ForgeEnchantmentDef,
  goldBalance: number,
  inventory: StackAcresInventory,
): boolean {
  return goldBalance >= def.goldCost && forgeMaterialStatus(def, inventory).met;
}

/**
 * NOT WRITTEN BY THIS PASS, ON PURPOSE -- the same posture
 * stackacres-synergy-service.ts's own header states for its buff injector:
 * this file has no service layer or route wired up yet. A
 * `lib/server/stackacres-forge-service.ts` would:
 *   - call `forge_stackacres_enchantment` (this migration's RPC) for the
 *     purchase, the same thin-wrapper shape `unlockStackAcresPerk` already
 *     takes around `unlock_stackacres_perk`;
 *   - resolve a profile's owned enchantment ids from
 *     `stackacres_tool_enchantments` the same way
 *     `listOwnedStackAcresPerks` resolves `stackacres_perk_unlocks`;
 *   - and equipment.ts's `rollHarvestCrit`/`critGoldFor` call sites inside
 *     `harvestStackAcres` would be handed `computeForgedToolStats(...)`'s
 *     `critChance`/`critBonus` instead of the bare tier numbers, stacked
 *     with (not instead of) whatever `applySynergyBuffs` already contributes
 *     -- both are additive-with-clamp on the same two fields, so composing
 *     them is `computeForgedToolStats` first, `applySynergyEffects` second,
 *     feeding one's output into the other's `base` argument, in either
 *     order (addition commutes; the shared `Math.min(1, ...)` clamp is
 *     applied once at the end either way).
 * Building that wiring ahead of Kayo's own review of the catalogue above
 * (prices, the two effect numbers, which material gates which enchantment)
 * would be guessing at balance decisions that are his to make, the same
 * reason ./town.ts's UI wiring was left for its own pass.
 */
