import { describe, expect, it } from "vitest";

import { QUEST_PLACES } from "./places";
import { objectiveAdvance, objectiveLabel, type StoryObjective } from "./quests";

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
