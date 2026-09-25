import { describe, expect, it } from "vitest";

import {
  ALL_STORY_QUESTS,
  questFlatObjectives,
  questSegments,
  segmentObjectives,
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
