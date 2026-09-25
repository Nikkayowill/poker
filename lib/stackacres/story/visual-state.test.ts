import { describe, expect, it } from "vitest";

import { TRAVELER_QUESTS } from "./quests";
import type { StoredTravelerStory } from "./state";
import { travelerVisualState } from "./visual-state";

const NEVER_MET: StoredTravelerStory = { met: false, questIndex: 0, counts: [] };

describe("travelerVisualState", () => {
  it("is absent before the player has met them", () => {
    expect(travelerVisualState(NEVER_MET, "ray")).toBe("absent");
  });

  it("is arrived right after meeting, on their first quest", () => {
    const entry: StoredTravelerStory = { met: true, questIndex: 0, counts: [0] };
    expect(travelerVisualState(entry, "ray")).toBe("arrived");
  });

  it("is under-way once at least one quest of the line has turned in", () => {
    const entry: StoredTravelerStory = { met: true, questIndex: 1, counts: [0] };
    expect(travelerVisualState(entry, "ray")).toBe("under-way");
  });

  it("is home once the whole line is finished", () => {
    const entry: StoredTravelerStory = { met: true, questIndex: TRAVELER_QUESTS.ray.length, counts: [] };
    expect(travelerVisualState(entry, "ray")).toBe("home");
  });

  it("never reports home early, one quest short of the line's length", () => {
    const entry: StoredTravelerStory = {
      met: true,
      questIndex: TRAVELER_QUESTS.pierre.length - 1,
      counts: [0],
    };
    expect(travelerVisualState(entry, "pierre")).toBe("under-way");
  });
});
