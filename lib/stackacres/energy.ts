/**
 * Energy: a per-farm stat that only powers extras (fishing, for now).
 * Planting, watering, harvesting, feeding and selling never cost energy.
 *
 * Stored lazily as a level plus the time that level was true, and computed
 * on read as a pure function of `now`, the same posture every other clock in
 * StackAcres keeps. Nothing ticks in the background.
 *
 * Waiting refills 1 point every 6 minutes, but only up to 50. Eating food is
 * the only way above 50, up to 100. Energy is never bought with Gold.
 */

import type { MachineItemId } from "./machine-items";

export const ENERGY_MAX = 100;
/** Waiting never takes energy past this. Food does. */
export const ENERGY_REGEN_CAP = 50;
export const ENERGY_REGEN_MS = 6 * 60 * 1000;
/** A farm with no energy row yet reads as full. */
export const ENERGY_START = ENERGY_MAX;
export const FISHING_CAST_ENERGY = 5;
export const TOO_TIRED_TO_FISH = "You're too tired to fish. Eat something from the kitchen!";

export const FOOD_ITEMS = ["bread", "cake"] as const;
export type FoodItem = (typeof FOOD_ITEMS)[number];

export const FOOD_ENERGY: Readonly<Record<FoodItem, number>> = {
  bread: 20,
  cake: 25,
};

export function isFoodItem(value: string): value is FoodItem & MachineItemId {
  return (FOOD_ITEMS as readonly string[]).includes(value);
}

/** What is stored: the level, and the instant it was that level. */
export interface StackAcresEnergyAnchor {
  level: number;
  updatedAt: string;
}

/**
 * The anchor as of `now`: regen applied, and `updatedAt` moved forward only
 * by whole points earned, so a partial point in progress is never lost when
 * a new anchor is written. A level at or above the regen cap does not regen,
 * so its clock simply restarts at `now`.
 */
export function settleEnergy(anchor: StackAcresEnergyAnchor | null, now: Date): StackAcresEnergyAnchor {
  const nowMs = now.getTime();
  if (!anchor) return { level: ENERGY_START, updatedAt: now.toISOString() };
  const level = Math.max(0, Math.min(ENERGY_MAX, Math.trunc(anchor.level)));
  const at = Date.parse(anchor.updatedAt);
  if (level >= ENERGY_REGEN_CAP || !Number.isFinite(at)) {
    return { level, updatedAt: now.toISOString() };
  }
  const ticks = Math.floor(Math.max(0, nowMs - at) / ENERGY_REGEN_MS);
  const regenerated = level + ticks;
  if (regenerated >= ENERGY_REGEN_CAP) return { level: ENERGY_REGEN_CAP, updatedAt: now.toISOString() };
  return { level: regenerated, updatedAt: new Date(at + ticks * ENERGY_REGEN_MS).toISOString() };
}

/** The level right now. */
export function energyAt(anchor: StackAcresEnergyAnchor | null, now: Date): number {
  return settleEnergy(anchor, now).level;
}

/**
 * The anchor to write after moving energy by `delta`, or null when a spend
 * would go below zero. Clamped to ENERGY_MAX. If a spend drops a level from
 * at-or-above the cap to below it, regen starts from `now`.
 */
export function applyEnergyDelta(
  anchor: StackAcresEnergyAnchor | null,
  delta: number,
  now: Date,
): StackAcresEnergyAnchor | null {
  const settled = settleEnergy(anchor, now);
  const next = settled.level + delta;
  if (next < 0) return null;
  return { level: Math.min(ENERGY_MAX, next), updatedAt: settled.updatedAt };
}

/** When the next regen point lands, or null when waiting adds nothing. */
export function nextEnergyPointAt(anchor: StackAcresEnergyAnchor | null, now: Date): Date | null {
  const settled = settleEnergy(anchor, now);
  if (settled.level >= ENERGY_REGEN_CAP) return null;
  return new Date(Date.parse(settled.updatedAt) + ENERGY_REGEN_MS);
}
