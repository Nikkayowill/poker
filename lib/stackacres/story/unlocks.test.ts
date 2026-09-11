import { describe, expect, it } from "vitest";

import { STACKACRES_QUEST_LABELS } from "../shop-locks";
import { TRAVELERS_IN_FINALE, TRAVELER_IDS, type TravelerId } from "./travelers";
import {
  STORY_MAX_LEVEL,
  levelUnlock,
  storyLevel,
  storyUnlockHint,
  storyUnlockMet,
  type StoryProgress,
} from "./unlocks";

const FRESH: StoryProgress = {
  sectors: ["farmstead"],
  influence: 0,
  greenhouseBuilt: false,
  cropFieldsUnlocked: false,
  travelersHome: new Set(),
};

const EVERYTHING: StoryProgress = {
  sectors: ["farmstead", "wallow", "oxfields"],
  influence: 10,
  greenhouseBuilt: true,
  cropFieldsUnlocked: true,
  travelersHome: new Set(TRAVELER_IDS.filter((id): id is TravelerId => id !== "leo")),
};

describe("storyLevel", () => {
  it("is the shop milestone plus one", () => {
    expect(storyLevel(FRESH)).toBe(1);
    expect(storyLevel({ ...FRESH, cropFieldsUnlocked: true })).toBe(2);
    expect(storyLevel(EVERYTHING)).toBe(STORY_MAX_LEVEL);
    expect(STORY_MAX_LEVEL).toBe(6);
  });
});

describe("levelUnlock", () => {
  it("asks for nothing at level 1 and one milestone per level after", () => {
    expect(levelUnlock(1)).toEqual({ kind: "always" });
    expect(levelUnlock(2)).toEqual({ kind: "milestone", count: 1 });
    expect(levelUnlock(5)).toEqual({ kind: "milestone", count: 4 });
  });

  it("throws off the ladder", () => {
    expect(() => levelUnlock(0)).toThrow();
    expect(() => levelUnlock(STORY_MAX_LEVEL + 1)).toThrow();
    expect(() => levelUnlock(2.5)).toThrow();
  });
});

describe("storyUnlockMet / storyUnlockHint", () => {
  it("counts milestones in any order", () => {
    const unlock = levelUnlock(3);
    expect(storyUnlockMet(unlock, FRESH, TRAVELERS_IN_FINALE)).toBe(false);
    expect(storyUnlockMet(unlock, { ...FRESH, influence: 5, greenhouseBuilt: true }, TRAVELERS_IN_FINALE)).toBe(true);
  });

  it("hints at the first unearned flag while a milestone is short", () => {
    expect(storyUnlockHint(levelUnlock(2), FRESH, TRAVELERS_IN_FINALE)).toBe(STACKACRES_QUEST_LABELS.crop_fields_unlocked);
    expect(storyUnlockHint(levelUnlock(2), { ...FRESH, cropFieldsUnlocked: true }, TRAVELERS_IN_FINALE)).toBeNull();
    expect(storyUnlockHint(levelUnlock(3), { ...FRESH, cropFieldsUnlocked: true }, TRAVELERS_IN_FINALE)).toBe(
      STACKACRES_QUEST_LABELS.town_trusted,
    );
  });

  it("names the flag itself for a flag unlock", () => {
    const unlock = { kind: "flag", flag: "cleared_oxfields" } as const;
    expect(storyUnlockMet(unlock, FRESH, TRAVELERS_IN_FINALE)).toBe(false);
    expect(storyUnlockHint(unlock, FRESH, TRAVELERS_IN_FINALE)).toBe(STACKACRES_QUEST_LABELS.cleared_oxfields);
    expect(storyUnlockMet(unlock, EVERYTHING, TRAVELERS_IN_FINALE)).toBe(true);
  });

  it("opens the finale only once every other traveler is home", () => {
    const unlock = { kind: "finale" } as const;
    expect(storyUnlockMet(unlock, FRESH, TRAVELERS_IN_FINALE)).toBe(false);
    expect(storyUnlockHint(unlock, FRESH, TRAVELERS_IN_FINALE)).toBe("Send every other traveler home");
    const nineHome = { ...EVERYTHING, travelersHome: new Set([...EVERYTHING.travelersHome].slice(0, 9)) };
    expect(storyUnlockMet(unlock, nineHome, TRAVELERS_IN_FINALE)).toBe(false);
    expect(storyUnlockMet(unlock, EVERYTHING, TRAVELERS_IN_FINALE)).toBe(true);
    expect(storyUnlockHint(unlock, EVERYTHING, TRAVELERS_IN_FINALE)).toBeNull();
  });

  it("never hints for an always unlock", () => {
    expect(storyUnlockHint({ kind: "always" }, FRESH, TRAVELERS_IN_FINALE)).toBeNull();
  });
});
