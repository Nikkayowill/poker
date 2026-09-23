/**
 * The farmer's axe, and how much a swing of it does.
 *
 * Everyone starts with a level 1 axe, which fells a Homestead tree in 3
 * swings. A better axe does more to the tree per swing, so it comes down in
 * fewer: 2 at level 2, 1 at level 3. What a tree pays does not change with
 * the axe (./wood.ts pays per point of the tree's health taken off), so a
 * better axe saves swings and energy, never Wood.
 *
 * The same damage applies to everything the axe is swung at: the Homestead's
 * trees and the trees and scrub standing on land being cleared
 * (./land-clearing.ts). The pick has no levels yet.
 *
 * Every swing costs energy (./energy.ts), the same 2 whatever the level, so a
 * better axe also means fewer swings of energy per tree.
 *
 * A better axe is made at the Workshop from Wood and Stone, or bought there
 * for Gold instead. Not from Ray's shelf. The ladder is walked one level at a
 * time from whatever the server says is held, the same way the tool ladder in
 * ./equipment.ts is, so a request can never skip a level or buy one twice.
 *
 * Prices are placeholders until the economy pass sets real ones.
 */

import type { MaterialCost } from "./machine-items";

export const AXE_LEVELS = [1, 2, 3] as const;
export type AxeLevel = (typeof AXE_LEVELS)[number];

/** A farm with no axe row yet holds this. */
export const STARTING_AXE_LEVEL: AxeLevel = 1;

/** Energy one axe swing costs, at any level. Same as a swing on land being cleared. */
export const AXE_SWING_ENERGY = 2;

export const TOO_TIRED_TO_CHOP = "You're worn out. Eat something before you swing again.";

/**
 * How much of a tree's health one swing takes off. A Homestead tree has 3,
 * so these are 3, 2 and 1 swings to fell it.
 */
export const AXE_DAMAGE: Readonly<Record<AxeLevel, number>> = { 1: 1, 2: 2, 3: 3 };

export interface AxeLevelDef {
  readonly level: AxeLevel;
  readonly label: string;
  /** Made at the Workshop from these. Null for the starting axe, which is never made. */
  readonly materials: readonly MaterialCost[] | null;
  /** Or bought there for this much Gold instead. Null for the starting axe. */
  readonly gold: number | null;
}

export const AXE_LEVEL_DEFS: Readonly<Record<AxeLevel, AxeLevelDef>> = {
  1: { level: 1, label: "Old Axe", materials: null, gold: null },
  2: { level: 2, label: "Honed Axe", materials: [{ item: "wood", quantity: 30 }], gold: 1_500 },
  3: {
    level: 3,
    label: "Steel Axe",
    materials: [
      { item: "wood", quantity: 60 },
      { item: "stone", quantity: 30 },
    ],
    gold: 8_000,
  },
};

/** How an upgrade is paid for: the Workshop makes it from materials, or sells it for Gold. */
export type AxePayment = "materials" | "gold";

export function isAxeLevel(value: unknown): value is AxeLevel {
  return typeof value === "number" && (AXE_LEVELS as readonly number[]).includes(value);
}

/** The level after `level`, or null at the top. */
export function nextAxeLevel(level: AxeLevel): AxeLevel | null {
  const next = level + 1;
  return isAxeLevel(next) ? next : null;
}

/** Swings to take `health` off a tree with this axe. */
export function swingsToFell(health: number, level: AxeLevel): number {
  return Math.max(1, Math.ceil(health / AXE_DAMAGE[level]));
}
