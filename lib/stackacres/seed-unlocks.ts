/**
 * Which kitchen or farm building opens each crop's seeds in Ray's shop.
 *
 * Wheat is always open (it grows on the Workshop's Wheat Plot, not from shop
 * seed). Every other crop opens when the player has built what uses it, so a
 * seed never appears before the reason to grow it. Derived from the machines
 * the player owns, so there is nothing to store and nothing to migrate.
 *
 * This gates buying seed only. Seed already in the barn and crops already in
 * the ground keep working, so no current player loses anything.
 */

import { STACKACRES_CATALOGUE, type StackAcresCrop } from "./catalogue";
import { MACHINE_CATALOGUE, type MachineKind } from "./machines";

/** Every building a crop needs; all of them must be built. */
export const SEED_UNLOCKS: Readonly<Record<StackAcresCrop, readonly MachineKind[]>> = {
  potato: ["stew_pot"],
  carrot: ["stew_pot"],
  onion: ["stew_pot"],
  lettuce: ["counter"],
  spinach: ["counter"],
  radish: ["counter"],
  cabbage: ["counter"],
  corn: ["mill"],
  green_bean: ["mill"],
  tomato: ["stew_pot", "counter"],
  pepper: ["stew_pot", "counter"],
  bell_pepper: ["stew_pot", "counter"],
  celery: ["stew_pot", "counter"],
  eggplant: ["oven"],
  broccoli: ["oven"],
  // Retired from the shop (./scope.ts); listed only so the table is total.
  wheatsheaf: [],
};

/** The buildings `crop` still needs, in table order. Empty once it is open. */
export function missingForSeed(crop: StackAcresCrop, built: ReadonlySet<MachineKind>): MachineKind[] {
  return SEED_UNLOCKS[crop].filter((kind) => !built.has(kind));
}

export function isSeedUnlocked(crop: StackAcresCrop, built: ReadonlySet<MachineKind>): boolean {
  return missingForSeed(crop, built).length === 0;
}

/** "Build the Stew Pot to unlock", "Build the Stew Pot and the Kitchen
 *  Counter to unlock", or null when the seed is open. */
export function seedLockLine(crop: StackAcresCrop, built: ReadonlySet<MachineKind>): string | null {
  const missing = missingForSeed(crop, built);
  if (missing.length === 0) return null;
  const names = missing.map((kind) => `the ${MACHINE_CATALOGUE[kind].label}`).join(" and ");
  return `Build ${names} to unlock`;
}

/** What the server says when a locked seed is asked for. */
export function seedLockedMessage(crop: StackAcresCrop, built: ReadonlySet<MachineKind>): string {
  const line = seedLockLine(crop, built) ?? "";
  return `${STACKACRES_CATALOGUE[crop].label} seed is locked. ${line}.`;
}

/** "Opens Potato, Carrot and Onion seeds", for a building's own card. Null
 *  when the building opens no seeds. Crops that need a second building too
 *  are still listed: this one is part of what opens them. */
export function seedsOpenedLine(kind: MachineKind): string | null {
  const crops = (Object.keys(SEED_UNLOCKS) as StackAcresCrop[]).filter((crop) => SEED_UNLOCKS[crop].includes(kind));
  if (crops.length === 0) return null;
  const labels = crops.map((crop) => STACKACRES_CATALOGUE[crop].label);
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Opens ${list} seeds`;
}
