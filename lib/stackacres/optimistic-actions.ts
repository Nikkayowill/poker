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
 *     downward. stackacres-farm.tsx's `act` does show a numberless "on its
 *     way" toast the instant this predictor applies, so the tap still gets
 *     an immediate answer -- it just never promises a figure it might have
 *     to walk back.
 *   - anything the client keeps no state for (blueprints, prestige): there
 *     is nothing on screen to move.
 *
 * `place-pipe`/`remove-pipe` ARE predicted. Irrigation earned the exception
 * once the pipe tool's own drag gesture (lib/stackacres/tools.ts's `pipe`)
 * started firing one request per tile crossed: waiting on a round trip
 * before the next tile could even be evaluated made a five-tile run feel
 * like five separate button presses with a pause between each. The guess
 * reruns `recalculatePipeConnections` against the tile just added or
 * removed, so the mask/hydration/distance it shows are the real answer, not
 * a placeholder -- both are pure functions of tile topology, not of the
 * crops standing nearby, and this layer is never asked to predict which
 * crop that changes.
 *
 * `place-soil-tile`/`remove-soil-tile` are predicted the same way now that a
 * bed is one tile (./soil.ts's `SOIL_TILE`, one art unit): the outcome is
 * deterministic (bare ground or already-occupied is all there is to check,
 * plus whichever crop `soilSlotOnTile` says stands on a removed bed), so a
 * soil-brush drag across N tiles gets the same one-request-per-tile
 * responsiveness the pipe brush already has, instead of waiting on a round
 * trip before the next tile in the stroke can even be evaluated.
 *
 * The processing track (`sow-wheat`, `place-machine`, `process`) is predicted
 * too: each is plain arithmetic on the shelf, a plot list or a machine row,
 * and the Workshop sheet is a scrim over the map, so a press that waited on a
 * round trip would have nothing else on screen to hide behind. `sell`'s
 * inventory debit is predicted the same way, but its Gold is not, for the
 * identical reason `collect`'s Gold is not: the server applies the Prestige
 * multiplier and the daily ceiling, and a guess that then corrected downward
 * would be worse than showing nothing until the real number lands. `work`
 * stays unpredicted (a Mill's double-output roll), and so do
 * `seal-vat`/`collect-vat` -- the vat's own sheet awaits the answer and says
 * so in its own note, the same way the town board does.
 *
 * The patch is shaped as a subset of the component's own response type, so
 * the component applies it through the identical `applyResponse` path a real
 * response takes -- see stackacres-farm.tsx.
 */

import type { PlayerProfile } from "@/lib/profile/types";
import {
  STACKACRES_CATALOGUE,
  STACKACRES_FEED,
  isLivestock,
  stackacresCapacityPrice,
  type SeedStock,
  type StackAcresStock,
} from "./catalogue";
import { stackacresStockPrice } from "./market";
import type { StackAcresContractRow } from "./contracts";
import { sectorClearCheck, type SectorId } from "./sectors";
import { cropFieldsUnlockCheck } from "./crop-fields";
import { decrementHeldSecret, nextUpkeepPaidAfterDiceTrade, type SecretItemId } from "./secrets";
import {
  SYNERGY_MAX_ACTIVE_SLOTS,
  SYNERGY_PERKS,
  applySynergyEffects,
  nextActiveLoadout,
  type SynergyArchetype,
} from "./synergy-perks";
import { nextToolTier, toolUpgradePrice, type StackAcresToolTier } from "./equipment";
import { ownedStackAcresCutters, stackacresCutterDef, type StackAcresCutter } from "./cutters";
import { applyInfluenceDiscount } from "./influence-tiers";
import type { StackAcresUpkeepState } from "./upkeep";
import { PIPE_PLACE_COST, recalculatePipeConnections, type PipeNode, type PlacedPipe } from "./irrigation";
import { createSoilMap, nextFreeSoilSlot, plantSoilTile, soilSlotOnTile, type SoilTile } from "./soil";
import { SOIL_DEFAULT_TIER, type SoilStock } from "./soil-tiers";
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
import { WATER_CAPACITY } from "./water-can";
import { stockZone } from "./world";
import { removeFromInventory, type StackAcresInventory } from "./inventory";
import {
  MACHINE_CAP,
  MACHINE_CATALOGUE,
  canStartMachine,
  type StackAcresMachineSnapshot,
} from "./machines";
import { applyRecipeOptimistically } from "./optimistic-recipe";
import { RECIPE_CATALOGUE, isInstantRecipe } from "./recipes";
import {
  WHEAT_DURATION_MS,
  WHEAT_PLOT_CAP,
  WHEAT_SEED_COST,
  type StackAcresWheatPlotSnapshot,
} from "./wheat-plot";

/** A machine as the view carries it: the snapshot plus the server's own
 *  "could start now" read of the shelf. */
export type MachineView = StackAcresMachineSnapshot & { canStart: boolean };

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
  /** Water left in the watering can. */
  water: number;
  capacity: Partial<Record<StackAcresStock, number>>;
  seedStock: SeedStock;
  toolTier: StackAcresToolTier;
  cutters: readonly StackAcresCutter[];
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
  /** Whether the Crop Fields (./crop-fields.ts) have been unlocked. Same
   *  posture as `greenhouseBuilt`: a permanent flag, not a `SectorId`, since
   *  the 2026-09-08 district merge folded that district into the Farmstead. */
  cropFieldsUnlocked: boolean;
  /** The irrigation pipe network, straight off the component's own state --
   *  what `place-pipe`/`remove-pipe` recompute against. See ./irrigation.ts. */
  irrigation: readonly PipeNode[];
  /** This profile's placed soil beds, straight off the component's own state.
   *  What `place-soil-tile`/`remove-soil-tile` add to or remove from. */
  soilTiles: readonly SoilTile[];
  /** Unplaced bags per tier, straight off the component's own state. What
   *  `place-soil-tile` spends one of -- see ./soil-tiers.ts's own header on
   *  why a bag and Gold are never the same debit. */
  soilStock: SoilStock;
  /** The processing track, straight off the component's own `processing`
   *  state. Always patched together with `contract` (see `processingPatch`)
   *  because the component applies the four as one unit. */
  inventory: StackAcresInventory;
  wheatPlots: readonly StackAcresWheatPlotSnapshot[];
  machines: readonly MachineView[];
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
  water?: number;
  capacity?: Partial<Record<StackAcresStock, number>>;
  seedStock?: SeedStock;
  sectors?: SectorId[];
  upkeep?: StackAcresUpkeepState;
  tool?: StackAcresToolTier;
  cutters?: StackAcresCutter[];
  influence?: number;
  greenhouseBuilt?: boolean;
  cropFieldsUnlocked?: boolean;
  irrigation?: readonly PipeNode[];
  soilTiles?: SoilTile[];
  soilStock?: SoilStock;
  contract?: StackAcresContractRow | null;
  inventory?: StackAcresInventory;
  wheatPlots?: StackAcresWheatPlotSnapshot[];
  machines?: MachineView[];
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
 * The processing track as one patch. The component only ever sets the four
 * together (stackacres-farm.tsx's `applyResponse`: "all four move together
 * or not at all", and a missing `contract` there reads as null), so a
 * predictor that changed the shelf alone would silently drop the open
 * contract. Every processing predictor goes through this.
 */
function processingPatch(
  ctx: FarmPredictContext,
  next: { inventory?: StackAcresInventory; wheatPlots?: StackAcresWheatPlotSnapshot[]; machines?: MachineView[] },
): Pick<FarmStatePatch, "contract" | "inventory" | "wheatPlots" | "machines"> {
  const inventory = next.inventory ?? ctx.inventory;
  const machines = next.machines ?? [...ctx.machines];
  return {
    contract: ctx.contract,
    inventory,
    wheatPlots: next.wheatPlots ?? [...ctx.wheatPlots],
    // `canStart` is the server's read of the shelf; re-derive it here so a
    // Dairy key lights up the instant the milk it needs lands.
    machines: machines.map((machine) => ({ ...machine, canStart: canStartMachine(inventory, machine.kind) })),
  };
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
    case "feed-pen": {
      // Same order the server feeds in: soonest-hungry first, as far as the
      // feed goes.
      const fed = ctx.units
        .filter((u) => u.state === "hungry" && stockZone(u.stock) === body.zone)
        .sort((a, b) => (a.hungryAt ?? "").localeCompare(b.hungryAt ?? ""))
        .slice(0, Math.max(0, ctx.feed));
      if (fed.length === 0) return null;
      const ids = new Set(fed.map((u) => u.id));
      return {
        units: ctx.units.map((u) => (ids.has(u.id) ? optimisticallyFedUnit(u, ctx.nowMs) : u)),
        feed: ctx.feed - fed.length,
      };
    }
    case "water": {
      const unit = ctx.units.find((u) => u.id === body.unitId);
      if (!unit || ctx.water < 1) return null;
      return {
        units: ctx.units.map((u) => (u.id === unit.id ? optimisticallyWateredUnit(u, ctx.nowMs) : u)),
        water: ctx.water - 1,
      };
    }
    case "draw-water":
      return ctx.water >= WATER_CAPACITY ? null : { water: WATER_CAPACITY };
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
      const unit = optimisticallyStockedUnit({
        id: newOptimisticUnitId(),
        stock: body.stock,
        permanent: false,
        inGreenhouse: body.inGreenhouse === true,
        nowMs: ctx.nowMs,
      });
      // Livestock still pays Gold straight out of the purse, unchanged --
      // there is no seed shelf for a Hen Coop/Sheep Pen/Cattle Pen. A crop
      // spends one seed off the shelf instead; the Gold already left at
      // Ray's shop when the seed was bought, so guessing a Gold debit here
      // too would flash a spend that never happens.
      if (isLivestock(body.stock)) {
        const profile = debited(ctx, STACKACRES_CATALOGUE[body.stock].seedCost);
        if (!profile) return null;
        return { units: [...ctx.units, unit], profile };
      }
      const held = ctx.seedStock[body.stock] ?? 0;
      if (held < 1) return null;
      // An open-air crop needs a free bed somewhere on the farm (2026-09-09,
      // `stockStackAcres`'s own gate) -- the same "is there ANY free slot"
      // question `assignSoilSlot` asks, since a tap that names no bed still
      // plants on the lowest free one. A farm with nothing tilled would
      // flash a sprout the server is about to refuse, so it guesses nothing.
      // Greenhouse crops stand on the glasshouse's own sub-grid instead.
      if (body.inGreenhouse !== true) {
        const taken = ctx.units
          .map((u) => u.soilSlot)
          .filter((slot): slot is number => slot !== null);
        if (nextFreeSoilSlot(createSoilMap(ctx.soilTiles), taken) === null) return null;
      }
      return {
        units: [...ctx.units, unit],
        seedStock: { ...ctx.seedStock, [body.stock]: held - 1 },
      };
    }
    case "buy-stock": {
      // Buying a crop outright plants it, so it needs a free bed the same way
      // sowing does (`buyStackAcresStock`'s own gate). Nothing tilled means
      // the server is about to refuse, so guess nothing.
      if (!isLivestock(body.stock)) {
        const taken = ctx.units
          .map((u) => u.soilSlot)
          .filter((slot): slot is number => slot !== null);
        if (nextFreeSoilSlot(createSoilMap(ctx.soilTiles), taken) === null) return null;
      }
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
      // Crops have no capacity to expand -- the server refuses it outright,
      // so guess nothing rather than flash a spend that never happens.
      if (!isLivestock(body.stock)) return null;
      const profile = debited(ctx, stackacresCapacityPrice(body.stock));
      if (!profile) return null;
      return { capacity: { ...ctx.capacity, [body.stock]: (ctx.capacity[body.stock] ?? 0) + 1 }, profile };
    }
    case "buy-feed": {
      const item = STACKACRES_FEED[body.itemId];
      if (!item) return null;
      const profile = debited(ctx, item.cost * body.quantity);
      if (!profile) return null;
      return { feed: ctx.feed + item.servings * body.quantity, profile };
    }
    case "upgrade-tool": {
      const next = nextToolTier(ctx.toolTier);
      const price = toolUpgradePrice(ctx.toolTier);
      if (!next || price === null) return null;
      const profile = debited(ctx, price);
      if (!profile) return null;
      return { tool: next, profile };
    }
    case "buy-cutter": {
      const price = stackacresCutterDef(body.cutter).price;
      if (price === null || ctx.cutters.includes(body.cutter)) return null;
      const profile = debited(ctx, applyInfluenceDiscount(price, ctx.influence));
      if (!profile) return null;
      return { cutters: ownedStackAcresCutters([...ctx.cutters, body.cutter]), profile };
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
    case "unlock-crop-fields": {
      const check = cropFieldsUnlockCheck({
        unlocked: ctx.cropFieldsUnlocked,
        unitCount: ctx.units.length,
      });
      if (check.alreadyOpen || !check.ok) return null;
      const profile = debited(ctx, check.cost);
      if (!profile) return null;
      return { cropFieldsUnlocked: true, profile };
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
    case "place-pipe": {
      const existing = ctx.irrigation.find((node) => node.tx === body.tx && node.ty === body.ty);
      if (existing) return null;
      // Only one well per farm (see stackacres-farm.tsx's `pipeExtraActions`
      // `hasWell` check) -- a second dig here would guess a tile the server
      // is certain to refuse.
      if (body.kind === "well" && ctx.irrigation.some((node) => node.kind === "well")) return null;
      const profile = debited(ctx, PIPE_PLACE_COST[body.kind]);
      if (!profile) return null;
      // `facing` carried through for every tile already down, so a recompute
      // never silently un-aims a stub that is still lone after this lands.
      const tiles: PlacedPipe[] = [
        ...ctx.irrigation.map((node) => ({ tx: node.tx, ty: node.ty, kind: node.kind, facing: node.facing })),
        { tx: body.tx, ty: body.ty, kind: body.kind },
      ];
      // Crop-free on purpose: mask/hydration/distance are pure tile topology,
      // and this predictor never guesses which crop that newly waters -- the
      // server's own response settles that, same as every other unit field.
      const grid = recalculatePipeConnections({ tiles, crops: [] });
      return { irrigation: grid.nodes, profile };
    }
    case "remove-pipe": {
      const existing = ctx.irrigation.find((node) => node.tx === body.tx && node.ty === body.ty);
      if (!existing) return null;
      // No Gold moves here -- a placed tile is a spent sink, not a refundable
      // one (see irrigation.ts's own `PIPE_PLACE_COST` doc comment).
      const tiles: PlacedPipe[] = ctx.irrigation
        .filter((node) => node.tx !== body.tx || node.ty !== body.ty)
        .map((node) => ({ tx: node.tx, ty: node.ty, kind: node.kind, facing: node.facing }));
      const grid = recalculatePipeConnections({ tiles, crops: [] });
      return { irrigation: grid.nodes };
    }
    case "aim-pipe": {
      // Cosmetic and topology-free: no recompute, no Gold -- the one node's
      // `facing` moves and nothing else does (see irrigation.ts's own
      // `PipeFacing` doc). A well, or a coordinate with nothing on it, is a
      // tap the server is certain to refuse, so nothing is guessed for it.
      const existing = ctx.irrigation.find((node) => node.tx === body.tx && node.ty === body.ty);
      if (!existing || existing.kind !== "pipe") return null;
      return {
        irrigation: ctx.irrigation.map((node) =>
          node === existing ? { ...node, facing: body.facing } : node,
        ),
      };
    }
    case "place-soil-tile": {
      const tier = body.tier ?? SOIL_DEFAULT_TIER;
      const held = ctx.soilStock[tier] ?? 0;
      if (held < 1) return null;
      const soil = createSoilMap(ctx.soilTiles);
      const result = plantSoilTile(soil, { tx: body.tx, ty: body.ty }, tier);
      if (result.kind !== "created") return null;
      return {
        soilTiles: [...ctx.soilTiles, result.tile],
        soilStock: { ...ctx.soilStock, [tier]: held - 1 },
      };
    }
    case "remove-soil-tile": {
      const existing = ctx.soilTiles.find((t) => t.tx === body.tx && t.ty === body.ty);
      if (!existing) return null;
      // No bag comes back -- a placed tile is a spent sink, not a refundable
      // one (see soil.ts's own `SOIL_TILE_PRICE_GOLD` doc comment).
      const soilTiles = ctx.soilTiles.filter((t) => t.tx !== body.tx || t.ty !== body.ty);
      // A crop standing on the lifted bed goes with it -- the same
      // `soilSlotOnTile` question stackacres-service.ts asks server-side
      // before it deletes the occupant for real. Reads `ctx.soilTiles`
      // (before the removal), same reason the service resolves occupancy
      // before its own delete: the crop's slot names this tile by its
      // position in the CURRENT lattice, which the removal is about to
      // shrink. No refund of its seed cost either.
      const soil = createSoilMap(ctx.soilTiles);
      const occupant = ctx.units.find(
        (unit) => unit.soilSlot !== null && soilSlotOnTile(soil, unit.soilSlot, body.tx, body.ty),
      );
      if (!occupant) return { soilTiles };
      return { soilTiles, units: withoutStackAcresUnit(ctx.units, occupant.id) };
    }
    case "sow-wheat": {
      if (ctx.wheatPlots.length >= WHEAT_PLOT_CAP) return null;
      const profile = debited(ctx, WHEAT_SEED_COST);
      if (!profile) return null;
      const plot: StackAcresWheatPlotSnapshot = {
        id: newOptimisticUnitId(),
        startedAt: new Date(ctx.nowMs).toISOString(),
        readyAt: new Date(ctx.nowMs + WHEAT_DURATION_MS).toISOString(),
        ready: false,
        progress: 0,
      };
      return { profile, ...processingPatch(ctx, { wheatPlots: [...ctx.wheatPlots, plot] }) };
    }
    case "place-machine": {
      // One of each kind, and a flat cap -- the same two refusals the server
      // makes (`homestead_machines_one_per_kind`, `MACHINE_CAP`).
      if (ctx.machines.some((machine) => machine.kind === body.kind)) return null;
      if (ctx.machines.length >= MACHINE_CAP) return null;
      const profile = debited(ctx, MACHINE_CATALOGUE[body.kind].placeCost);
      if (!profile) return null;
      const machine: MachineView = {
        id: newOptimisticUnitId(),
        kind: body.kind,
        status: "idle",
        startedAt: null,
        readyAt: null,
        recipeId: null,
        unitsProcessing: 0,
        done: false,
        progress: null,
        canStart: false,
      };
      return { profile, ...processingPatch(ctx, { machines: [...ctx.machines, machine] }) };
    }
    case "process": {
      const def = RECIPE_CATALOGUE[body.recipe];
      const machine = ctx.machines.find((candidate) => candidate.kind === def.machine);
      if (!machine || machine.status !== "idle") return null;
      if (isInstantRecipe(body.recipe)) {
        // One transaction on the server, one arithmetic step here.
        const applied = applyRecipeOptimistically(ctx.inventory, body.recipe);
        if (!applied.ok) return null;
        return processingPatch(ctx, { inventory: applied.next });
      }
      // A queued run: the input leaves now, the output arrives when `work`
      // collects it. The row itself becomes the queue entry, snapshotting
      // the recipe and yield exactly as `startStackAcresMachine` does. Every
      // queued recipe today (only the Mill's Flour) has exactly one input.
      let inventory: StackAcresInventory | null = ctx.inventory;
      for (const input of def.inputs) {
        inventory = removeFromInventory(inventory, input.item, input.quantity);
        if (!inventory) return null;
      }
      const working: MachineView = {
        ...machine,
        status: "working",
        startedAt: new Date(ctx.nowMs).toISOString(),
        readyAt: new Date(ctx.nowMs + def.processingMs).toISOString(),
        recipeId: body.recipe,
        unitsProcessing: def.output.quantity,
        done: false,
        progress: 0,
      };
      return processingPatch(ctx, {
        inventory,
        machines: ctx.machines.map((candidate) => (candidate.id === machine.id ? working : candidate)),
      });
    }
    case "sell": {
      // Known-insufficient is a real refusal, not a guess -- refuse locally
      // rather than optimistically show a sale that cannot happen.
      const inventory = removeFromInventory(ctx.inventory, body.item, body.quantity);
      if (!inventory) return null;
      // Gold is not predicted -- see this module's own header on why `sell`
      // takes the same posture `collect` always has.
      return processingPatch(ctx, { inventory });
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
    // own Gold, `tap-secret-zone`, `request-contract`, `work`), await their
    // own sheet's answer (`seal-vat`, `collect-vat`), or move nothing the
    // client keeps state for (`build-greenhouse`'s materials aside from the
    // flag itself, blueprints, prestige). See this module's own header.
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
