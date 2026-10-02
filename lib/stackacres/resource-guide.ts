/**
 * The Resource Guide: for any item the player can hold, what it is, what
 * uses it and where to get more.
 *
 * Every use and every source is read off the catalogues that already run the
 * farm (recipes, machines, axe, contracts, blueprints, gifts, quests, the
 * crossbreed matrix), so the guide cannot disagree with the game. Only the
 * one-line descriptions and the "is this source open" facts are written here.
 */

import { STACKACRES_LIVESTOCK, isLivestock, type StackAcresStock } from "./catalogue";
import { AXE_LEVELS, AXE_LEVEL_DEFS } from "./axe";
import { CELLAR_ITEMS, VAT_INPUT_ITEM } from "./aging";
import { MYTHIC_BLUEPRINTS, MYTHIC_BLUEPRINT_IDS } from "./blueprints";
import { CONTRACT_RUNGS } from "./contracts";
import { CROSSBREED_MATRIX } from "./crossbreeding";
import {
  CROSSBREED_ITEMS,
  CROSSBREED_ITEM_CATALOGUE,
  type CrossbreedItem,
} from "./crossbreed-items";
import { FOOD_ENERGY, isFoodItem } from "./energy";
import { EMPIRE_BUILDINGS, EMPIRE_BUILDING_KINDS } from "./empire-buildings";
import { SHELF_FEED_ORDERS } from "./feeding";
import { FISHING_BAIT_ITEM, FISH_SPECIES } from "./fishing";
import { GIFTABLE_ITEMS, NPC_GIFT_CATALOGUE, FRIENDSHIP_NPCS } from "./friendship";
import { STACKACRES_YIELDS, STACKACRES_ITEMS } from "./items";
import { MACHINE_CATALOGUE, MACHINE_KINDS, type MachineKind } from "./machines";
import {
  ALL_MACHINE_ITEM_IDS,
  MACHINE_ITEM_CATALOGUE,
  machineItemIcon,
  machineItemNoun,
  machineItemSellPrice,
  type MachineItemId,
} from "./machine-items";
import { RECIPE_CATALOGUE, RECIPE_IDS, type RecipeId } from "./recipes";
import { SOIL_ENRICH_USE_LABEL, isSoilEnrichingItem } from "./soil-enrich";
import { TRAVELER_QUESTS, questFlatObjectives } from "./story/quests";
import { TRAVELER_IDS } from "./story/travelers";
import { HOME_SECTORS } from "./sectors";
import { stockZone } from "./world";

/** Anything the guide can describe: the shared inventory plus the six hybrids. */
export type GuideItemId = MachineItemId | CrossbreedItem;

// ALL_MACHINE_ITEM_IDS lists wheat twice (it is both a crop and a machine input).
export const GUIDE_ITEM_IDS: readonly GuideItemId[] = [...new Set<GuideItemId>([...ALL_MACHINE_ITEM_IDS, ...CROSSBREED_ITEMS])];

export function isCrossbreedGuideItem(item: GuideItemId): item is CrossbreedItem {
  return (CROSSBREED_ITEMS as readonly string[]).includes(item);
}

/** A screen the guide can send the player to. The farm maps each to its own opener. */
export type GuideDestinationId = "workshop" | "house" | "contracts" | "store-sell" | "crossbreed";

export const GUIDE_DESTINATION_LABELS: Readonly<Record<GuideDestinationId, string>> = {
  workshop: "Open the Workshop",
  house: "Open the kitchen",
  contracts: "Open the Town Board",
  "store-sell": "Open the barn shelf",
  crossbreed: "Open the Crossbreeding Bed",
};

export type ResourceUseKind =
  | "recipe"
  | "build"
  | "axe"
  | "empire"
  | "blueprint"
  | "contract"
  | "vat"
  | "cellar"
  | "eat"
  | "quest"
  | "gift"
  | "feed"
  | "bait"
  | "soil"
  | "collection"
  | "sell";

/** Kinds that spend the item as a cost someone has to pay before something else happens. */
const GATING_KINDS: readonly ResourceUseKind[] = ["recipe", "build", "axe", "empire", "blueprint", "contract", "vat", "quest"];

export interface ResourceUse {
  kind: ResourceUseKind;
  label: string;
  /** Short second line, e.g. how many it takes. */
  detail?: string;
  destination?: GuideDestinationId;
  /** The machine behind a recipe or build, for the unlock check. */
  machine?: MachineKind;
  /** The recipe behind a recipe use, for the unlock check. */
  recipe?: RecipeId;
}

export function isGatingUse(use: ResourceUse): boolean {
  return GATING_KINDS.includes(use.kind);
}

export interface ResourceSource {
  label: string;
  /** False while the player has no way to do it on the live farm. */
  open: boolean;
  /** Why it is not open, in a sentence the guide can show. */
  note?: string;
  destination?: GuideDestinationId;
  /** The recipe behind a crafted source. */
  recipe?: RecipeId;
}

export interface ResourceGuideEntry {
  item: GuideItemId;
  label: string;
  plural: string;
  icon: string;
  description: string;
  /** Gold one sells for, or null for a hybrid, which cannot be sold. */
  sellPrice: number | null;
  uses: ResourceUse[];
  sources: ResourceSource[];
}

/* ------------------------------------------------------------------ */
/* Descriptions                                                        */
/* ------------------------------------------------------------------ */

const DESCRIPTIONS: Readonly<Record<GuideItemId, string>> = {
  eggs: "Laid by your hens.",
  wool: "Fleece from your sheep.",
  milk: "Fresh milk from your cattle.",
  lettuce: "A fast-growing leafy green.",
  spinach: "A fast-growing leafy green.",
  radish: "A fast-growing root.",
  onion: "A fast-growing root.",
  carrot: "A fast-growing root.",
  potato: "A fast-growing root.",
  cabbage: "A fast-growing head of cabbage.",
  broccoli: "A mid-tier crop that takes a while to grow.",
  pepper: "A hot pepper. Not the same crop as the bell pepper.",
  bell_pepper: "A sweet bell pepper.",
  celery: "A crunchy mid-tier crop.",
  green_bean: "A mid-tier bean crop.",
  tomato: "A mid-tier tomato crop.",
  corn: "A slow, valuable crop.",
  eggplant: "A slow, valuable crop.",
  wheat: "The farm's grain crop.",
  bluegill: "The common catch from the Homestead lake.",
  trout: "A fair catch from the Homestead lake.",
  catfish: "The rare catch from the Homestead lake.",
  meat: "Field Notes written up from a sighting in the brush.",
  pelt: "A Trail Photo taken on a sighting in the brush.",
  wood: "Chopped from the trees on the Homestead.",
  stone: "Broken out of boulders.",
  iron_ore: "Broken out of boulders alongside the stone.",
  flour: "Ground from wheat at the Mill.",
  cheese: "Made from milk at the Dairy.",
  cloth: "Woven from wool at the Loom.",
  cake: "Baked from eggs, milk and flour.",
  bread: "Baked from flour in the kitchen oven.",
  stew: "Cooked from garden crops in the kitchen.",
  salad: "Tossed from greens at the kitchen counter.",
  cattle_feed: "Milled from corn for the cattle.",
  sauce: "Tomato sauce from the town kitchen.",
  salsa: "Hot salsa from the town kitchen.",
  stuffed_peppers: "A big dish from the town kitchen.",
  pickles: "Jarred pickles from the town kitchen.",
  sauerkraut: "Jarred sauerkraut from the town kitchen.",
  bean_casserole: "A baked dish from the town kitchen.",
  harvest_feast: "The biggest dish in the kitchen.",
  metal: "Smelted from iron ore.",
  golden_maize: "A rare hybrid bred from corn and wheat.",
  sunroot_egg: "A rare hybrid bred from a hen and wheat.",
  candied_husk: "A rare hybrid bred from carrot and potato.",
  marbled_down: "A rare hybrid bred from a hen and a pig.",
  tallow_wool: "A rare hybrid bred from a pig and cattle.",
  custard_curd: "A rare hybrid bred from cattle and a hen.",
};

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * Raw gathering that has no catalogue to read from. `open` is checked
 * against the map files by resource-guide.test.ts, so it cannot go stale:
 * the day a boulder or a thicket lands on a map the test fails until the
 * flag is flipped.
 */
export const GATHER_SOURCES: Readonly<Record<"fishing" | "hunting" | "wood" | "stone", ResourceSource>> = {
  fishing: { label: "Fish off the dock at the Homestead lake", open: true },
  hunting: {
    label: "Log a sighting in the brush",
    open: false,
    note: "The brush is not on any map yet.",
  },
  wood: { label: "Chop the trees on the Homestead", open: true },
  stone: { label: "Break the boulders in the wild land round the yard", open: true },
};

function isMachineBuildable(kind: MachineKind): boolean {
  return MACHINE_KINDS.includes(kind);
}

function stockIsOpen(stock: StackAcresStock): boolean {
  if (!isLivestock(stock)) return true;
  return (HOME_SECTORS as readonly string[]).includes(stockZone(stock));
}

const STOCK_LABELS: Readonly<Record<string, string>> = { hen: "hens", pig: "sheep", cattle: "cattle" };

const MACHINE_DESTINATION: Readonly<Record<MachineKind, GuideDestinationId>> = {
  mill: "workshop",
  dairy: "workshop",
  loom: "workshop",
  vat: "workshop",
  smelter: "workshop",
  feed_silo: "workshop",
  barn: "workshop",
  oven: "house",
  stew_pot: "house",
  counter: "house",
  cellar: "house",
  farm_kitchen: "house",
};

/** Whether the player has any way to get `item` right now, following recipes back to their raw inputs. */
export function isObtainable(item: GuideItemId, seen: ReadonlySet<string> = new Set()): boolean {
  if (seen.has(item)) return false;
  const next = new Set(seen).add(item);
  return resourceSources(item).some((source) => {
    if (!source.open) return false;
    if (!source.recipe) return true;
    const recipe = RECIPE_CATALOGUE[source.recipe];
    return isMachineBuildable(recipe.machine) && recipe.inputs.every((input) => isObtainable(input.item, next));
  });
}

export function resourceSources(item: GuideItemId): ResourceSource[] {
  const sources: ResourceSource[] = [];

  if (isCrossbreedGuideItem(item)) {
    for (const entry of CROSSBREED_MATRIX) {
      if (entry.hybrid !== item) continue;
      const open = [entry.a, entry.b].every((stock) => stockIsOpen(stock));
      sources.push({
        label: `Breed ${stockName(entry.a)} beside ${stockName(entry.b)} in the Crossbreeding Bed`,
        open,
        note: open ? undefined : "Needs an animal you cannot keep yet.",
        destination: "crossbreed",
      });
    }
    return sources;
  }

  for (const [stock, produce] of Object.entries(STACKACRES_YIELDS)) {
    if (produce.item !== item) continue;
    const open = stockIsOpen(stock as StackAcresStock);
    const livestock = (STACKACRES_LIVESTOCK as readonly string[]).includes(stock);
    sources.push({
      label: livestock ? `Keep ${STOCK_LABELS[stock] ?? stock}` : `Grow it in a bed`,
      open,
      note: open ? undefined : "The pen for this animal is not open yet.",
    });
  }

  for (const id of RECIPE_IDS) {
    const recipe = RECIPE_CATALOGUE[id];
    if (recipe.output.item !== item) continue;
    sources.push({
      label: `${recipe.label} at the ${MACHINE_CATALOGUE[recipe.machine].label}`,
      open: true,
      destination: MACHINE_DESTINATION[recipe.machine],
      recipe: id,
    });
  }

  if ((FISH_SPECIES as readonly string[]).includes(item)) sources.push(GATHER_SOURCES.fishing);
  if (item === "meat" || item === "pelt") sources.push(GATHER_SOURCES.hunting);
  if (item === "wood") sources.push(GATHER_SOURCES.wood);
  if (item === "stone" || item === "iron_ore") sources.push(GATHER_SOURCES.stone);

  return sources;
}

function stockName(stock: StackAcresStock): string {
  return STOCK_LABELS[stock] ?? stock.replace("_", " ");
}

/* ------------------------------------------------------------------ */
/* Uses                                                                */
/* ------------------------------------------------------------------ */

export function resourceUses(item: GuideItemId): ResourceUse[] {
  const uses: ResourceUse[] = [];

  if (isCrossbreedGuideItem(item)) {
    const total = CROSSBREED_ITEMS.length;
    uses.push({
      kind: "collection",
      label: `Part of your hybrid collection (${total} to find)`,
      detail: "Each kind you breed is logged in the Crossbreeding Bed.",
      destination: "crossbreed",
    });
    return uses;
  }

  for (const id of RECIPE_IDS) {
    const recipe = RECIPE_CATALOGUE[id];
    const input = recipe.inputs.find((entry) => entry.item === item);
    if (!input) continue;
    uses.push({
      kind: "recipe",
      label: `${recipe.label} at the ${MACHINE_CATALOGUE[recipe.machine].label}`,
      detail: `Takes ${input.quantity}`,
      destination: MACHINE_DESTINATION[recipe.machine],
      machine: recipe.machine,
      recipe: id,
    });
  }

  for (const kind of MACHINE_KINDS) {
    const cost = MACHINE_CATALOGUE[kind].materials?.find((entry) => entry.item === item);
    if (!cost) continue;
    uses.push({
      kind: "build",
      label: `Build the ${MACHINE_CATALOGUE[kind].label}`,
      detail: `Takes ${cost.quantity}`,
      destination: MACHINE_DESTINATION[kind],
      machine: kind,
    });
  }

  for (const level of AXE_LEVELS) {
    const cost = AXE_LEVEL_DEFS[level].materials?.find((entry) => entry.item === item);
    if (!cost) continue;
    uses.push({ kind: "axe", label: `Make the ${AXE_LEVEL_DEFS[level].label}`, detail: `Takes ${cost.quantity}`, destination: "workshop" });
  }

  for (const kind of EMPIRE_BUILDING_KINDS) {
    const cost = EMPIRE_BUILDINGS[kind].materials.find((entry) => entry.item === item);
    if (!cost) continue;
    uses.push({ kind: "empire", label: `Raise the ${EMPIRE_BUILDINGS[kind].label} in the Far Field`, detail: `Takes ${cost.quantity}` });
  }

  for (const blueprint of MYTHIC_BLUEPRINT_IDS.map((id) => MYTHIC_BLUEPRINTS[id])) {
    for (const stage of blueprint.stages) {
      const need = stage.requirements.find((entry) => entry.item === item);
      if (!need) continue;
      uses.push({
        kind: "blueprint",
        label: `${blueprint.label}: ${stage.label}`,
        detail: `Takes ${need.quantity}`,
      });
    }
  }

  const rungs = CONTRACT_RUNGS.filter((rung) => rung.item === item);
  if (rungs.length > 0) {
    uses.push({ kind: "contract", label: "Town orders", detail: "The town posts orders for it", destination: "contracts" });
  }

  if (item === VAT_INPUT_ITEM) {
    uses.push({ kind: "vat", label: "Age it in the Fermenting Vat", destination: "workshop", machine: "vat" });
  }

  if ((CELLAR_ITEMS as readonly string[]).includes(item)) {
    uses.push({ kind: "cellar", label: "Age it in the Preserves Cellar", destination: "house", machine: "cellar" });
  }

  if (isFoodItem(item)) {
    uses.push({ kind: "eat", label: `Eat it for ${FOOD_ENERGY[item]} energy`, destination: "house" });
  }

  for (const id of TRAVELER_IDS) {
    for (const quest of TRAVELER_QUESTS[id]) {
      if (questFlatObjectives(quest).some((objective) => objective.kind === "deliver" && objective.item === item)) {
        uses.push({ kind: "quest", label: `Quest: ${quest.title}` });
      }
    }
  }

  if ((GIFTABLE_ITEMS as readonly string[]).includes(item)) {
    const fans = FRIENDSHIP_NPCS.filter((npc) => NPC_GIFT_CATALOGUE[npc].preferences[item as MachineItemId]);
    uses.push({
      kind: "gift",
      label:
        fans.length > 0
          ? `Gift it: ${fans.map((npc) => NPC_GIFT_CATALOGUE[npc].label).join(", ")} like it`
          : "Gift it to a neighbour",
      detail: "Builds friendship",
    });
  }

  for (const { order, noun } of Object.values(SHELF_FEED_ORDERS)) {
    if ((order as readonly string[]).includes(item)) uses.push({ kind: "feed", label: `${noun} feed` });
  }
  if (item === FISHING_BAIT_ITEM) uses.push({ kind: "bait", label: "Fishing bait" });
  if (isSoilEnrichingItem(item)) uses.push({ kind: "soil", label: SOIL_ENRICH_USE_LABEL });

  if ((STACKACRES_ITEMS as readonly string[]).includes(item) || item in MACHINE_ITEM_CATALOGUE) {
    const price = machineItemSellPrice(item as MachineItemId);
    uses.push({ kind: "sell", label: `Sell for ${price.toLocaleString()} Gold each`, destination: "store-sell" });
  }

  return uses;
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export function resourceGuideEntry(item: GuideItemId): ResourceGuideEntry {
  if (isCrossbreedGuideItem(item)) {
    const def = CROSSBREED_ITEM_CATALOGUE[item];
    return {
      item,
      label: def.label,
      plural: def.plural,
      icon: def.icon,
      description: DESCRIPTIONS[item],
      sellPrice: null,
      uses: resourceUses(item),
      sources: resourceSources(item),
    };
  }
  return {
    item,
    label: machineItemNoun(item, 1),
    plural: machineItemNoun(item, 2),
    icon: machineItemIcon(item),
    description: DESCRIPTIONS[item],
    sellPrice: machineItemSellPrice(item),
    uses: resourceUses(item),
    sources: resourceSources(item),
  };
}

/** The uses that are not just "sell it", in the order the guide lists them. */
export function nonSellUses(item: GuideItemId): ResourceUse[] {
  return resourceUses(item).filter((use) => use.kind !== "sell");
}
