import { describe, expect, it } from "vitest";

import { isStoryItemId } from "./items";
import { ALL_STORY_QUESTS } from "./quests";

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
