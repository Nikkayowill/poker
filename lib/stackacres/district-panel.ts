/**
 * What the sidebar shows for one district: the units standing there and the
 * one action each affords, plus what can be bought there and whether it's
 * affordable.
 *
 * Successor to most of ./tools.ts. The old design was tool-first -- hold
 * Plant, every plantable plot lights up, tap one -- because the whole surface
 * was a grid of identical-looking cells and a held tool was how the grid told
 * you what a tap would do. There is no grid any more: travelling to a
 * district (the signpost, unchanged) IS the selection, and every unit you
 * own there is already a labelled row with its own button. Nothing needs to
 * be held first.
 *
 * Nothing here is authoritative, same posture ./tools.ts always had: this is
 * good enough to paint a button as enabled or disabled with, not a promise --
 * the server still refuses a stale or racing action and its refusal carries
 * the true list back. Gold affordability is deliberately NOT checked here,
 * the same way it never was for buying land or stock outright before this
 * change: a Gold-priced button stays enabled and the server's refusal is what
 * tells the player they're short, exactly like every other Gold spend in this
 * app.
 */

import {
  STACKACRES_BASE_CAP,
  STACKACRES_CATALOGUE,
  STACKACRES_LIVESTOCK,
  STACKACRES_MAX_EXTRA_CAP,
  isLivestock,
  stackacresCapacityMaterials,
  stackacresCapacityPrice,
  type StackAcresStock,
} from "./catalogue";
import { stackacresStockOwnableOutright, stackacresStockPrice } from "./market";
import { isActiveStock } from "./scope";
import { shelfFeedFor } from "./feeding";
import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import type { StackAcresUnitSnapshot } from "./units";
import { isSectorUnlocked, sectorLabel, type SectorId } from "./sectors";
import { stockZone, stocksInZone } from "./world";
import type { ZoneId } from "./zones";

/** What one owned unit's row offers, and why not if it doesn't. */
export type UnitRowAction =
  | { kind: "collect" }
  | { kind: "feed"; disabled: boolean; reason: string | null }
  /** Watering costs nothing but attention, so unlike feeding it can never be
   *  refused for want of a resource -- there is no `disabled` here. */
  | { kind: "water" }
  | { kind: "clear"; fee: number; disabled: boolean; reason: string | null }
  | { kind: "retire" }
  | { kind: "none" };

/** The one action a unit's row affords right now. */
export function unitRowAction(
  unit: StackAcresUnitSnapshot,
  context: { feed: number; gold: number; shelfFeed?: StackAcresInventory },
): UnitRowAction {
  switch (unit.state) {
    case "ready":
      return { kind: "collect" };
    case "hungry":
      // Hens and cattle eat off the shelf before the Feed Sack (./feeding.ts).
      return context.feed < 1 && shelfFeedFor(unit.stock, context.shelfFeed ?? {}) < 1
        ? { kind: "feed", disabled: true, reason: "No feed left in the barn." }
        : { kind: "feed", disabled: false, reason: null };
    case "dry":
      return { kind: "water" };
    case "mucked": {
      const fee = unit.muckFee ?? 0;
      return context.gold < fee
        ? { kind: "clear", fee, disabled: true, reason: `Clearing costs ${fee.toLocaleString()} Gold.` }
        : { kind: "clear", fee, disabled: false, reason: null };
    }
    case "working":
      return unit.permanent ? { kind: "retire" } : { kind: "none" };
  }
}

/**
 * How many of one kind are currently occupying a slot, across every
 * district -- the cap is per kind, not per district, the same number
 * wherever it's read from.
 *
 * Deliberately every unit of that stock, mucked included -- matching the
 * server's own `countOccupiedStackAcresUnits`. A mucked unit is not earning,
 * but it still holds its slot until cleared; counting only the working ones
 * would let muck stop mattering (buy a fresh one instead of ever clearing
 * the old one).
 */
export function occupiedCountFor(units: readonly StackAcresUnitSnapshot[], stock: StackAcresStock): number {
  return units.filter((u) => u.stock === stock).length;
}

export interface BuyOption {
  stock: StackAcresStock;
  label: string;
  owned: number;
  /** Null for a crop: crops are uncapped, so there is no ceiling to show or
   *  hit. Only livestock (hen/pig/cattle) still carries a real number here. */
  cap: number | null;
  atCap: boolean;
  /** Gold, buys ONE cycle. A fiftieth of `outrightCost`. */
  seedCost: number;
  seedAfford: boolean;
  seedReason: string | null;
  /** Gold, buys the animal/crop outright and permanently. Null for a kind
   *  that is never sold outright (tier-1 crops), which shows no Buy button at
   *  all rather than a disabled one. */
  outrightCost: number | null;
  /** Null once capacity is already maxed, or for a crop, which never has
   *  anything to expand. `timber` is the Wood the slot also costs
   *  (catalogue.ts's STACKACRES_CAPACITY_MATERIALS) and how much is in the
   *  barn, so the button can name both halves of the price. */
  expand: { cost: number; timber: { need: number; have: number } } | null;
}

/** What can be bought in this district, one entry per stock kind that lives
 *  there (./world.ts's `stocksInZone`). */
export function buyOptionsForZone(
  zone: ZoneId,
  context: {
    units: readonly StackAcresUnitSnapshot[];
    gold: number;
    capacity: Readonly<Record<string, number>>;
    /** The processing inventory, for the pen slot's timber line. */
    inventory?: StackAcresInventory;
  },
): BuyOption[] {
  // Only what the active scope sells this pass (./scope.ts). A hidden kind a
  // player already owns keeps working everywhere else -- this only stops the
  // shelf offering more of it.
  return stocksInZone(zone).filter(isActiveStock).map((stock) => {
    const def = STACKACRES_CATALOGUE[stock];
    const extraSlots = context.capacity[stock] ?? 0;
    // Crops have no ceiling (catalogue.ts's STACKACRES_BASE_CAP header) --
    // only livestock still runs a pen that can fill up.
    const cap = isLivestock(stock)
      ? STACKACRES_BASE_CAP + Math.max(0, Math.min(STACKACRES_MAX_EXTRA_CAP, extraSlots))
      : null;
    const owned = occupiedCountFor(context.units, stock);
    const atCap = cap !== null && owned >= cap;
    return {
      stock,
      label: def.label,
      owned,
      cap,
      atCap,
      seedCost: def.seedCost,
      seedAfford: !atCap && context.gold >= def.seedCost,
      seedReason: atCap
        ? "This pen is already full."
        : context.gold < def.seedCost
          ? `${def.label} seed costs ${def.seedCost.toLocaleString()} Gold.`
          : null,
      outrightCost: stackacresStockOwnableOutright(stock) ? stackacresStockPrice(stock) : null,
      // Only worth showing once the base cap is actually the thing in the
      // way -- offering to expand a kind you have room in already would be
      // a Gold button for a problem you do not have. Never shown for a crop:
      // isLivestock(stock) is false whenever cap/atCap already are.
      expand:
        isLivestock(stock) && atCap && extraSlots < STACKACRES_MAX_EXTRA_CAP
          ? {
              cost: stackacresCapacityPrice(stock),
              timber: {
                need: stackacresCapacityMaterials(stock).reduce((total, material) => total + material.quantity, 0),
                have: inventoryQuantity(context.inventory ?? {}, "wood"),
              },
            }
          : null,
    };
  });
}

/** A pen the barn shows greyed out because its land is not cleared yet. */
export interface LockedLivestock {
  stock: StackAcresStock;
  label: string;
  /** The district to clear. Opening its clearing sheet is the way to unlock it. */
  sector: SectorId;
  sectorLabel: string;
}

/** Every buyable livestock kind whose district this farm has not cleared, in catalogue order. */
export function lockedLivestock(unlocked: readonly SectorId[]): LockedLivestock[] {
  return STACKACRES_LIVESTOCK.filter(isActiveStock)
    .filter((stock) => !isSectorUnlocked(stockZone(stock), unlocked))
    .map((stock) => ({
      stock,
      label: STACKACRES_CATALOGUE[stock].label,
      sector: stockZone(stock),
      sectorLabel: sectorLabel(stockZone(stock)),
    }));
}
