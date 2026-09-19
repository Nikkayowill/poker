/**
 * The six farm chapters, worked out from which buildings the player owns.
 * Nothing is stored: a chapter is done when all its buildings are built.
 */

import type { StackAcresInventory } from "./inventory";
import { inventoryQuantity } from "./inventory";
import { MACHINE_CATALOGUE, type MachineKind } from "./machines";

export interface Chapter {
  number: number;
  title: string;
  /** One line on what the chapter is about. */
  blurb: string;
  /** Every one of these has to be built. */
  steps: readonly MachineKind[];
  /** What Ray says when the chapter is finished. */
  doneLine: string;
}

export const CHAPTERS: readonly Chapter[] = [
  {
    number: 1,
    title: "Bread",
    blurb: "Grow wheat, mill it into flour and bake bread.",
    steps: ["mill", "oven"],
    doneLine: "There's your first loaf. Eat bread when your energy runs low and you can fish all afternoon.",
  },
  {
    number: 2,
    title: "Stew",
    blurb: "Cook garden crops into a hearty stew.",
    steps: ["stew_pot"],
    doneLine: "Now that smells like supper. Stew fills you up a lot more than bread does.",
  },
  {
    number: 3,
    title: "Fresh Greens",
    blurb: "Toss greens into salad, and save some for the hens.",
    steps: ["counter"],
    doneLine: "A proper counter at last. Greens make a fine salad, and the hens will thank you for the scraps.",
  },
  {
    number: 4,
    title: "Feed the Herd",
    blurb: "Mill corn into cattle feed and build a silo to feed the animals while you're away.",
    steps: ["feed_silo"],
    doneLine: "The silo will feed the animals when you can't. That's when a farm starts working for you.",
  },
  {
    number: 5,
    title: "Jars and Pickles",
    blurb: "Age jars of pickles and sauerkraut in a stone cellar.",
    steps: ["cellar"],
    doneLine: "Good things take time. Leave the jars down there and they'll be worth more when you open them.",
  },
  {
    number: 6,
    title: "Harvest Feast",
    blurb: "Cook a standing order while you're away, and every batch comes out double.",
    steps: ["farm_kitchen"],
    doneLine: "Now the kitchen works while you sleep. I never had that. Go on, be proud of it.",
  },
];

/** What the player has, for working out how close a building is. */
export interface FarmStock {
  gold: number;
  inventory: StackAcresInventory;
}

/** One thing a building costs, and how much of it the player has. */
export interface Need {
  label: "Gold" | "Wood" | "Stone";
  have: number;
  need: number;
}

export interface StepView {
  kind: MachineKind;
  name: string;
  built: boolean;
  /** Gold first, then materials. */
  needs: Need[];
}

export interface ChapterView {
  chapter: Chapter;
  steps: StepView[];
  done: boolean;
}

const MATERIAL_LABEL = { wood: "Wood", stone: "Stone" } as const;

function stepView(kind: MachineKind, built: ReadonlySet<MachineKind>, stock: FarmStock): StepView {
  const def = MACHINE_CATALOGUE[kind];
  const needs: Need[] = [{ label: "Gold", have: Math.min(stock.gold, def.placeCost), need: def.placeCost }];
  for (const material of def.materials ?? []) {
    const label = MATERIAL_LABEL[material.item as keyof typeof MATERIAL_LABEL];
    if (!label) continue;
    needs.push({ label, have: Math.min(inventoryQuantity(stock.inventory, material.item), material.quantity), need: material.quantity });
  }
  return { kind, name: def.label, built: built.has(kind), needs };
}

export function chapterViews(built: ReadonlySet<MachineKind>, stock: FarmStock): ChapterView[] {
  return CHAPTERS.map((chapter) => {
    const steps = chapter.steps.map((kind) => stepView(kind, built, stock));
    return { chapter, steps, done: steps.every((step) => step.built) };
  });
}

/** The first chapter not finished, or null once all six are. */
export function currentChapter(views: readonly ChapterView[]): ChapterView | null {
  return views.find((view) => !view.done) ?? null;
}

/** The first building still to build in a chapter. */
export function nextStep(view: ChapterView): StepView | null {
  return view.steps.find((step) => !step.built) ?? null;
}

/** The need furthest from done, which is what is holding the building back. */
export function limitingNeed(step: StepView): Need {
  return step.needs.reduce((worst, need) => (need.have / need.need < worst.have / worst.need ? need : worst));
}

/** 0..1: how close the player is to affording a building. */
export function stepReadiness(step: StepView): number {
  const need = limitingNeed(step);
  return need.need === 0 ? 1 : Math.min(1, need.have / need.need);
}

/** The chapter that building `kind` just finished, or null. `built` includes `kind`. */
export function chapterFinishedBy(kind: MachineKind, built: ReadonlySet<MachineKind>): Chapter | null {
  return CHAPTERS.find((chapter) => chapter.steps.includes(kind) && chapter.steps.every((step) => built.has(step))) ?? null;
}
