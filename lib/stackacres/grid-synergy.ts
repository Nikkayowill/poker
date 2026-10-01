/**
 * Grid Synergy: the one positional mechanic on the farm. Each Tier 4
 * "Ancient Grove" crop (see ./catalogue.ts) buffs whichever beds sit
 * orthogonally next to it -- no diagonals, deliberately, so a player can
 * eyeball the buff off the grid ("this Corn touches two other bonus crops,
 * so +16%") instead of trusting a hidden formula.
 *
 * LAYERED ON TOP OF, NEVER REPLACING, the soil-tier growth multiplier
 * ./soil-tiers.ts already provides -- the two multiply together, the same
 * way the Greenhouse's own multiplier already stacks with soil tier in
 * lib/server/stackacres-service.ts's `stockStackAcres`.
 *
 * BOTH KINDS ARE SNAPSHOTTED AT STOCKING, matching rule 3 (see ./catalogue.ts's
 * own header): the growth-speed bonus is folded into `assignSoilSlot`'s own
 * `growthMultiplier` and baked into that row's `readyAt`, exactly like a soil
 * tier's own bonus already is; the yield bonus is folded into that same
 * row's `yieldQuantity`. A retune of TIER4_SYNERGY below cannot change what
 * an already-growing crop returns, for the same reason a soil-tier retune
 * cannot. There is deliberately no sell-price kind: a harvest credits the
 * shared processing inventory rather than a unit's own row (./items.ts's own
 * header), so by the time anything is sold it has no origin tile left to
 * read a neighbour off of -- a "sell price" buff would really be "whatever
 * happens to be planted on the farm when you hit Sell", which is not a grid
 * mechanic at all.
 *
 * NO diagonal neighbours, and no self-buff: a crop growing IN a Tier 4 bed
 * does not buff itself, only the beds around it.
 */

import type { StackAcresCrop, StackAcresStock } from "./catalogue";
import { soilSlotForTile, type SoilMap, type SoilTileCoord } from "./soil";

export type SynergyKind = "growthSpeed" | "yieldQty";

export interface SynergyBuff {
  kind: SynergyKind;
  bonusPct: number;
}

/**
 * Which Tier 4 crop buffs what, and by how much. Every id here is one of
 * the 16 real crops already shipped (see ./catalogue.ts) -- no new sprite
 * art needed to ship this mechanic. Two crops per kind, deliberately: with
 * only two kinds and four Tier 4 crops, a player planning a Grove corner
 * gets a real choice between stacking one kind or mixing both, rather than
 * one kind being strictly rarer than the other.
 */
export const TIER4_SYNERGY: Readonly<Partial<Record<StackAcresCrop, SynergyBuff>>> = {
  corn: { kind: "growthSpeed", bonusPct: 8 },
  tomato: { kind: "growthSpeed", bonusPct: 8 },
  eggplant: { kind: "yieldQty", bonusPct: 8 },
  wheatsheaf: { kind: "yieldQty", bonusPct: 8 },
};

/** The four tiles orthogonally touching `tx,ty`. No diagonals -- see this
 *  file's header. */
export function orthogonalNeighbours(tx: number, ty: number): SoilTileCoord[] {
  return [
    { tx: tx + 1, ty },
    { tx: tx - 1, ty },
    { tx, ty: ty + 1 },
    { tx, ty: ty - 1 },
  ];
}

/**
 * Which stock kind occupies each taken soil slot, keyed by slot number.
 * Built once per call site and handed to every `synergy*` call below rather
 * than re-scanned per neighbour lookup.
 */
export function stockBySoilSlot(
  units: readonly { soilSlot: number | null; stock: StackAcresStock }[],
): ReadonlyMap<number, StackAcresStock> {
  const bySlot = new Map<number, StackAcresStock>();
  for (const unit of units) {
    if (unit.soilSlot !== null) bySlot.set(unit.soilSlot, unit.stock);
  }
  return bySlot;
}

/**
 * The total percentage bonus of `kind` that `tile` receives from its
 * orthogonal neighbours right now. Pure: a function of the soil layout, who
 * is standing where, and the tile asking. Additive across neighbours, and
 * naturally bounded at 4 -- one per orthogonal side, no diagonal fifth to
 * add from.
 */
export function synergyBonusPct(
  kind: SynergyKind,
  soil: SoilMap,
  tile: SoilTileCoord,
  stockBySlot: ReadonlyMap<number, StackAcresStock>,
): number {
  let total = 0;
  for (const neighbour of orthogonalNeighbours(tile.tx, tile.ty)) {
    const slot = soilSlotForTile(soil, neighbour.tx, neighbour.ty);
    if (slot === null) continue;
    const stock = stockBySlot.get(slot);
    if (!stock) continue;
    const buff = TIER4_SYNERGY[stock as StackAcresCrop];
    if (buff && buff.kind === kind) total += buff.bonusPct;
  }
  return total;
}

/**
 * `synergyBonusPct("growthSpeed", ...)` turned into a duration MULTIPLIER --
 * the same shape `soilGrowthMultiplier` (./soil-tiers.ts) already returns,
 * so a caller multiplies the two straight together. Below 1 is faster: an
 * 8% bonus from one neighbour returns roughly 0.926, an 8% saving off
 * whatever `durationMs` the soil tier already produced.
 */
export function synergyGrowthMultiplier(
  soil: SoilMap,
  tile: SoilTileCoord,
  stockBySlot: ReadonlyMap<number, StackAcresStock>,
): number {
  const pct = synergyBonusPct("growthSpeed", soil, tile, stockBySlot);
  if (pct <= 0) return 1;
  return 1 / (1 + pct / 100);
}

/**
 * `synergyBonusPct("yieldQty", ...)` turned into extra units of produce,
 * floored so a fractional percentage never silently rounds up into a free
 * half-unit.
 */
export function synergyYieldBonus(
  baseQuantity: number,
  soil: SoilMap,
  tile: SoilTileCoord,
  stockBySlot: ReadonlyMap<number, StackAcresStock>,
): number {
  const pct = synergyBonusPct("yieldQty", soil, tile, stockBySlot);
  return Math.floor((baseQuantity * pct) / 100);
}
