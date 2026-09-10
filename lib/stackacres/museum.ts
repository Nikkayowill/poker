/**
 * Ray's Museum: the long-term collection hook behind the barn door.
 *
 * Every produce item StackAcres yields (see ./items.ts) belongs to exactly
 * one thematic exhibit here. Donating one is not a player decision -- there
 * is no "bring it to Ray" action -- it happens automatically, once, the
 * first time that item is ever collected off a unit (see
 * lib/server/stackacres-service.ts's collectStackAcres). What this module
 * owns is purely the SHAPE of the collection: which exhibit an item sits in,
 * and how big the one-time "New Discovery!" bonus is.
 *
 * PAID IN BONUS INVENTORY NOW, NOT GOLD. A harvest never pays Gold at all any
 * more -- see lib/server/stackacres-service.ts's own header -- so a
 * first-ever discovery folds bonus UNITS of the same item into the same
 * inventory credit the sweep already makes, rather than a second Gold path.
 * Half again as many units, the same rate the old Gold bonus used.
 */

import { STACKACRES_ITEMS, type StackAcresItem } from "./items";

export const MUSEUM_EXHIBITS = ["rays-choice-crops", "exotic-livestock-wonders", "bountiful-forage"] as const;

export type MuseumExhibitId = (typeof MUSEUM_EXHIBITS)[number];

export interface MuseumExhibitDef {
  label: string;
  /** The honest one-line pitch, the way a district's own `blurb` reads. */
  blurb: string;
  items: readonly StackAcresItem[];
}

/**
 * Every item sits in exactly one exhibit -- museum.test.ts holds that, the
 * same way world.test.ts holds the four districts' grow areas apart. Grouped
 * by what the item actually IS rather than split evenly: all 22 crops, two
 * livestock byproducts that keep (fleece, milk), and eggs on their own --
 * "forage" is honest for a coop's own yard the way it would not be for a
 * planted row.
 */
export const MUSEUM_EXHIBIT_CATALOGUE: Readonly<Record<MuseumExhibitId, MuseumExhibitDef>> = {
  "rays-choice-crops": {
    label: "Ray's Choice Crops",
    blurb: "What the Long Meadow grows.",
    items: [
      "garlic",
      "onion",
      "beet",
      "poppy",
      "potato",
      "carrot",
      "cabbage",
      "cucumber",
      "pepper",
      "brokoly",
      "sunflower",
      "sunflowe_broken",
      "wheat1",
      "tomato",
      "corn",
      "corn2",
      "eggplant",
      "grap",
      "grap2",
      "pumpkin",
      "wheat2",
      "artichoke",
    ],
  },
  "exotic-livestock-wonders": {
    label: "Exotic Livestock Wonders",
    blurb: "What the Wallow and Ox Fields keep.",
    items: ["wool", "milk"],
  },
  "bountiful-forage": {
    label: "Bountiful Forage",
    blurb: "What the Farmstead's own coop turns up.",
    items: ["eggs"],
  },
};

const EXHIBIT_BY_ITEM: Readonly<Record<StackAcresItem, MuseumExhibitId>> = (() => {
  const out = {} as Record<StackAcresItem, MuseumExhibitId>;
  for (const exhibitId of MUSEUM_EXHIBITS) {
    for (const item of MUSEUM_EXHIBIT_CATALOGUE[exhibitId].items) out[item] = exhibitId;
  }
  return out;
})();

/** Which exhibit an item belongs to. Total over `StackAcresItem` -- every
 *  item is placed, so this never falls back to a default. */
export function exhibitForItem(item: StackAcresItem): MuseumExhibitId {
  return EXHIBIT_BY_ITEM[item];
}

export function isMuseumExhibit(value: string): value is MuseumExhibitId {
  return (MUSEUM_EXHIBITS as readonly string[]).includes(value);
}

/** Every donation flag for a player, keyed by item. What the store returns;
 *  what the museum modal renders directly. */
export type MuseumRegistry = Readonly<Record<StackAcresItem, boolean>>;

/** A fresh player's registry: nothing donated yet. */
export function emptyMuseumRegistry(): MuseumRegistry {
  const out = {} as Record<StackAcresItem, boolean>;
  for (const item of STACKACRES_ITEMS) out[item] = false;
  return out;
}

/**
 * The "New Discovery!" bonus for a first-time donation: extra UNITS of the
 * same item, folded into the same inventory credit a harvest already makes.
 *
 * Half again as many as the sweep actually brought home -- a real bonus, and
 * the exact rate the old Gold-denominated bonus paid, just in kind now that a
 * harvest has no Gold value to pay it out of. Applies once per item per
 * player, ever; a duplicate harvest earns nothing extra (see
 * harvestStackAcres -- the registry write is the guard). `quantity` is the
 * item's total across the whole sweep, not one unit's -- a sweep can bring
 * several units of the same freshly-discovered item home together, and the
 * bonus is sized on all of it, once.
 */
export const MUSEUM_DISCOVERY_BONUS_RATE = 0.5;

export function museumDiscoveryBonusQuantity(quantity: number): number {
  return Math.round(quantity * MUSEUM_DISCOVERY_BONUS_RATE);
}
