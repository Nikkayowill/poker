/**
 * What a machine costs to build, and where the player gets each part of it.
 *
 * The build buttons used to show the Gold price alone, so a Mill read "Build ·
 * 200 Gold" and then failed on its 15 Wood. Everything a placement spends is
 * worked out here once, so the button, the disabled state and the chapter
 * card cannot drift apart.
 *
 * Pure derivation, no clock and no rows: the server still decides every
 * placement (`placeStackAcresMachine`).
 */

import { inventoryQuantity, type StackAcresInventory } from "./inventory";
import { MACHINE_CATALOGUE, type MachineKind } from "./machines";
import { machineItemNoun, type MachineItemId } from "./machine-items";

/** Where a machine is built. The Mill and the Feed Silo go up in the
 *  Workshop, the Oven and the Cellar in the player's own kitchen, and a
 *  player standing in the wrong building has no way to guess which. */
export type BuildPlace = "Workshop" | "House";

const PLACE: Record<MachineKind, BuildPlace> = {
  mill: "Workshop",
  dairy: "Workshop",
  loom: "Workshop",
  vat: "Workshop",
  feed_silo: "Workshop",
  oven: "House",
  stew_pot: "House",
  counter: "House",
  cellar: "House",
  farm_kitchen: "House",
};

/** Where a material comes from, in the words a player can act on. Gold has no
 *  entry: a player always knows where Gold comes from. */
const SOURCE: Partial<Record<MachineItemId, string>> = {
  wood: "Chop the trees around the farm",
  stone: "Mine the boulders in the Mine",
};

export interface BuildLine {
  /** "Gold", "Wood", "Stone". Already singular or plural to match `need`. */
  label: string;
  have: number;
  need: number;
  met: boolean;
  /** Where to get more, when this line is short. Null for Gold. */
  source: string | null;
}

export interface BuildCost {
  kind: MachineKind;
  name: string;
  place: BuildPlace;
  /** Gold first, then materials in catalogue order. */
  lines: BuildLine[];
  affordable: boolean;
}

export function buildCost(
  kind: MachineKind,
  gold: number,
  inventory: StackAcresInventory,
): BuildCost {
  const def = MACHINE_CATALOGUE[kind];
  const lines: BuildLine[] = [
    { label: "Gold", have: gold, need: def.placeCost, met: gold >= def.placeCost, source: null },
  ];
  for (const material of def.materials ?? []) {
    const have = inventoryQuantity(inventory, material.item);
    lines.push({
      label: machineItemNoun(material.item, material.quantity),
      have,
      need: material.quantity,
      met: have >= material.quantity,
      source: SOURCE[material.item] ?? null,
    });
  }
  return { kind, name: def.label, place: PLACE[kind], lines, affordable: lines.every((line) => line.met) };
}

export function buildPlace(kind: MachineKind): BuildPlace {
  return PLACE[kind];
}

/** Everything the build spends, short or not: "200 Gold + 15 Wood". */
export function costSummary(cost: BuildCost): string {
  return cost.lines.map((line) => `${line.need.toLocaleString()} ${line.label}`).join(" + ");
}

/** The lines still short, worst first, so a button can lead with the real
 *  blocker rather than the first thing in the list. */
export function shortLines(cost: BuildCost): BuildLine[] {
  return cost.lines
    .filter((line) => !line.met)
    .sort((a, b) => a.have / a.need - b.have / b.need);
}

/** One sentence saying what is missing and where to get it, or null when the
 *  player can build it now. */
export function buildShortfall(cost: BuildCost): string | null {
  const short = shortLines(cost);
  if (short.length === 0) return null;
  const parts = short.map((line) => `${(line.need - line.have).toLocaleString()} more ${line.label}`);
  const needed =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const source = short.find((line) => line.source)?.source;
  return source ? `You need ${needed}. ${source}.` : `You need ${needed}.`;
}
