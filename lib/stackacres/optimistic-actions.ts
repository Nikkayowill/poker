/**
 * The client half of "assume the server said yes".
 *
 * StackAcres' action route answers every SUCCESSFUL request with the whole
 * farm view, so a wrong optimistic guess costs nothing on success -- the
 * real answer overwrites it through the same setters. What that safety net
 * does NOT cover is a refusal (which carries only the unit list) or a dropped
 * request (which carries nothing), so the component captures a snapshot
 * before applying a guess and restores it when the guess turns out wrong.
 *
 * This module is the pure part of that: given one `Action` and a read-only
 * view of the farm, `predictStackAcresAction` returns the patch to apply
 * before the fetch (or `null` when the outcome cannot be honestly guessed),
 * and `resolveOptimisticOutcome` decides what to do with the response.
 *
 * WHAT IS NOT PREDICTED, and why:
 *   - `collect` payout, `tap-secret-zone`, `request-contract`, `work`: the
 *     server rolls dice the client cannot reproduce (muck, crit, discovery,
 *     the drawn contract, a mill's double-output). `collect` still gets an
 *     optimistic unit removal (that part is deterministic); the Gold it pays
 *     waits for the real number rather than flashing one that then corrects
 *     downward.
 *   - anything the client keeps no state for (blueprints, prestige,
 *     irrigation): there is nothing on screen to move.
 *
 * The patch is shaped as a subset of the component's own response type, so
 * the component applies it through the identical `applyResponse` path a real
 * response takes -- see stackacres-farm.tsx.
 */

import type { PlayerProfile } from "@/lib/profile/types";
import { STACKACRES_CATALOGUE, STACKACRES_FEED, stackacresCapacityPrice, type StackAcresStock } from "./catalogue";
import { stackacresStockPrice } from "./market";
import type { StackAcresContractRow } from "./contracts";
import { sectorClearCheck, type SectorId } from "./sectors";
import { decrementHeldSecret, nextUpkeepPaidAfterDiceTrade, type SecretItemId } from "./secrets";
import {
  SYNERGY_MAX_ACTIVE_SLOTS,
  SYNERGY_PERKS,
  applySynergyEffects,
  nextActiveLoadout,
  type SynergyArchetype,
} from "./synergy-perks";
import { nextToolTier, toolUpgradePrice, type StackAcresToolTier } from "./equipment";
import type { StackAcresUpkeepState } from "./upkeep";
import {
  optimisticallyFedUnit,
  optimisticallyRestartedUnit,
  optimisticallyStockedUnit,
  optimisticallyWateredUnit,
  withoutStackAcresUnit,
  type StackAcresUnitSnapshot,
} from "./units";
import { priceForNextPurchase, type MidnightMerchantSnapshot } from "./midnight-merchant";
import type { Action } from "./farm-actions";

/** A read-only view of the farm the pure predictors compute against. Mirrors
 *  the component's live state; `goldBalance`/`unlimitedGold` come straight
 *  off `profile` and are split out so a predictor never has to reach through
 *  a possibly-null profile for the common case. */
export interface FarmPredictContext {
  profile: PlayerProfile | null;
  goldBalance: number;
  unlimitedGold: boolean;
  units: StackAcresUnitSnapshot[];
  feed: number;
  capacity: Partial<Record<StackAcresStock, number>>;
  toolTier: StackAcresToolTier;
  sectors: SectorId[];
  upkeep: StackAcresUpkeepState;
  influence: number;
  contract: StackAcresContractRow | null;
  synergyUnlocked: SynergyArchetype[];
  synergyActive: SynergyArchetype[];
  farmhandSpeedMultiplier: number;
  secrets: { held: Partial<Record<SecretItemId, number>>; boostArmed: boolean };
  secretDonations: Record<SecretItemId, boolean>;
  merchantVisit: MidnightMerchantSnapshot | null;
  greenhouseBuilt: boolean;
  nowMs: number;
}

/**
 * The fields a predictor may set, as a structural subset of the component's
 * response type. Every field here is also a field `applyResponse` reads, so
 * the component can hand a patch straight to it.
 */
export interface FarmStatePatch {
  units?: StackAcresUnitSnapshot[];
  profile?: PlayerProfile | null;
  feed?: number;
  capacity?: Partial<Record<StackAcresStock, number>>;
  sectors?: SectorId[];
  upkeep?: StackAcresUpkeepState;
  tool?: StackAcresToolTier;
  influence?: number;
  greenhouseBuilt?: boolean;
  contract?: StackAcresContractRow | null;
  secrets?: { held: Partial<Record<SecretItemId, number>>; boostArmed: boolean };
  secretDonations?: Record<SecretItemId, boolean>;
  synergy?: {
    unlocked: SynergyArchetype[];
    active: SynergyArchetype[];
    farmhandSpeedMultiplier: number;
  };
}

/** A Gold debit, or `null` when the balance won't cover it -- the same
 *  answer `spendGoldByProfile` would give, checked here only so an obviously
 *  doomed tap never optimistically shows money it cannot actually spend.
 *  `unlimitedGold` always affords everything, matching the server. */
function debited(ctx: FarmPredictContext, amount: number): PlayerProfile | null {
  if (!ctx.profile) return null;
  if (!ctx.unlimitedGold && ctx.goldBalance < amount) return null;
  return {
    ...ctx.profile,
    goldBalance: ctx.unlimitedGold ? ctx.profile.goldBalance : ctx.profile.goldBalance - amount,
  };
}

let optimisticUnitSeq = 0;
/** A throwaway id for a unit this browser is about to create. Replaced by
 *  the server's own id the moment the real response lands. */
function newOptimisticUnitId(): string {
  optimisticUnitSeq += 1;
  return `sa-optimistic-${optimisticUnitSeq}`;
}

/**
 * The patch to apply the instant `body` is sent, or `null` to send it with
 * no optimistic change (the response is the only thing that will move the
 * farm). A guess, never authority: the server checks everything again under
 * a lock, and its answer -- success or refusal -- always wins.
 */
export function predictStackAcresAction(
  body: Action,
  ctx: FarmPredictContext,
): FarmStatePatch | null {
  switch (body.action) {
    case "feed": {
      const unit = ctx.units.find((u) => u.id === body.unitId);
      if (!unit || ctx.feed < 1) return null;
      return {
        units: ctx.units.map((u) => (u.id === unit.id ? optimisticallyFedUnit(u, ctx.nowMs) : u)),
        feed: ctx.feed - 1,
      };
    }
    case "water": {
      const unit = ctx.units.find((u) => u.id === body.unitId);
      if (!unit) return null;
      return {
        units: ctx.units.map((u) => (u.id === unit.id ? optimisticallyWateredUnit(u, ctx.nowMs) : u)),
      };
    }
    case "clear": {
      const unit = ctx.units.find((u) => u.id === body.unitId);
      if (!unit || unit.muckFee === null) return null;
      const profile = debited(ctx, unit.muckFee);
      if (!profile) return null;
      return { units: withoutStackAcresUnit(ctx.units, unit.id), profile };
    }
    case "retire": {
      const unit = ctx.units.find((u) => u.id === body.unitId);
      if (!unit || !unit.permanent) return null;
      return { units: withoutStackAcresUnit(ctx.units, unit.id) };
    }
    case "collect": {
      const targets = ctx.units.filter(
        (u) => u.state === "ready" && (!body.unitIds || body.unitIds.includes(u.id)),
      );
      if (targets.length === 0) return null;
      const targetIds = new Set(targets.map((u) => u.id));
      const kept = ctx.units.filter((u) => !targetIds.has(u.id));
      // A permanent unit's row survives its own harvest and restarts; a
      // one-cycle sowing is simply gone. Neither branch touches Gold here --
      // the payout (and any muck) is a dice roll this layer never guesses,
      // see this module's own header.
      const resown = targets
        .filter((u) => u.permanent)
        .map((u) => optimisticallyRestartedUnit(u, ctx.nowMs));
      return { units: [...kept, ...resown] };
    }
    case "stock": {
      const profile = debited(ctx, STACKACRES_CATALOGUE[body.stock].seedCost);
      if (!profile) return null;
      const unit = optimisticallyStockedUnit({
        id: newOptimisticUnitId(),
        stock: body.stock,
        permanent: false,
        inGreenhouse: body.inGreenhouse === true,
        nowMs: ctx.nowMs,
      });
      return { units: [...ctx.units, unit], profile };
    }
    case "buy-stock": {
      const profile = debited(ctx, stackacresStockPrice(body.stock));
      if (!profile) return null;
      const unit = optimisticallyStockedUnit({
        id: newOptimisticUnitId(),
        stock: body.stock,
        permanent: true,
        inGreenhouse: false,
        nowMs: ctx.nowMs,
      });
      return { units: [...ctx.units, unit], profile };
    }
    case "expand-capacity": {
      const profile = debited(ctx, stackacresCapacityPrice(body.stock));
      if (!profile) return null;
      return { capacity: { ...ctx.capacity, [body.stock]: (ctx.capacity[body.stock] ?? 0) + 1 }, profile };
    }
    case "buy-feed": {
      const item = STACKACRES_FEED[body.itemId];
      if (!item) return null;
      const profile = debited(ctx, item.cost);
      if (!profile) return null;
      return { feed: ctx.feed + item.servings, profile };
    }
    case "upgrade-tool": {
      const next = nextToolTier(ctx.toolTier);
      const price = toolUpgradePrice(ctx.toolTier);
      if (!next || price === null) return null;
      const profile = debited(ctx, price);
      if (!profile) return null;
      return { tool: next, profile };
    }
    case "clear-sector": {
      const check = sectorClearCheck(body.sector, {
        unlocked: ctx.sectors,
        unitCount: ctx.units.length,
      });
      if (check.alreadyOpen || !check.ok) return null;
      const profile = debited(ctx, check.cost);
      if (!profile) return null;
      return { sectors: [...ctx.sectors, body.sector], profile };
    }
    case "unlock-synergy-perk": {
      if (ctx.synergyUnlocked.includes(body.archetype)) return null;
      const profile = debited(ctx, SYNERGY_PERKS[body.archetype].unlockCostGold);
      if (!profile) return null;
      return {
        synergy: {
          unlocked: [...ctx.synergyUnlocked, body.archetype],
          active: ctx.synergyActive,
          farmhandSpeedMultiplier: ctx.farmhandSpeedMultiplier,
        },
        profile,
      };
    }
    case "activate-synergy-perk": {
      if (ctx.synergyActive.includes(body.archetype)) return null;
      if (body.slot !== ctx.synergyActive.length || ctx.synergyActive.length >= SYNERGY_MAX_ACTIVE_SLOTS) {
        return null;
      }
      const active = nextActiveLoadout(ctx.synergyActive, body.archetype, body.slot);
      const farmhandSpeedMultiplier = applySynergyEffects(
        { harvestCritChance: 0, farmhandSpeed: 1, millDoubleOutputChance: 0 },
        active,
      ).farmhandSpeed;
      return { synergy: { unlocked: ctx.synergyUnlocked, active, farmhandSpeedMultiplier } };
    }
    case "donate-secret-item": {
      if ((ctx.secrets.held[body.itemId] ?? 0) < 1) return null;
      return {
        secrets: { held: decrementHeldSecret(ctx.secrets.held, body.itemId), boostArmed: ctx.secrets.boostArmed },
        secretDonations: { ...ctx.secretDonations, [body.itemId]: true },
      };
    }
    case "consume-secret-item": {
      if (ctx.secrets.boostArmed || (ctx.secrets.held[body.itemId] ?? 0) < 1) return null;
      return {
        secrets: { held: decrementHeldSecret(ctx.secrets.held, body.itemId), boostArmed: true },
      };
    }
    case "trade-secret-item": {
      if ((ctx.secrets.held[body.itemId] ?? 0) < 1) return null;
      const target = nextUpkeepPaidAfterDiceTrade(ctx.upkeep.paidToday, ctx.upkeep.fee);
      if (target <= ctx.upkeep.paidToday) return null;
      return {
        secrets: { held: decrementHeldSecret(ctx.secrets.held, body.itemId), boostArmed: ctx.secrets.boostArmed },
        upkeep: { ...ctx.upkeep, paidToday: target, due: ctx.upkeep.fee - target },
      };
    }
    case "midnight-merchant-buy": {
      const visit = ctx.merchantVisit;
      const line = visit?.stock.find((s) => s.itemId === body.itemId);
      if (!visit || !line || line.remaining < 1) return null;
      const price = priceForNextPurchase(line.basePrice, visit.purchaseStreak);
      const profile = debited(ctx, price);
      if (!profile) return null;
      // The visit itself (streak, remaining stock) is deliberately not
      // predicted -- it is small, infrequent, and the real answer is one
      // round trip away; only the Gold it costs moves instantly.
      return { profile };
    }
    case "build-greenhouse": {
      // No material check here (this layer keeps no inventory state) --
      // an insufficient shelf refuses server-side and the snapshot restores.
      if (ctx.greenhouseBuilt) return null;
      return { greenhouseBuilt: true };
    }
    case "fulfill-contract": {
      if (!ctx.contract || ctx.contract.status !== "open") return null;
      if (!ctx.profile) return null;
      const profile = ctx.profile.unlimitedGold
        ? ctx.profile
        : { ...ctx.profile, goldBalance: ctx.profile.goldBalance + ctx.contract.goldReward };
      return {
        profile,
        influence: ctx.influence + ctx.contract.influenceReward,
        contract: null,
      };
    }
    // The rest are dice rolls this browser cannot honestly guess (`collect`'s
    // own Gold, `tap-secret-zone`, `request-contract`, `work`), or move
    // nothing the client keeps state for (`build-greenhouse`'s materials
    // aside from the flag itself, blueprints, prestige, pipes, soil tiles --
    // the scene mutates its own soil map directly off the response instead,
    // see stackacres-farm.tsx). See this module's own header.
    default:
      return null;
  }
}

/** What the response says to do with an optimistic patch that was applied. */
export type OptimisticOutcome = "reconcile" | "restore-refusal" | "restore-and-refetch";

/**
 * `reconcile`      -- the request succeeded; apply the full view, which
 *                     overwrites any wrong guess.
 * `restore-refusal`-- a clean refusal (a JSON body with a status): nothing
 *                     was written, so put the snapshot back, then overlay
 *                     whatever authoritative `round` the refusal carried.
 * `restore-and-refetch` -- the outcome is unknown (a dropped connection, a
 *                     5xx HTML page, an unparseable body): the write MAY have
 *                     committed, so put the snapshot back to stop showing a
 *                     guess and re-read the farm from the server.
 */
export function resolveOptimisticOutcome(input: {
  ok: boolean;
  hasJsonBody: boolean;
}): OptimisticOutcome {
  if (input.ok) return "reconcile";
  return input.hasJsonBody ? "restore-refusal" : "restore-and-refetch";
}
