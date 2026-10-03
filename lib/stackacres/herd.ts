/**
 * Where the herd stands.
 *
 * Sheep and cattle used to live in two fixed districts, the Fold and Cattle
 * Pasture. Their maps are gone, so nobody could buy either animal. An animal
 * is now something the player sets down themselves, on any open grass in the
 * yard, and picks up again to move it.
 *
 * A SQUARE IS A HOMESTEAD MAP TILE (16 units), the same squares fences use. One
 * animal to a square. It goes where a bed could go (./hoeable.ts), except the
 * overgrown ring round the yard, and never on a bed or a fence piece.
 *
 * NO FENCE IS REQUIRED. What a loose animal costs the player is a later phase
 * (docs/stackacres-herd-plan.md); nothing here reads a fence except to keep
 * two things off one square.
 *
 * GOLD: none. Buying an animal is the only money, and it happens before the
 * animal exists (lib/server/stackacres-service.ts's `buyStackAcresStock`).
 * Placing and picking up move nothing and refund nothing.
 *
 * Pure: the server and the scene both import this.
 */

import type { StackAcresStock } from "./catalogue";
import { isHoeableMapTile, isWildMapTile } from "./hoeable";

/** The kinds that stand where the player puts them. Hens keep their Hen Haven spots. */
export const HERD_STOCK = ["pig", "cattle", "hog", "steer"] as const;

export type HerdStock = (typeof HERD_STOCK)[number];

export function isHerdStock(stock: StackAcresStock): stock is HerdStock {
  return (HERD_STOCK as readonly StackAcresStock[]).includes(stock);
}

export function herdKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export type HerdPlacementProblem = "off_yard" | "bed" | "fence" | "occupied";

export const HERD_PLACEMENT_MESSAGES: Record<HerdPlacementProblem, string> = {
  off_yard: "Animals go on open grass in the yard.",
  bed: "There's a bed there.",
  fence: "There's a fence there.",
  occupied: "Another animal is already standing there.",
};

/** Whether an animal may stand on this map square, before beds, fences and other animals. */
export function isHerdMapTile(tx: number, ty: number): boolean {
  return Number.isInteger(tx) && Number.isInteger(ty) && isHoeableMapTile(tx, ty) && !isWildMapTile(tx, ty);
}

/**
 * Why an animal may not be set down on (tx, ty), or null when it may.
 *
 * `beds`, `fences` and `animals` are sets of `herdKey`s in MAP tiles. `animals`
 * is every OTHER animal's square, so moving an animal onto the square it
 * already holds is fine.
 */
export function herdPlacementProblem(
  tx: number,
  ty: number,
  taken: { beds: ReadonlySet<string>; fences: ReadonlySet<string>; animals: ReadonlySet<string> },
): HerdPlacementProblem | null {
  if (!isHerdMapTile(tx, ty)) return "off_yard";
  const key = herdKey(tx, ty);
  if (taken.beds.has(key)) return "bed";
  if (taken.fences.has(key)) return "fence";
  if (taken.animals.has(key)) return "occupied";
  return null;
}

/** A unit with just what placement cares about. */
export interface HerdUnit {
  readonly id: string;
  readonly stock: StackAcresStock;
  readonly mapTx?: number | null;
  readonly mapTy?: number | null;
}

/** Whether this unit is a herd animal that has been set down. */
export function isPlaced(unit: HerdUnit): boolean {
  return isHerdStock(unit.stock) && unit.mapTx != null && unit.mapTy != null;
}

/** Herd animals that were bought but not yet set down, in a stable order. */
export function unplacedHerd<T extends HerdUnit>(units: readonly T[]): T[] {
  return units.filter((unit) => isHerdStock(unit.stock) && !isPlaced(unit)).sort((a, b) => a.id.localeCompare(b.id));
}

/** The squares every placed herd animal other than `exceptId` stands on. */
export function herdSquares(units: readonly HerdUnit[], exceptId: string | null = null): Set<string> {
  const squares = new Set<string>();
  for (const unit of units) {
    if (unit.id === exceptId || !isPlaced(unit)) continue;
    squares.add(herdKey(unit.mapTx as number, unit.mapTy as number));
  }
  return squares;
}
