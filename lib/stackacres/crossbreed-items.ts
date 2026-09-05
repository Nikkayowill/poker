/**
 * The crossbreed track: rare byproducts a Crossbreeding Bed yields when two
 * adjacent, ripe rows mutate into each other at harvest.
 *
 * A DELIBERATELY SEPARATE ITEM SPACE, same posture as ./machine-items.ts's
 * own header: nothing here is Gold-valued directly and nothing here is ever
 * swept by `harvestStackAcres` (./machine-items.ts's sweep only ever sees
 * `homestead_units`; a Crossbreeding Bed is its own table -- see
 * ./crossbreeding.ts). The only door a hybrid item has back to Gold, if one
 * is ever built, would be a Town Contract, the same rule wheat/flour/cheese/
 * cloth already follow.
 *
 * Every hybrid is bred from exactly one unordered pair of real
 * `StackAcresStock` kinds (./catalogue.ts) -- see CROSSBREED_MATRIX in
 * ./crossbreeding.ts for which pairs. There is no crop or animal in this
 * catalogue that is not one of StackAcres' own five: this file invents new
 * PRODUCE, never a new thing to plant.
 */

export const CROSSBREED_ITEMS = [
  "golden_maize",
  "sunroot_egg",
  "candied_husk",
  "marbled_down",
  "tallow_wool",
  "custard_curd",
] as const;

export type CrossbreedItem = (typeof CROSSBREED_ITEMS)[number];

export function isCrossbreedItem(value: string): value is CrossbreedItem {
  return (CROSSBREED_ITEMS as readonly string[]).includes(value);
}

export interface CrossbreedItemDef {
  label: string;
  plural: string;
  /** Name of a vector painter in stackacres-art.ts, same convention
   *  StackAcresItemDef.icon (./items.ts) and MachineItemDef.icon
   *  (./machine-items.ts) both use -- kept a plain string so this file stays
   *  free of a components/ import. Not yet baked; a hybrid's own painter is
   *  art, not logic, and is out of scope here. */
  icon: string;
}

export const CROSSBREED_ITEM_CATALOGUE: Readonly<Record<CrossbreedItem, CrossbreedItemDef>> = {
  golden_maize: { label: "Golden Maize", plural: "Golden Maize", icon: "ico-golden-maize" },
  sunroot_egg: { label: "Sunroot Egg", plural: "Sunroot Eggs", icon: "ico-sunroot-egg" },
  candied_husk: { label: "Candied Husk", plural: "Candied Husks", icon: "ico-candied-husk" },
  marbled_down: { label: "Marbled Down", plural: "Marbled Down", icon: "ico-marbled-down" },
  tallow_wool: { label: "Tallow Wool", plural: "Tallow Wool", icon: "ico-tallow-wool" },
  custard_curd: { label: "Custard Curd", plural: "Custard Curds", icon: "ico-custard-curd" },
};

/** "3 Golden Maize", "1 Sunroot Egg" -- same pluralisation contract every
 *  other item catalogue in StackAcres uses. */
export function crossbreedItemLabel(item: CrossbreedItem, quantity: number): string {
  const def = CROSSBREED_ITEM_CATALOGUE[item];
  return `${quantity.toLocaleString()} ${quantity === 1 ? def.label : def.plural}`;
}
