/**
 * The processing track: raw materials a machine eats, and the goods it makes.
 *
 * DELIBERATELY A SEPARATE ITEM SPACE FROM ./items.ts. `STACKACRES_ITEMS`
 * (carrot, corn, eggs, wool, milk) are valued and paid in Gold the instant
 * they are harvested -- see items.ts's own header for why that collapsed from
 * a three-step Bushel economy to one atomic step, and exchange.ts for the
 * flat daily ceiling that makes it safe. Nothing here touches that: wheat and
 * flour never carry a Gold value of their own and are never sw wept into
 * `harvestStackAcres`. They sit in an inventory instead (./inventory.ts) and
 * the only door back to Gold is a fulfilled Contract (./contracts.ts), which
 * reserves against the exact same ceiling a harvest does. Neither is ever
 * swept into `harvestStackAcres`.
 *
 * That is also why wheat is not a `StackAcresStock` (./catalogue.ts). A
 * `homestead_units` row is guaranteed to be swept into a harvest's Gold
 * payout the moment it is ready -- `harvestStackAcres` treats every ready row
 * uniformly, and there is no "this one does not pay" branch to give it.
 * Growing wheat needed its own row, its own table, its own ready/collect
 * pair -- see ./wheat-plot.ts -- specifically so it could not be reached by
 * that sweep.
 */

export const MACHINE_RAW_ITEMS = ["wheat"] as const;
export const MACHINE_PROCESSED_ITEMS = ["flour"] as const;

export type MachineRawItem = (typeof MACHINE_RAW_ITEMS)[number];
export type MachineProcessedItem = (typeof MACHINE_PROCESSED_ITEMS)[number];
export type MachineItemId = MachineRawItem | MachineProcessedItem;

export const MACHINE_ITEM_IDS: readonly MachineItemId[] = [
  ...MACHINE_RAW_ITEMS,
  ...MACHINE_PROCESSED_ITEMS,
];

export function isMachineRawItem(value: string): value is MachineRawItem {
  return (MACHINE_RAW_ITEMS as readonly string[]).includes(value);
}

export function isMachineProcessedItem(value: string): value is MachineProcessedItem {
  return (MACHINE_PROCESSED_ITEMS as readonly string[]).includes(value);
}

export function isMachineItem(value: string): value is MachineItemId {
  return (MACHINE_ITEM_IDS as readonly string[]).includes(value);
}

export interface MachineItemDef {
  label: string;
  plural: string;
  /** Name of a vector painter in stackacres-art.ts, same convention as
   *  StackAcresItemDef.icon in ./items.ts -- kept a plain string so this file
   *  stays free of a components/ import. */
  icon: string;
}

export const MACHINE_ITEM_CATALOGUE: Readonly<Record<MachineItemId, MachineItemDef>> = {
  wheat: { label: "Wheat", plural: "Wheat", icon: "ico-wheat" },
  flour: { label: "Flour", plural: "Flour", icon: "ico-flour" },
};

/** "3 Wheat", "1 Flour" -- same pluralisation contract as items.ts's own
 *  `itemLabel`. */
export function machineItemLabel(item: MachineItemId, quantity: number): string {
  const def = MACHINE_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}
