/**
 * A player's held stock of processing-track items -- what a wheat plot's
 * harvest and a Mill's output actually sit as, between one action and the
 * next.
 *
 * Pure derivation and pure arithmetic only, same posture as ./units.ts:
 * nothing here reads a clock or moves a row. The server (see
 * lib/server/stackacres-store.ts's `adjustStackAcresInventory`) is the only
 * place a quantity is actually written, through a row-locking RPC, never a
 * plain read-then-write -- the same rule `creditGold`/`spendGold` already
 * follow for the purse.
 */

import type { MachineItemId } from "./machine-items";

export type StackAcresInventory = Partial<Record<MachineItemId, number>>;

/** An empty inventory. A missing key and an explicit 0 mean the same thing
 *  everywhere this is read, so a fresh player and a spent-down one look
 *  identical. */
export function emptyInventory(): StackAcresInventory {
  return {};
}

export function inventoryQuantity(inventory: StackAcresInventory, item: MachineItemId): number {
  return inventory[item] ?? 0;
}

export function hasEnough(
  inventory: StackAcresInventory,
  item: MachineItemId,
  quantity: number,
): boolean {
  return inventoryQuantity(inventory, item) >= quantity;
}

/** A new inventory with `quantity` more of `item`. `quantity` must be
 *  positive -- this is a credit, not a general setter, so a caller reaching
 *  for a negative delta almost certainly wants `removeFromInventory` instead. */
export function addToInventory(
  inventory: StackAcresInventory,
  item: MachineItemId,
  quantity: number,
): StackAcresInventory {
  if (quantity <= 0) return inventory;
  return { ...inventory, [item]: inventoryQuantity(inventory, item) + quantity };
}

/**
 * A new inventory with `quantity` less of `item`, or null when there is not
 * enough -- the same "null means refuse, never go negative" contract
 * `adjustStackAcresFeed` already carries. A caller treats null exactly like a
 * lost race: nothing changed, spend nothing else.
 */
export function removeFromInventory(
  inventory: StackAcresInventory,
  item: MachineItemId,
  quantity: number,
): StackAcresInventory | null {
  if (quantity <= 0) return inventory;
  const held = inventoryQuantity(inventory, item);
  if (held < quantity) return null;
  return { ...inventory, [item]: held - quantity };
}
