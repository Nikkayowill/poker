import { describe, expect, it } from "vitest";

import { isStoryItemId } from "./items";
import { QUEST_PLACES } from "./places";
import { ALL_STORY_QUESTS, objectiveAdvance, objectiveLabel, type StoryObjective } from "./quests";

describe("StoryQuest.rewards", () => {
  it("names only real story items, with no duplicates within one quest", () => {
    for (const quest of ALL_STORY_QUESTS) {
      const rewards = quest.rewards ?? [];
      for (const reward of rewards) {
        expect(isStoryItemId(reward), `${quest.id}: ${reward}`).toBe(true);
      }
      expect(new Set(rewards).size, quest.id).toBe(rewards.length);
    }
  });

  it("only offers a player a choice when there is more than one option", () => {
    for (const quest of ALL_STORY_QUESTS) {
      if (quest.rewards === undefined) continue;
      expect(quest.rewards.length, quest.id).toBeGreaterThan(0);
    }
  });
});

describe("reach-place objective", () => {
  const place = QUEST_PLACES[0];
  const objective: StoryObjective = { kind: "reach-place", place: place.id, target: 1 };

  it("advances only on a matching place-reached event", () => {
    expect(objectiveAdvance(objective, { kind: "place-reached", placeId: place.id })).toBe(1);
    for (const other of QUEST_PLACES) {
      if (other.id === place.id) continue;
      expect(objectiveAdvance(objective, { kind: "place-reached", placeId: other.id })).toBe(0);
    }
    expect(objectiveAdvance(objective, { kind: "watered", count: 3 })).toBe(0);
  });

  it("labels the place by name", () => {
    expect(objectiveLabel(objective)).toBe(`Go to ${place.label}`);
  });
});
