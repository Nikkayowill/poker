/**
 * Each traveler's line: an ordered list of quests, each a short list of
 * objectives. A line is optional from the first tap to the last. Nothing
 * on the farm waits on it.
 *
 * Three shapes of objective, and the split matters for who checks what:
 *
 *   counters   tick off ./events.ts events after the player accepts. The
 *              server advances them inside the action that caused the
 *              event; the client replays the same event locally so the
 *              number moves before the round trip lands.
 *   deliver    read the inventory at turn-in and debit it then. Same
 *              posture as give-gift: refused before anything is touched.
 *   hold-tool  read the equipment rung at turn-in. Permanent, so a player
 *              who already holds it is never asked to earn it twice.
 *
 * Every crop, item, recipe and tool named here is a real catalogue id.
 * quests.test.ts holds that.
 */

import { STACKACRES_CATALOGUE, isLivestock, isStackAcresCrop, type StackAcresCrop } from "../catalogue";
import { STACKACRES_TOOL_TIERS, STACKACRES_TOOL_TIER_DEFS, type StackAcresToolTier } from "../equipment";
import { machineItemLabel, type MachineItemId } from "../machine-items";
import type { RecipeId } from "../recipes";
import type { StoryEvent } from "./events";
import type { TravelerId } from "./travelers";

export type StoryObjective =
  | { readonly kind: "harvest"; readonly crops: readonly StackAcresCrop[]; readonly target: number }
  | { readonly kind: "harvest-any-crop"; readonly target: number }
  | { readonly kind: "collect-livestock"; readonly target: number }
  | { readonly kind: "water"; readonly target: number }
  | { readonly kind: "feed"; readonly target: number }
  | { readonly kind: "buy-feed"; readonly target: number }
  | { readonly kind: "process"; readonly recipe: RecipeId; readonly target: number }
  | { readonly kind: "fish"; readonly target: number }
  | { readonly kind: "secret-zones"; readonly target: number }
  | { readonly kind: "clear-sector"; readonly target: number }
  | { readonly kind: "pipes"; readonly target: number }
  | { readonly kind: "soil"; readonly target: number }
  | { readonly kind: "contracts"; readonly target: number }
  | { readonly kind: "forge"; readonly target: number }
  | { readonly kind: "crossbreed"; readonly target: number }
  | { readonly kind: "deliver"; readonly item: MachineItemId; readonly target: number }
  | { readonly kind: "hold-tool"; readonly tool: StackAcresToolTier; readonly target: 1 };

export type StoryObjectiveKind = StoryObjective["kind"];

/** Objectives the event stream advances. The other two are read at turn-in. */
export function isCounterObjective(objective: StoryObjective): boolean {
  return objective.kind !== "deliver" && objective.kind !== "hold-tool";
}

/** How far one event moves one objective. Zero for an unrelated pair. */
export function objectiveAdvance(objective: StoryObjective, event: StoryEvent): number {
  switch (objective.kind) {
    case "harvest":
      return event.kind === "harvested" && objective.crops.includes(event.stock as StackAcresCrop) ? event.count : 0;
    case "harvest-any-crop":
      return event.kind === "harvested" && isStackAcresCrop(event.stock) ? event.count : 0;
    case "collect-livestock":
      return event.kind === "harvested" && isLivestock(event.stock) ? event.count : 0;
    case "water":
      return event.kind === "watered" ? event.count : 0;
    case "feed":
      return event.kind === "fed" ? event.count : 0;
    case "buy-feed":
      return event.kind === "feed-bought" ? event.servings : 0;
    case "process":
      return event.kind === "processed" && event.recipe === objective.recipe ? event.count : 0;
    case "fish":
      return event.kind === "fish-caught" ? 1 : 0;
    case "secret-zones":
      return event.kind === "secret-zone-tapped" ? 1 : 0;
    case "clear-sector":
      return event.kind === "sector-cleared" ? 1 : 0;
    case "pipes":
      return event.kind === "pipe-placed" ? 1 : 0;
    case "soil":
      return event.kind === "soil-placed" ? event.count : 0;
    case "contracts":
      return event.kind === "contract-fulfilled" ? 1 : 0;
    case "forge":
      return event.kind === "enchantment-forged" ? 1 : 0;
    case "crossbreed":
      return event.kind === "crossbreed-harvested" ? 1 : 0;
    case "deliver":
    case "hold-tool":
      return 0;
  }
}

/** Whether `held` is `wanted` or a better rung. Rungs are ladder order. */
export function toolMeets(held: StackAcresToolTier, wanted: StackAcresToolTier): boolean {
  return STACKACRES_TOOL_TIERS.indexOf(held) >= STACKACRES_TOOL_TIERS.indexOf(wanted);
}

function cropList(crops: readonly StackAcresCrop[]): string {
  const labels = crops.map((crop) => STACKACRES_CATALOGUE[crop].label.toLowerCase());
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** One line per objective, imperative, no trailing full stop. */
export function objectiveLabel(objective: StoryObjective): string {
  switch (objective.kind) {
    case "harvest":
      return `Harvest ${objective.target} ${cropList(objective.crops)}`;
    case "harvest-any-crop":
      return `Harvest ${objective.target} crops`;
    case "collect-livestock":
      return `Collect from your animals ${objective.target} times`;
    case "water":
      return `Water ${objective.target} crops`;
    case "feed":
      return `Feed your animals ${objective.target} times`;
    case "buy-feed":
      return `Buy ${objective.target} servings of feed`;
    case "process":
      return `Make ${machineItemLabel(objective.recipe, objective.target)} in the Workshop`;
    case "fish":
      return `Catch ${objective.target} fish`;
    case "secret-zones":
      return `Find ${objective.target} hidden spots on the farm`;
    case "clear-sector":
      return objective.target === 1 ? "Clear a district of wild growth" : `Clear ${objective.target} districts of wild growth`;
    case "pipes":
      return `Lay ${objective.target} irrigation tiles`;
    case "soil":
      return `Lay ${objective.target} soil beds`;
    case "contracts":
      return objective.target === 1 ? "Fill an order for the town" : `Fill ${objective.target} orders for the town`;
    case "forge":
      return objective.target === 1 ? "Forge an enchantment" : `Forge ${objective.target} enchantments`;
    case "crossbreed":
      return `Harvest ${objective.target} from the Crossbreeding Bed`;
    case "deliver":
      return `Bring ${machineItemLabel(objective.item, objective.target)}`;
    case "hold-tool":
      return `Own the ${STACKACRES_TOOL_TIER_DEFS[objective.tool].label}`;
  }
}

export interface StoryQuest {
  /** Stable, `<traveler>.q<n>`. Dialogue node ids hang off it. */
  readonly id: string;
  readonly title: string;
  readonly objectives: readonly StoryObjective[];
  /** The affirmative button on the turn-in bubble. */
  readonly turnInLabel: string;
}

export const TRAVELER_QUESTS: Readonly<Record<TravelerId, readonly StoryQuest[]>> = {
  ray: [
    {
      id: "ray.q1",
      title: "First Furrows",
      objectives: [
        { kind: "soil", target: 3 },
        { kind: "water", target: 5 },
      ],
      turnInLabel: "Show him the beds",
    },
    {
      id: "ray.q2",
      title: "A Full Basket",
      objectives: [{ kind: "harvest-any-crop", target: 10 }],
      turnInLabel: "Show him the harvest",
    },
    {
      id: "ray.q3",
      title: "Clearing the Debris",
      objectives: [{ kind: "clear-sector", target: 1 }],
      turnInLabel: "Walk the cleared land",
    },
  ],
  pierre: [
    {
      id: "pierre.q1",
      title: "Real Ingredients",
      objectives: [
        { kind: "deliver", item: "potato", target: 5 },
        { kind: "deliver", item: "carrot", target: 5 },
      ],
      turnInLabel: "Hand over the vegetables",
    },
    {
      id: "pierre.q2",
      title: "The Glitched Recipe",
      objectives: [{ kind: "process", recipe: "cake", target: 1 }],
      turnInLabel: "Present the cake",
    },
  ],
  miles: [
    {
      id: "miles.q1",
      title: "Scene of the Anomaly",
      objectives: [{ kind: "secret-zones", target: 3 }],
      turnInLabel: "Report what you found",
    },
    {
      id: "miles.q2",
      title: "Heavy Evidence",
      objectives: [{ kind: "clear-sector", target: 1 }],
      turnInLabel: "Show him the cleared ground",
    },
  ],
  skye: [
    {
      id: "skye.q1",
      title: "Organic Pigment",
      objectives: [
        { kind: "deliver", item: "beet", target: 6 },
        { kind: "deliver", item: "poppy", target: 6 },
      ],
      turnInLabel: "Hand over the dye crops",
    },
    {
      id: "skye.q2",
      title: "Canvas",
      objectives: [{ kind: "process", recipe: "cloth", target: 2 }],
      turnInLabel: "Bring the cloth",
    },
  ],
  barnaby: [
    {
      id: "barnaby.q1",
      title: "Sounding the Depths",
      objectives: [{ kind: "fish", target: 3 }],
      turnInLabel: "Show him the catch",
    },
    {
      id: "barnaby.q2",
      title: "Pressure Lines",
      objectives: [{ kind: "pipes", target: 4 }],
      turnInLabel: "Show him the pipework",
    },
  ],
  arthur: [
    {
      id: "arthur.q1",
      title: "Provisions for the Garrison",
      objectives: [{ kind: "deliver", item: "wheat", target: 10 }],
      turnInLabel: "Deliver the grain",
    },
    {
      id: "arthur.q2",
      title: "The Town's Trust",
      objectives: [{ kind: "contracts", target: 2 }],
      turnInLabel: "Report to the knight",
    },
  ],
  brayden: [
    {
      id: "brayden.q1",
      title: "Iron Tools",
      objectives: [{ kind: "hold-tool", tool: "iron-shovel", target: 1 }],
      turnInLabel: "Show him the shovel",
    },
    {
      id: "brayden.q2",
      title: "A Better Edge",
      objectives: [{ kind: "forge", target: 1 }],
      turnInLabel: "Show him the enchantment",
    },
  ],
  ivy: [
    {
      id: "ivy.q1",
      title: "First Cross",
      objectives: [{ kind: "crossbreed", target: 1 }],
      turnInLabel: "Show her the hybrid",
    },
    {
      id: "ivy.q2",
      title: "Maritime Strains",
      objectives: [{ kind: "crossbreed", target: 3 }],
      turnInLabel: "Show her the results",
    },
  ],
  wes: [
    {
      id: "wes.q1",
      title: "Hay in the Loft",
      objectives: [
        { kind: "buy-feed", target: 12 },
        { kind: "feed", target: 6 },
      ],
      turnInLabel: "Show him the stocked barn",
    },
    {
      id: "wes.q2",
      title: "Working Stock",
      objectives: [{ kind: "collect-livestock", target: 8 }],
      turnInLabel: "Show him the yield",
    },
  ],
  bea: [
    {
      id: "bea.q1",
      title: "Fields of Flowers",
      objectives: [{ kind: "harvest", crops: ["poppy", "sunflower"], target: 16 }],
      turnInLabel: "Show her the blooms",
    },
    {
      id: "bea.q2",
      title: "Keep Them Wet",
      objectives: [{ kind: "water", target: 20 }],
      turnInLabel: "Tell her the fields are wet",
    },
  ],
  leo: [
    {
      id: "leo.q1",
      title: "Beacon Components",
      objectives: [
        { kind: "deliver", item: "flour", target: 5 },
        { kind: "deliver", item: "cheese", target: 5 },
        { kind: "deliver", item: "cloth", target: 5 },
      ],
      turnInLabel: "Hand over the components",
    },
    {
      id: "leo.q2",
      title: "Light the Beacon",
      objectives: [
        { kind: "pipes", target: 6 },
        { kind: "forge", target: 1 },
      ],
      turnInLabel: "Light it",
    },
  ],
};

/** Every quest, flat, for tests and the dialogue table. */
export const ALL_STORY_QUESTS: readonly StoryQuest[] = Object.values(TRAVELER_QUESTS).flat();
