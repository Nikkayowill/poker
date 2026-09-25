/**
 * Story progress: what is stored, how an event or a turn-in moves it, and
 * the read-only view the client renders.
 *
 * SERVER IS AUTHORITATIVE (see CLAUDE.md). Nothing here reads a clock,
 * touches Gold, or talks to a store. The server's action handlers call
 * `applyStoryEvent` inside the action that produced the event, and its
 * `story-meet` / `story-turn-in` handlers call `meetTraveler` /
 * `applyTurnIn` and persist `story` from the result. The client calls the
 * same functions on its own copy so a counter can tick before the round
 * trip lands, and the server's answer overwrites it on arrival. Same split
 * ../friendship.ts already takes.
 *
 * Rewards are story items only (./items.ts). A turn-in never credits Gold
 * and never grants a machine item; the currency wall in
 * stackacres-service.ts's tests is why.
 */

import type { StackAcresToolTier } from "../equipment";
import type { StackAcresInventory } from "../inventory";
import type { StackAcresShopProgress } from "../shop-locks";
import type { StoryEvent } from "./events";
import type { StoryItemId } from "./items";
import {
  TRAVELER_QUESTS,
  isCounterObjective,
  objectiveAdvance,
  objectiveLabel,
  questFlatObjectives,
  questSegments,
  segmentObjectives,
  toolMeets,
  type StoryObjective,
  type StoryQuest,
} from "./quests";
import { TRAVELERS_IN_FINALE, TRAVELER_CATALOGUE, TRAVELER_IDS, type TravelerId } from "./travelers";
import { storyLevel, storyUnlockHint, storyUnlockMet, type StoryProgress } from "./unlocks";

/* ------------------------------------------------------------------ */
/* Stored                                                              */
/* ------------------------------------------------------------------ */

export interface StoredTravelerStory {
  /** True once the player accepted the first quest. Counters only tick after. */
  readonly met: boolean;
  /** Index into TRAVELER_QUESTS[id]. Equals the line's length once done. */
  readonly questIndex: number;
  /** One per objective of the active quest. Deliver and hold-tool stay 0. */
  readonly counts: readonly number[];
}

export interface StoredStory {
  readonly travelers: Readonly<Record<TravelerId, StoredTravelerStory>>;
  readonly items: readonly StoryItemId[];
}

const NEVER_MET: StoredTravelerStory = { met: false, questIndex: 0, counts: [] };

export function freshStory(): StoredStory {
  const travelers = {} as Record<TravelerId, StoredTravelerStory>;
  for (const id of TRAVELER_IDS) travelers[id] = NEVER_MET;
  return { travelers, items: [] };
}

export function isTravelerDone(entry: StoredTravelerStory, id: TravelerId): boolean {
  return entry.met && entry.questIndex >= TRAVELER_QUESTS[id].length;
}

/** The quest a traveler is on, or null before meeting and after finishing. */
export function activeQuest(entry: StoredTravelerStory, id: TravelerId): StoryQuest | null {
  if (!entry.met || isTravelerDone(entry, id)) return null;
  return TRAVELER_QUESTS[id][entry.questIndex];
}

function travelersHome(story: StoredStory): ReadonlySet<TravelerId> {
  return new Set(TRAVELER_IDS.filter((id) => isTravelerDone(story.travelers[id], id)));
}

function withProgress(story: StoredStory, progress: StackAcresShopProgress): StoryProgress {
  return { ...progress, travelersHome: travelersHome(story) };
}

function withTraveler(story: StoredStory, id: TravelerId, entry: StoredTravelerStory): StoredStory {
  return { ...story, travelers: { ...story.travelers, [id]: entry } };
}

/* ------------------------------------------------------------------ */
/* Meeting                                                             */
/* ------------------------------------------------------------------ */

export type MeetOutcome = "met" | "already-met" | "locked";

export interface MeetResult {
  story: StoredStory;
  outcome: MeetOutcome;
}

/** Accepting a traveler's first quest. Refused while their unlock is unmet;
 *  a second accept is a no-op rather than a reset. */
export function meetTraveler(story: StoredStory, id: TravelerId, progress: StackAcresShopProgress): MeetResult {
  const entry = story.travelers[id];
  if (entry.met) return { story, outcome: "already-met" };
  const unlock = TRAVELER_CATALOGUE[id].unlock;
  if (!storyUnlockMet(unlock, withProgress(story, progress), TRAVELERS_IN_FINALE)) {
    return { story, outcome: "locked" };
  }
  const first = TRAVELER_QUESTS[id][0];
  return {
    story: withTraveler(story, id, { met: true, questIndex: 0, counts: questFlatObjectives(first).map(() => 0) }),
    outcome: "met",
  };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function advanceCounts(quest: StoryQuest, counts: readonly number[], event: StoryEvent): readonly number[] {
  let changed = false;
  const next = questFlatObjectives(quest).map((objective, i) => {
    // Live objectives are read off the farm at turn-in, so a count here would
    // be a second, weaker answer to the same question. Same skip
    // `applyEventToView` makes on the client's copy.
    if (!isCounterObjective(objective)) return counts[i];
    const step = objectiveAdvance(objective, event);
    if (step === 0) return counts[i];
    const value = Math.min(objective.target, counts[i] + step);
    if (value !== counts[i]) changed = true;
    return value;
  });
  return changed ? next : counts;
}

/**
 * One farm event against every open quest. Returns the same object when
 * nothing moved, so a caller can skip a write or a render on identity.
 */
export function applyStoryEvent(story: StoredStory, event: StoryEvent): StoredStory {
  let travelers: Record<TravelerId, StoredTravelerStory> | null = null;
  for (const id of TRAVELER_IDS) {
    const entry = story.travelers[id];
    const quest = activeQuest(entry, id);
    if (quest === null) continue;
    const counts = advanceCounts(quest, entry.counts, event);
    if (counts === entry.counts) continue;
    if (travelers === null) travelers = { ...story.travelers };
    travelers[id] = { ...entry, counts };
  }
  return travelers === null ? story : { ...story, travelers };
}

/* ------------------------------------------------------------------ */
/* Turning in                                                          */
/* ------------------------------------------------------------------ */

/**
 * What a turn-in reads beyond the inventory. Permanent facts only.
 *
 * Counters only tick while a quest is open, so anything a player can finish
 * ONCE is a trap if it is counted: clear both districts before Ray asks, or
 * forge all three enchantments before Brayden does, and there is nothing left
 * to do and no way to finish. Those objectives read the farm itself instead,
 * the same way `deliver` and `hold-tool` always have, so work already done
 * counts and no order of play can strand a quest.
 */
export interface StoryFacts {
  readonly tool: StackAcresToolTier;
  /** Districts cleared of wild growth. */
  readonly sectorsCleared: number;
  /** Soil beds bought and laid. */
  readonly soilBeds: number;
  /** Permanent enchantments forged. */
  readonly enchantments: number;
  /** Hybrids brought in off the Crossbreeding Bed. */
  readonly crossbreeds: number;
}

/** How much of one objective the player has right now. Counters are the
 *  stored count; the other two are read live. A missing inventory key is
 *  0 by ../inventory.ts's own contract. */
export function objectiveHave(
  objective: StoryObjective,
  count: number,
  inventory: StackAcresInventory,
  facts: StoryFacts,
): number {
  switch (objective.kind) {
    case "deliver":
      return inventory[objective.item] ?? 0;
    case "hold-tool":
      return toolMeets(facts.tool, objective.tool) ? 1 : 0;
    // Once-only work, read off the farm rather than counted -- see StoryFacts.
    case "clear-sector":
      return facts.sectorsCleared;
    case "soil":
      return facts.soilBeds;
    case "forge":
      return facts.enchantments;
    case "crossbreed":
      return facts.crossbreeds;
    default:
      return count;
  }
}

export function questReady(
  quest: StoryQuest,
  counts: readonly number[],
  inventory: StackAcresInventory,
  facts: StoryFacts,
): boolean {
  return questFlatObjectives(quest).every(
    (objective, i) => objectiveHave(objective, counts[i], inventory, facts) >= objective.target,
  );
}

/**
 * Index of the first segment not yet fully satisfied, or `quest.segments`'s
 * own length once every segment is -- meaning the quest is ready to turn in.
 * Only meaningful for a segmented quest; a flat quest has nothing that reads
 * this (its dialogue and view never carry a segment index at all).
 */
export function currentSegmentIndex(
  quest: StoryQuest,
  counts: readonly number[],
  inventory: StackAcresInventory,
  facts: StoryFacts,
): number {
  const segments = quest.segments ?? [];
  let offset = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const objectives = segments[i].objectives;
    const done = objectives.every(
      (objective, j) => objectiveHave(objective, counts[offset + j], inventory, facts) >= objective.target,
    );
    if (!done) return i;
    offset += objectives.length;
  }
  return segments.length;
}

/** Where segment `segmentIndex`'s slice starts in the flat `counts` array
 *  `questFlatObjectives` lines up with. Index 0 for a flat quest. */
function segmentOffset(quest: StoryQuest, segmentIndex: number): number {
  const segments = quest.segments;
  if (segments === undefined) return 0;
  let offset = 0;
  for (let i = 0; i < segmentIndex; i += 1) offset += segments[i].objectives.length;
  return offset;
}

export type TurnInOutcome = "advanced" | "completed" | "not-ready" | "not-met" | "already-done";

export interface TurnInResult {
  story: StoredStory;
  /** The inventory after any deliver objectives are debited. Unchanged on
   *  every refusal. */
  inventory: StackAcresInventory;
  outcome: TurnInOutcome;
  /** The reward item, only on "completed" and only the first time. */
  granted: StoryItemId | null;
  /** The quest that just turned in, or null on a refusal. */
  quest: StoryQuest | null;
}

/**
 * Handing in the active quest. Refuses before touching anything, so a
 * refused turn-in never costs an item. Debits deliver objectives, moves to
 * the next quest, and on the last one grants the traveler's reward.
 */
export function applyTurnIn(
  story: StoredStory,
  id: TravelerId,
  inventory: StackAcresInventory,
  facts: StoryFacts,
): TurnInResult {
  const entry = story.travelers[id];
  const refused = (outcome: TurnInOutcome): TurnInResult => ({ story, inventory, outcome, granted: null, quest: null });
  if (!entry.met) return refused("not-met");
  if (isTravelerDone(entry, id)) return refused("already-done");
  const quest = TRAVELER_QUESTS[id][entry.questIndex];
  if (!questReady(quest, entry.counts, inventory, facts)) return refused("not-ready");

  const debited: StackAcresInventory = { ...inventory };
  for (const objective of questFlatObjectives(quest)) {
    if (objective.kind !== "deliver") continue;
    debited[objective.item] = (inventory[objective.item] ?? 0) - objective.target;
  }

  const questIndex = entry.questIndex + 1;
  const line = TRAVELER_QUESTS[id];
  if (questIndex < line.length) {
    const nextQuest = line[questIndex];
    return {
      story: withTraveler(story, id, { met: true, questIndex, counts: questFlatObjectives(nextQuest).map(() => 0) }),
      inventory: debited,
      outcome: "advanced",
      granted: null,
      quest,
    };
  }

  const reward = TRAVELER_CATALOGUE[id].reward;
  const alreadyHeld = story.items.includes(reward);
  const advanced = withTraveler(story, id, { met: true, questIndex, counts: [] });
  return {
    story: alreadyHeld ? advanced : { ...advanced, items: [...story.items, reward] },
    inventory: debited,
    outcome: "completed",
    granted: alreadyHeld ? null : reward,
    quest,
  };
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export interface StoryObjectiveView {
  readonly label: string;
  readonly have: number;
  readonly need: number;
}

export interface StoryQuestView {
  /** 0-based position in the line, and the line's length. */
  readonly index: number;
  readonly total: number;
  readonly title: string;
  /** The active checkpoint's objectives for a segmented quest, or the whole
   *  list for a flat one -- the same shape either way. */
  readonly objectives: readonly StoryObjectiveView[];
  /** Present only for a segmented quest: which checkpoint is active (clamped
   *  to the last once every checkpoint is satisfied) and how many there are. */
  readonly segmentIndex?: number;
  readonly segmentCount?: number;
}

export interface TravelerStoryView {
  readonly unlocked: boolean;
  /** What is missing while locked. Null once unlocked. */
  readonly hint: string | null;
  readonly met: boolean;
  readonly done: boolean;
  readonly quest: StoryQuestView | null;
  /** Every objective of the active quest is satisfied. */
  readonly ready: boolean;
}

/** How close the farm is to Leo's finale gate. Read by Ray's own "home"
 *  dialogue to hint at the last hidden traveler once nobody else is left --
 *  see dialogueNodeFor in ./dialogue.ts. */
export interface StackAcresStoryFinale {
  /** Travelers whose whole line is done, Leo included once he joins them. */
  readonly travelersHome: number;
  /** How many of the other ten Leo's own gate asks for (TRAVELERS_IN_FINALE). */
  readonly travelersNeeded: number;
  readonly leoUnlocked: boolean;
}

export interface StackAcresStoryView {
  readonly level: number;
  readonly travelers: Readonly<Record<TravelerId, TravelerStoryView>>;
  readonly items: readonly StoryItemId[];
  readonly finale: StackAcresStoryFinale;
}

/** One traveler's active-quest view: the current checkpoint's objectives for
 *  a segmented quest, or the whole list for a flat one. */
function questView(
  quest: StoryQuest,
  entry: StoredTravelerStory,
  total: number,
  inventory: StackAcresInventory,
  facts: StoryFacts,
): StoryQuestView {
  const segments = quest.segments;
  const segmentIndex = segments === undefined ? 0 : Math.min(currentSegmentIndex(quest, entry.counts, inventory, facts), segments.length - 1);
  const offset = segmentOffset(quest, segmentIndex);
  const objectives = segmentObjectives(quest, segmentIndex);
  return {
    index: entry.questIndex,
    total,
    title: quest.title,
    objectives: objectives.map((objective, i) => ({
      label: objectiveLabel(objective),
      have: objectiveHave(objective, entry.counts[offset + i], inventory, facts),
      need: objective.target,
    })),
    ...(segments === undefined ? {} : { segmentIndex, segmentCount: segments.length }),
  };
}

export function storyView(
  story: StoredStory,
  progress: StackAcresShopProgress,
  inventory: StackAcresInventory,
  facts: StoryFacts,
): StackAcresStoryView {
  const full = withProgress(story, progress);
  const travelers = {} as Record<TravelerId, TravelerStoryView>;
  let travelersHome = 0;
  for (const id of TRAVELER_IDS) {
    const entry = story.travelers[id];
    const unlock = TRAVELER_CATALOGUE[id].unlock;
    const quest = activeQuest(entry, id);
    const done = isTravelerDone(entry, id);
    if (done) travelersHome += 1;
    travelers[id] = {
      unlocked: storyUnlockMet(unlock, full, TRAVELERS_IN_FINALE),
      hint: storyUnlockHint(unlock, full, TRAVELERS_IN_FINALE),
      met: entry.met,
      done,
      quest: quest === null ? null : questView(quest, entry, TRAVELER_QUESTS[id].length, inventory, facts),
      ready: quest !== null && questReady(quest, entry.counts, inventory, facts),
    };
  }
  return {
    level: storyLevel(progress),
    travelers,
    items: story.items,
    finale: { travelersHome, travelersNeeded: TRAVELERS_IN_FINALE, leoUnlocked: travelers.leo.unlocked },
  };
}

/**
 * The client's own optimistic tick: one event against a rendered view,
 * counters only. Deliver and hold-tool objectives are left alone, since
 * their `have` came from the inventory and the tool, not from events.
 * Returns the same object when nothing moved.
 */
export function applyEventToView(view: StackAcresStoryView, event: StoryEvent): StackAcresStoryView {
  let travelers: Record<TravelerId, TravelerStoryView> | null = null;
  for (const id of TRAVELER_IDS) {
    const traveler = view.travelers[id];
    if (traveler.quest === null) continue;
    const quest = TRAVELER_QUESTS[id][traveler.quest.index];
    const segmentIndex = traveler.quest.segmentIndex ?? 0;
    const defs = segmentObjectives(quest, segmentIndex);
    let changed = false;
    const objectives = traveler.quest.objectives.map((objective, i) => {
      const def = defs[i];
      if (def === undefined || !isCounterObjective(def)) return objective;
      const step = objectiveAdvance(def, event);
      if (step === 0) return objective;
      const have = Math.min(objective.need, objective.have + step);
      if (have === objective.have) return objective;
      changed = true;
      return { ...objective, have };
    });
    if (!changed) continue;
    const segments = questSegments(quest);
    const segmentDone = objectives.every((objective) => objective.have >= objective.need);
    if (travelers === null) travelers = { ...view.travelers };
    if (segmentDone && segments !== null && segmentIndex + 1 < segments.length) {
      // A checkpoint cleared with more left: jump the bubble straight to the
      // next one, starting from zero. The server's own view -- which already
      // ticked every checkpoint's counters, see `advanceCounts` -- corrects
      // this the moment it lands, same as every other optimistic guess here.
      const nextIndex = segmentIndex + 1;
      travelers[id] = {
        ...traveler,
        quest: {
          ...traveler.quest,
          segmentIndex: nextIndex,
          objectives: segments[nextIndex].objectives.map((objective) => ({
            label: objectiveLabel(objective),
            have: 0,
            need: objective.target,
          })),
        },
        ready: false,
      };
      continue;
    }
    travelers[id] = {
      ...traveler,
      quest: { ...traveler.quest, objectives },
      ready: segmentDone,
    };
  }
  return travelers === null ? view : { ...view, travelers };
}
