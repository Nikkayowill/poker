import { describe, expect, it } from "vitest";

import { isStoryItemId } from "./items";
import { QUEST_PLACES } from "./places";
import {
  ALL_STORY_QUESTS,
  objectiveAdvance,
  objectiveLabel,
  questFlatObjectives,
  questSegments,
  segmentObjectives,
  type StoryObjective,
  type StoryQuest,
} from "./quests";

const WATER_3 = { kind: "water", target: 3 } as const;
const HARVEST_5 = { kind: "harvest-any-crop", target: 5 } as const;

const FLAT: StoryQuest = { id: "test.flat", title: "Flat", objectives: [WATER_3], turnInLabel: "Done" };
const SEGMENTED: StoryQuest = {
  id: "test.segmented",
  title: "Segmented",
  segments: [
    { id: "test.segmented.s0", objectives: [WATER_3] },
    { id: "test.segmented.s1", objectives: [HARVEST_5] },
  ],
  turnInLabel: "Done",
};

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

describe("every real quest declares exactly one shape", () => {
  it("has objectives or segments, never both, never neither", () => {
    for (const quest of ALL_STORY_QUESTS) {
      const hasObjectives = quest.objectives !== undefined;
      const hasSegments = quest.segments !== undefined;
      expect(hasObjectives, quest.id).toBe(true);
      expect(hasSegments, quest.id).toBe(false);
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

describe("questSegments", () => {
  it("is null for a flat quest and the segment list for a segmented one", () => {
    expect(questSegments(FLAT)).toBeNull();
    expect(questSegments(SEGMENTED)).toBe(SEGMENTED.segments);
  });
});

describe("segmentObjectives", () => {
  it("returns a flat quest's whole list at index 0 and nothing elsewhere", () => {
    expect(segmentObjectives(FLAT, 0)).toEqual([WATER_3]);
    expect(segmentObjectives(FLAT, 1)).toEqual([]);
  });

  it("returns one segment's own objectives by index", () => {
    expect(segmentObjectives(SEGMENTED, 0)).toEqual([WATER_3]);
    expect(segmentObjectives(SEGMENTED, 1)).toEqual([HARVEST_5]);
    expect(segmentObjectives(SEGMENTED, 2)).toEqual([]);
  });
});

describe("questFlatObjectives", () => {
  it("is the objectives list itself for a flat quest", () => {
    expect(questFlatObjectives(FLAT)).toEqual([WATER_3]);
  });

  it("concatenates every segment's objectives in order for a segmented quest", () => {
    expect(questFlatObjectives(SEGMENTED)).toEqual([WATER_3, HARVEST_5]);
  });
});
