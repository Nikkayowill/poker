import { describe, expect, it } from "vitest";

import type { StackAcresInventory } from "../inventory";
import type { StackAcresShopProgress } from "../shop-locks";
import type { StoryEvent } from "./events";
import type { StoryItemId } from "./items";
import { TRAVELER_QUESTS, questFlatObjectives, type StoryQuest } from "./quests";
import {
  applyEventToView,
  applyStoryEvent,
  currentSegmentIndex,
  freshStory,
  isTravelerDone,
  meetTraveler,
  objectiveHave,
  applyTurnIn,
  questReady,
  questRequirementMet,
  storyView,
  travelerHasStoryToTell,
  type StoredStory,
  type StoryFacts,
} from "./state";
import { TRAVELER_IDS, type TravelerId } from "./travelers";

const FRESH_FARM: StackAcresShopProgress = {
  sectors: ["farmstead"],
  influence: 0,
  greenhouseBuilt: false,
  cropFieldsUnlocked: false,
};

const RUNNING_FARM: StackAcresShopProgress = {
  sectors: ["farmstead", "wallow", "oxfields"],
  influence: 10,
  greenhouseBuilt: true,
  cropFieldsUnlocked: true,
};

/** A farm that has done none of the once-only work yet. */
const BARE = { sectorsCleared: 0, soilBeds: 0 } as const;
const TROWEL: StoryFacts = { tool: "trowel", ...BARE };

/** Generous enough to clear any `requires` a real quest declares today
 *  (ray.q4 asks for 9). Driving a line to completion in these tests is about
 *  the objectives, not the friendship gate, unless a test says otherwise. */
const FRIENDLY = { ray: 999, pierre: 999, ivy: 999 };
const NO_FRIENDSHIP = {};

function met(story: StoredStory, id: TravelerId, progress: StackAcresShopProgress = RUNNING_FARM): StoredStory {
  const result = meetTraveler(story, id, progress);
  expect(result.outcome).toBe("met");
  return result.story;
}

function events(story: StoredStory, list: readonly StoryEvent[]): StoredStory {
  return list.reduce(applyStoryEvent, story);
}

/** Drives one traveler's whole line with whatever it asks for. Once-only
 *  work is supplied as a farm fact, never as an event -- that is the whole
 *  point of reading it live (see StoryFacts). */
function finish(story: StoredStory, id: TravelerId, inventory: StackAcresInventory = {}): StoredStory {
  let next = met(story, id);
  for (const quest of TRAVELER_QUESTS[id]) {
    const feed: StoryEvent[] = [];
    const stock: StackAcresInventory = { ...inventory };
    const facts = { tool: "iron-shovel", ...BARE } as { -readonly [K in keyof StoryFacts]: StoryFacts[K] };
    for (const objective of questFlatObjectives(quest)) {
      switch (objective.kind) {
        case "harvest":
          feed.push({ kind: "harvested", stock: objective.crops[0], count: objective.target });
          break;
        case "harvest-any-crop":
          feed.push({ kind: "harvested", stock: "potato", count: objective.target });
          break;
        case "collect-livestock":
          feed.push({ kind: "harvested", stock: "hen", count: objective.target });
          break;
        case "water":
          feed.push({ kind: "watered", count: objective.target });
          break;
        case "feed":
          feed.push({ kind: "fed", count: objective.target });
          break;
        case "buy-feed":
          feed.push({ kind: "feed-bought", servings: objective.target });
          break;
        case "process":
          feed.push({ kind: "processed", recipe: objective.recipe, count: objective.target });
          break;
        case "fish":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "fish-caught", species: "trout" });
          break;
        case "secret-zones":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "secret-zone-tapped", zoneId: "loose-board" });
          break;
        case "clear-sector":
          facts.sectorsCleared = objective.target;
          break;
        case "soil":
          facts.soilBeds = objective.target;
          break;
        case "contracts":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "contract-fulfilled" });
          break;
        case "deliver":
          stock[objective.item] = objective.target;
          break;
        case "hold-tool":
          break;
        case "reach-place":
          feed.push({ kind: "place-reached", placeId: objective.place });
          break;
      }
    }
    next = events(next, feed);
    const chosenReward = (quest.rewards?.length ?? 0) >= 2 ? (quest.rewards as readonly StoryItemId[])[0] : null;
    const result = applyTurnIn(next, id, stock, facts, chosenReward, FRIENDLY);
    expect(result.outcome, `${quest.id}`).not.toBe("not-ready");
    expect(result.outcome, `${quest.id}`).not.toBe("quest-locked");
    next = result.story;
  }
  expect(isTravelerDone(next.travelers[id], id)).toBe(true);
  return next;
}

describe("freshStory", () => {
  it("knows nobody and holds nothing", () => {
    const story = freshStory();
    for (const id of TRAVELER_IDS) expect(story.travelers[id]).toEqual({ met: false, questIndex: 0, counts: [] });
    expect(story.items).toEqual([]);
  });
});

describe("meetTraveler", () => {
  it("opens the first quest with zeroed counters", () => {
    const story = met(freshStory(), "ray", FRESH_FARM);
    expect(story.travelers.ray).toEqual({ met: true, questIndex: 0, counts: [0] });
  });

  it("refuses a locked traveler and leaves the story untouched", () => {
    const story = freshStory();
    const result = meetTraveler(story, "pierre", FRESH_FARM);
    expect(result.outcome).toBe("locked");
    expect(result.story).toBe(story);
  });

  it("is a no-op the second time", () => {
    const once = met(freshStory(), "ray", FRESH_FARM);
    const again = meetTraveler(once, "ray", FRESH_FARM);
    expect(again.outcome).toBe("already-met");
    expect(again.story).toBe(once);
  });
});

describe("applyStoryEvent", () => {
  it("ignores everything before a traveler is met", () => {
    const story = freshStory();
    expect(applyStoryEvent(story, { kind: "watered", count: 3 })).toBe(story);
  });

  it("ticks only the objectives an event matches, capped at target", () => {
    const story = met(freshStory(), "ray", FRESH_FARM);
    const watered = applyStoryEvent(story, { kind: "watered", count: 3 });
    expect(watered.travelers.ray.counts).toEqual([3]);
    const over = applyStoryEvent(watered, { kind: "watered", count: 9 });
    expect(over.travelers.ray.counts).toEqual([3]);
    expect(applyStoryEvent(over, { kind: "watered", count: 1 })).toBe(over);
  });

  it("returns the same object when nothing moved", () => {
    const story = met(freshStory(), "ray", FRESH_FARM);
    expect(applyStoryEvent(story, { kind: "fish-caught", species: "trout" })).toBe(story);
  });

  it("ticks each open quest on its own events, and leaves a traveler with no counted objective alone", () => {
    // Pierre's first quest is `deliver`, a live fact rather than a counted
    // one (LIVE_OBJECTIVE_KINDS, ./quests.ts) -- his counts array stays [0]
    // through any event and only moves at turn-in, off the inventory.
    let story = met(freshStory(), "ray", FRESH_FARM);
    story = met(story, "pierre");
    story = applyStoryEvent(story, { kind: "watered", count: 4 });
    expect(story.travelers.ray.counts).toEqual([3]);
    expect(story.travelers.pierre.counts).toEqual([0, 0]);
  });

  it("never touches a deliver objective", () => {
    const story = met(freshStory(), "pierre");
    const after = applyStoryEvent(story, { kind: "harvested", stock: "potato", count: 5 });
    expect(after).toBe(story);
  });
});

describe("applyTurnIn", () => {
  it("refuses before meeting, before ready, and after finishing", () => {
    const fresh = freshStory();
    expect(applyTurnIn(fresh, "ray", {}, TROWEL).outcome).toBe("not-met");
    const open = met(fresh, "ray", FRESH_FARM);
    const refused = applyTurnIn(open, "ray", {}, TROWEL);
    expect(refused.outcome).toBe("not-ready");
    expect(refused.story).toBe(open);
    const done = finish(fresh, "ray");
    expect(applyTurnIn(done, "ray", {}, TROWEL).outcome).toBe("already-done");
  });

  it("debits deliver items and moves to the next quest", () => {
    const story = met(freshStory(), "pierre");
    const inventory: StackAcresInventory = { potato: 7, carrot: 5, flour: 2 };
    const result = applyTurnIn(story, "pierre", inventory, TROWEL);
    expect(result.outcome).toBe("advanced");
    expect(result.granted).toEqual([]);
    expect(result.quest?.id).toBe("pierre.q1");
    expect(result.inventory).toEqual({ potato: 2, carrot: 0, flour: 2 });
    expect(inventory).toEqual({ potato: 7, carrot: 5, flour: 2 });
    expect(result.story.travelers.pierre).toEqual({ met: true, questIndex: 1, counts: [0] });
  });

  it("refuses a short delivery without touching the inventory", () => {
    const story = met(freshStory(), "pierre");
    const inventory: StackAcresInventory = { potato: 4, carrot: 5 };
    const result = applyTurnIn(story, "pierre", inventory, TROWEL);
    expect(result.outcome).toBe("not-ready");
    expect(result.inventory).toBe(inventory);
  });

  it("grants the reward once, on the last quest", () => {
    const story = finish(freshStory(), "ray");
    expect(story.items).toEqual(["rays_heritage_cap"]);
  });

  it("does not duplicate a reward already held", () => {
    let story: StoredStory = { ...freshStory(), items: ["rays_heritage_cap"] };
    story = met(story, "ray", FRESH_FARM);
    story = applyStoryEvent(story, { kind: "watered", count: 3 });
    story = applyTurnIn(story, "ray", {}, TROWEL).story;
    story = applyStoryEvent(story, { kind: "processed", recipe: "flour", count: 1 });
    story = applyTurnIn(story, "ray", {}, TROWEL).story;
    story = applyStoryEvent(story, { kind: "harvested", stock: "carrot", count: 10 });
    story = applyTurnIn(story, "ray", {}, TROWEL).story;
    story = applyStoryEvent(story, { kind: "contract-fulfilled" });
    const last = applyTurnIn(story, "ray", {}, TROWEL, null, FRIENDLY);
    expect(last.outcome).toBe("completed");
    expect(last.granted).toEqual([]);
    expect(last.story.items).toEqual(["rays_heritage_cap"]);
  });

  it("can finish every line", () => {
    let story = freshStory();
    for (const id of TRAVELER_IDS) story = finish(story, id);
    expect(story.items).toHaveLength(TRAVELER_IDS.length);
  });
});

describe("storyView", () => {
  it("projects unlocks, hints and the active quest", () => {
    const story = met(freshStory(), "ray", FRESH_FARM);
    const view = storyView(applyStoryEvent(story, { kind: "watered", count: 2 }), FRESH_FARM, {}, TROWEL);
    expect(view.level).toBe(1);
    expect(view.travelers.ray).toEqual({
      unlocked: true,
      hint: null,
      met: true,
      done: false,
      quest: {
        index: 0,
        total: 4,
        title: "First Furrows",
        objectives: [{ label: "Water 3 crops", have: 2, need: 3 }],
      },
      ready: false,
      questBlocked: false,
    });
    expect(view.travelers.pierre.unlocked).toBe(false);
    expect(view.travelers.pierre.hint).toBe("Break ground in the Crop Fields");
    expect(view.travelers.pierre.quest).toBeNull();
  });

  it("reads deliver progress off the inventory and flips ready", () => {
    const story = met(freshStory(), "pierre");
    const short = storyView(story, RUNNING_FARM, { potato: 5, carrot: 1 }, TROWEL);
    expect(short.travelers.pierre.quest?.objectives.map((objective) => objective.have)).toEqual([5, 1]);
    expect(short.travelers.pierre.ready).toBe(false);
    const full = storyView(story, RUNNING_FARM, { potato: 5, carrot: 5 }, TROWEL);
    expect(full.travelers.pierre.ready).toBe(true);
  });

  it("marks a finished line done with no quest", () => {
    const view = storyView(finish(freshStory(), "ray"), RUNNING_FARM, {}, TROWEL);
    expect(view.travelers.ray.done).toBe(true);
    expect(view.travelers.ray.quest).toBeNull();
    expect(view.items).toEqual(["rays_heritage_cap"]);
  });
});

describe("applyEventToView", () => {
  it("ticks counters on the rendered view and leaves deliver alone", () => {
    let story = met(freshStory(), "ray", FRESH_FARM);
    story = met(story, "pierre");
    const view = storyView(story, RUNNING_FARM, { potato: 2 }, TROWEL);
    const ticked = applyEventToView(view, { kind: "watered", count: 5 });
    expect(ticked.travelers.ray.quest?.objectives[0]).toEqual({ label: "Water 3 crops", have: 3, need: 3 });
    expect(ticked.travelers.ray.ready).toBe(true);
    expect(ticked.travelers.pierre).toBe(view.travelers.pierre);
    const harvested = applyEventToView(ticked, { kind: "harvested", stock: "potato", count: 3 });
    expect(harvested.travelers.pierre.quest?.objectives[0].have).toBe(2);
  });

  it("flips ready when the last counter lands", () => {
    const story = met(freshStory(), "ray", FRESH_FARM);
    const view = storyView(story, FRESH_FARM, {}, TROWEL);
    const soil = applyEventToView(view, { kind: "soil-placed", count: 3 });
    expect(soil.travelers.ray.ready).toBe(false);
    const water = applyEventToView(soil, { kind: "watered", count: 5 });
    expect(water.travelers.ray.ready).toBe(true);
  });

  it("returns the same object when nothing moved", () => {
    const view = storyView(freshStory(), FRESH_FARM, {}, TROWEL);
    expect(applyEventToView(view, { kind: "watered", count: 1 })).toBe(view);
  });
});

/**
 * A synthetic segmented quest, not wired into TRAVELER_QUESTS -- no real
 * quest opts into segments yet (see StoryQuest's own header). These tests
 * exercise the mechanism directly through the exported pure functions, which
 * all take a `StoryQuest` as data rather than looking one up by traveler.
 */
describe("segmented quests", () => {
  const SEGMENTED: StoryQuest = {
    id: "test.segmented",
    title: "Two Checkpoints",
    turnInLabel: "Done",
    segments: [
      { id: "test.segmented.s0", objectives: [{ kind: "water", target: 3 }] },
      { id: "test.segmented.s1", objectives: [{ kind: "harvest-any-crop", target: 2 }] },
    ],
  };

  it("holds at checkpoint 0 until its own objective is satisfied", () => {
    expect(currentSegmentIndex(SEGMENTED, [0, 0], {}, TROWEL)).toBe(0);
    expect(currentSegmentIndex(SEGMENTED, [2, 0], {}, TROWEL)).toBe(0);
  });

  it("advances to checkpoint 1 the moment checkpoint 0 is satisfied, regardless of checkpoint 1's own count", () => {
    expect(currentSegmentIndex(SEGMENTED, [3, 0], {}, TROWEL)).toBe(1);
  });

  it("reports past the last checkpoint once every checkpoint is satisfied", () => {
    expect(currentSegmentIndex(SEGMENTED, [3, 2], {}, TROWEL)).toBe(2);
  });

  it("is only ready when every checkpoint's objective is satisfied, not just the first", () => {
    expect(questReady(SEGMENTED, [3, 0], {}, TROWEL)).toBe(false);
    expect(questReady(SEGMENTED, [3, 1], {}, TROWEL)).toBe(false);
    expect(questReady(SEGMENTED, [3, 2], {}, TROWEL)).toBe(true);
  });

  it("counts flat, in segment order, across the whole quest's counts array", () => {
    // counts[0] belongs to checkpoint 0's "water" objective, counts[1] to
    // checkpoint 1's "harvest-any-crop" -- questFlatObjectives lines them up.
    const objectives = questFlatObjectives(SEGMENTED);
    expect(objectives.map((o) => o.kind)).toEqual(["water", "harvest-any-crop"]);
    expect(objectiveHave(objectives[0], 3, {}, TROWEL)).toBe(3);
    expect(objectiveHave(objectives[1], 2, {}, TROWEL)).toBe(2);
  });
});

describe("questRequirementMet", () => {
  const FRIENDSHIP_GATE: StoryQuest = {
    id: "test.friendship",
    title: "Friendship-gated",
    objectives: [],
    turnInLabel: "Done",
    requires: [{ kind: "friendship", npc: "ray", points: 10 }],
  };
  const TRAVELER_GATE: StoryQuest = {
    id: "test.traveler",
    title: "Traveler-gated",
    objectives: [],
    turnInLabel: "Done",
    requires: [{ kind: "traveler-done", traveler: "pierre" }],
  };
  const BOTH_GATES: StoryQuest = {
    id: "test.both",
    title: "Doubly gated",
    objectives: [],
    turnInLabel: "Done",
    requires: [...FRIENDSHIP_GATE.requires!, ...TRAVELER_GATE.requires!],
  };
  const UNGATED: StoryQuest = { id: "test.plain", title: "Plain", objectives: [], turnInLabel: "Done" };

  it("is always true for a quest with no requires", () => {
    expect(questRequirementMet(UNGATED, NO_FRIENDSHIP, new Set())).toBe(true);
  });

  it("checks a friendship threshold against the named npc only", () => {
    expect(questRequirementMet(FRIENDSHIP_GATE, { ray: 9 }, new Set())).toBe(false);
    expect(questRequirementMet(FRIENDSHIP_GATE, { ray: 10 }, new Set())).toBe(true);
    expect(questRequirementMet(FRIENDSHIP_GATE, { pierre: 999 }, new Set())).toBe(false);
  });

  it("checks a traveler-done requirement against the finished-lines set", () => {
    expect(questRequirementMet(TRAVELER_GATE, NO_FRIENDSHIP, new Set())).toBe(false);
    expect(questRequirementMet(TRAVELER_GATE, NO_FRIENDSHIP, new Set(["pierre"]))).toBe(true);
    expect(questRequirementMet(TRAVELER_GATE, NO_FRIENDSHIP, new Set(["ivy"]))).toBe(false);
  });

  it("needs every requirement met when a quest declares more than one", () => {
    expect(questRequirementMet(BOTH_GATES, { ray: 10 }, new Set())).toBe(false);
    expect(questRequirementMet(BOTH_GATES, { ray: 10 }, new Set(["pierre"]))).toBe(true);
  });
});

describe("a quest's own requires", () => {
  /** Drives Ray through q1-q3 with FRIENDLY points so only q4's gate is in
   *  question, then hands q4's own objective (one town order) too. */
  function readyForRayQ4(friendshipPoints: Readonly<Partial<Record<"ray" | "pierre" | "ivy", number>>>): StoredStory {
    let story = met(freshStory(), "ray", FRESH_FARM);
    story = events(story, [{ kind: "watered", count: 3 }]);
    story = applyTurnIn(story, "ray", {}, TROWEL, null, friendshipPoints).story;
    story = events(story, [{ kind: "processed", recipe: "flour", count: 1 }]);
    story = applyTurnIn(story, "ray", {}, TROWEL, null, friendshipPoints).story;
    story = events(story, [{ kind: "harvested", stock: "carrot", count: 10 }]);
    story = applyTurnIn(story, "ray", {}, TROWEL, null, friendshipPoints).story;
    story = events(story, [{ kind: "contract-fulfilled" }]);
    return story;
  }

  it("refuses the turn-in without touching the story, even with the objective done", () => {
    const story = readyForRayQ4(NO_FRIENDSHIP);
    const result = applyTurnIn(story, "ray", {}, TROWEL, null, NO_FRIENDSHIP);
    expect(result.outcome).toBe("quest-locked");
    expect(result.story).toBe(story);
  });

  it("turns in cleanly once the gate opens", () => {
    const story = readyForRayQ4(NO_FRIENDSHIP);
    const result = applyTurnIn(story, "ray", {}, TROWEL, null, { ray: 9 });
    expect(result.outcome).toBe("completed");
  });

  it("shows questBlocked in the view while the gate is unmet, and clears it once it opens", () => {
    const story = readyForRayQ4(NO_FRIENDSHIP);
    const blocked = storyView(story, RUNNING_FARM, {}, TROWEL, NO_FRIENDSHIP);
    expect(blocked.travelers.ray.questBlocked).toBe(true);
    expect(blocked.travelers.ray.ready).toBe(true);
    const open = storyView(story, RUNNING_FARM, {}, TROWEL, { ray: 9 });
    expect(open.travelers.ray.questBlocked).toBe(false);
  });
});

describe("travelerHasStoryToTell", () => {
  const base = { unlocked: true, done: false, met: true, ready: false, questBlocked: false };

  it("greets a traveler who has not been met", () => {
    expect(travelerHasStoryToTell({ ...base, met: false })).toBe(true);
  });

  it("opens the story when the quest is ready and nothing blocks it", () => {
    expect(travelerHasStoryToTell({ ...base, ready: true })).toBe(true);
  });

  it("does not open a ready quest that friendship still blocks", () => {
    // Ray's First Order: the objective is done at low friendship. Opening the
    // story would show only "come around more" and hide the gift loop that
    // earns the friendship.
    expect(travelerHasStoryToTell({ ...base, ready: true, questBlocked: true })).toBe(false);
  });

  it("stays quiet for a locked or finished traveler", () => {
    expect(travelerHasStoryToTell({ ...base, unlocked: false, met: false })).toBe(false);
    expect(travelerHasStoryToTell({ ...base, done: true, ready: true })).toBe(false);
  });
});
