import { describe, expect, it } from "vitest";

import type { StackAcresInventory } from "../inventory";
import type { StackAcresShopProgress } from "../shop-locks";
import type { StoryEvent } from "./events";
import { TRAVELER_QUESTS } from "./quests";
import {
  applyEventToView,
  applyStoryEvent,
  freshStory,
  isTravelerDone,
  meetTraveler,
  applyTurnIn,
  storyView,
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

const TROWEL: StoryFacts = { tool: "trowel" };
const IRON: StoryFacts = { tool: "iron-shovel" };

function met(story: StoredStory, id: TravelerId, progress: StackAcresShopProgress = RUNNING_FARM): StoredStory {
  const result = meetTraveler(story, id, progress);
  expect(result.outcome).toBe("met");
  return result.story;
}

function events(story: StoredStory, list: readonly StoryEvent[]): StoredStory {
  return list.reduce(applyStoryEvent, story);
}

/** Drives one traveler's whole line with whatever it asks for. */
function finish(story: StoredStory, id: TravelerId, inventory: StackAcresInventory = {}): StoredStory {
  let next = met(story, id);
  for (const quest of TRAVELER_QUESTS[id]) {
    const feed: StoryEvent[] = [];
    const stock: StackAcresInventory = { ...inventory };
    for (const objective of quest.objectives) {
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
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "sector-cleared", sector: "wallow" });
          break;
        case "pipes":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "pipe-placed", pipe: "pipe" });
          break;
        case "soil":
          feed.push({ kind: "soil-placed", count: objective.target });
          break;
        case "contracts":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "contract-fulfilled" });
          break;
        case "forge":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "enchantment-forged" });
          break;
        case "crossbreed":
          for (let i = 0; i < objective.target; i++) feed.push({ kind: "crossbreed-harvested", item: "golden_maize" });
          break;
        case "deliver":
          stock[objective.item] = objective.target;
          break;
        case "hold-tool":
          break;
      }
    }
    next = events(next, feed);
    const result = applyTurnIn(next, id, stock, IRON);
    expect(result.outcome, `${quest.id}`).not.toBe("not-ready");
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
    expect(story.travelers.ray).toEqual({ met: true, questIndex: 0, counts: [0, 0] });
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

  it("keeps Leo locked until the other ten are home", () => {
    let story = freshStory();
    expect(meetTraveler(story, "leo", RUNNING_FARM).outcome).toBe("locked");
    for (const id of TRAVELER_IDS) {
      if (id !== "leo") story = finish(story, id);
    }
    expect(meetTraveler(story, "leo", RUNNING_FARM).outcome).toBe("met");
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
    expect(watered.travelers.ray.counts).toEqual([0, 3]);
    const over = applyStoryEvent(watered, { kind: "watered", count: 9 });
    expect(over.travelers.ray.counts).toEqual([0, 5]);
    expect(applyStoryEvent(over, { kind: "watered", count: 1 })).toBe(over);
  });

  it("returns the same object when nothing moved", () => {
    const story = met(freshStory(), "ray", FRESH_FARM);
    expect(applyStoryEvent(story, { kind: "fish-caught", species: "trout" })).toBe(story);
  });

  it("ticks each open quest on its own events", () => {
    let story = met(freshStory(), "ray", FRESH_FARM);
    story = met(story, "bea");
    story = applyStoryEvent(story, { kind: "watered", count: 4 });
    expect(story.travelers.ray.counts).toEqual([0, 4]);
    expect(story.travelers.bea.counts).toEqual([0]);
    story = applyStoryEvent(story, { kind: "harvested", stock: "poppy", count: 4 });
    expect(story.travelers.ray.counts).toEqual([0, 4]);
    expect(story.travelers.bea.counts).toEqual([4]);
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
    expect(result.granted).toBeNull();
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

  it("reads a held tool live rather than waiting for an event", () => {
    const story = met(freshStory(), "brayden");
    expect(applyTurnIn(story, "brayden", {}, TROWEL).outcome).toBe("not-ready");
    expect(applyTurnIn(story, "brayden", {}, IRON).outcome).toBe("advanced");
    expect(applyTurnIn(story, "brayden", {}, { tool: "golden-spade" }).outcome).toBe("advanced");
  });

  it("grants the reward once, on the last quest", () => {
    const story = finish(freshStory(), "ray");
    expect(story.items).toEqual(["rays_heritage_cap"]);
  });

  it("does not duplicate a reward already held", () => {
    let story: StoredStory = { ...freshStory(), items: ["rays_heritage_cap"] };
    story = met(story, "ray", FRESH_FARM);
    story = events(story, [
      { kind: "soil-placed", count: 3 },
      { kind: "watered", count: 5 },
    ]);
    story = applyTurnIn(story, "ray", {}, TROWEL).story;
    story = applyStoryEvent(story, { kind: "harvested", stock: "beet", count: 10 });
    story = applyTurnIn(story, "ray", {}, TROWEL).story;
    story = applyStoryEvent(story, { kind: "sector-cleared", sector: "wallow" });
    const last = applyTurnIn(story, "ray", {}, TROWEL);
    expect(last.outcome).toBe("completed");
    expect(last.granted).toBeNull();
    expect(last.story.items).toEqual(["rays_heritage_cap"]);
  });

  it("can finish every line", () => {
    let story = freshStory();
    for (const id of TRAVELER_IDS) {
      if (id !== "leo") story = finish(story, id);
    }
    story = finish(story, "leo");
    expect(story.items).toHaveLength(11);
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
        total: 3,
        title: "First Furrows",
        objectives: [
          { label: "Lay 3 soil beds", have: 0, need: 3 },
          { label: "Water 5 crops", have: 2, need: 5 },
        ],
      },
      ready: false,
    });
    expect(view.travelers.pierre.unlocked).toBe(false);
    expect(view.travelers.pierre.hint).toBe("Unlock the Crop Fields");
    expect(view.travelers.pierre.quest).toBeNull();
    expect(view.travelers.leo.hint).toBe("Send every other traveler home");
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
    expect(ticked.travelers.ray.quest?.objectives[1]).toEqual({ label: "Water 5 crops", have: 5, need: 5 });
    expect(ticked.travelers.ray.ready).toBe(false);
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
