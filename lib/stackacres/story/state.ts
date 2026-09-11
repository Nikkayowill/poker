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
 * ../friendship.ts and ../midnight-merchant.ts already take.
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
    story: withTraveler(story, id, { met: true, questIndex: 0, counts: first.objectives.map(() => 0) }),
    outcome: "met",
  };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function advanceCounts(quest: StoryQuest, counts: readonly number[], event: StoryEvent): readonly number[] {
  let changed = false;
  const next = quest.objectives.map((objective, i) => {
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

/** What a turn-in reads beyond the inventory. Permanent facts only. */
export interface StoryFacts {
  readonly tool: StackAcresToolTier;
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
  return quest.objectives.every(
    (objective, i) => objectiveHave(objective, counts[i], inventory, facts) >= objective.target,
  );
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
  for (const objective of quest.objectives) {
    if (objective.kind !== "deliver") continue;
    debited[objective.item] = (inventory[objective.item] ?? 0) - objective.target;
  }

  const questIndex = entry.questIndex + 1;
  const line = TRAVELER_QUESTS[id];
  if (questIndex < line.length) {
    const nextQuest = line[questIndex];
    return {
      story: withTraveler(story, id, { met: true, questIndex, counts: nextQuest.objectives.map(() => 0) }),
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
  readonly objectives: readonly StoryObjectiveView[];
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

export interface StackAcresStoryView {
  readonly level: number;
  readonly travelers: Readonly<Record<TravelerId, TravelerStoryView>>;
  readonly items: readonly StoryItemId[];
}

export function storyView(
  story: StoredStory,
  progress: StackAcresShopProgress,
  inventory: StackAcresInventory,
  facts: StoryFacts,
): StackAcresStoryView {
  const full = withProgress(story, progress);
  const travelers = {} as Record<TravelerId, TravelerStoryView>;
  for (const id of TRAVELER_IDS) {
    const entry = story.travelers[id];
    const unlock = TRAVELER_CATALOGUE[id].unlock;
    const quest = activeQuest(entry, id);
    travelers[id] = {
      unlocked: storyUnlockMet(unlock, full, TRAVELERS_IN_FINALE),
      hint: storyUnlockHint(unlock, full, TRAVELERS_IN_FINALE),
      met: entry.met,
      done: isTravelerDone(entry, id),
      quest:
        quest === null
          ? null
          : {
              index: entry.questIndex,
              total: TRAVELER_QUESTS[id].length,
              title: quest.title,
              objectives: quest.objectives.map((objective, i) => ({
                label: objectiveLabel(objective),
                have: objectiveHave(objective, entry.counts[i], inventory, facts),
                need: objective.target,
              })),
            },
      ready: quest !== null && questReady(quest, entry.counts, inventory, facts),
    };
  }
  return { level: storyLevel(progress), travelers, items: story.items };
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
    const defs = TRAVELER_QUESTS[id][traveler.quest.index].objectives;
    let changed = false;
    const objectives = traveler.quest.objectives.map((objective, i) => {
      const def = defs[i];
      if (!isCounterObjective(def)) return objective;
      const step = objectiveAdvance(def, event);
      if (step === 0) return objective;
      const have = Math.min(objective.need, objective.have + step);
      if (have === objective.have) return objective;
      changed = true;
      return { ...objective, have };
    });
    if (!changed) continue;
    if (travelers === null) travelers = { ...view.travelers };
    travelers[id] = {
      ...traveler,
      quest: { ...traveler.quest, objectives },
      ready: objectives.every((objective) => objective.have >= objective.need),
    };
  }
  return travelers === null ? view : { ...view, travelers };
}
