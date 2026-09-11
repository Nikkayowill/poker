import { describe, expect, it } from "vitest";

import {
  HAPTIC_DOUBLE,
  HAPTIC_FANFARE,
  HAPTIC_TICK,
  STORY_DIALOGUE,
  dialogueNodeFor,
  storyNode,
} from "./dialogue";
import { TRAVELER_QUESTS } from "./quests";
import type { TravelerStoryView } from "./state";
import { TRAVELER_CATALOGUE, TRAVELER_IDS } from "./travelers";

const LOCKED: TravelerStoryView = { unlocked: false, hint: "Unlock the Crop Fields", met: false, done: false, quest: null, ready: false };
const UNMET: TravelerStoryView = { ...LOCKED, unlocked: true, hint: null };
const DONE: TravelerStoryView = { ...UNMET, met: true, done: true };

function onQuest(index: number, ready: boolean): TravelerStoryView {
  return { ...UNMET, met: true, ready, quest: { index, total: 3, title: "", objectives: [] } };
}

describe("STORY_DIALOGUE", () => {
  it("has locked, hello, home and two beats per quest for every traveler", () => {
    let expected = 0;
    for (const id of TRAVELER_IDS) {
      expect(STORY_DIALOGUE.has(`${id}.locked`)).toBe(true);
      expect(STORY_DIALOGUE.has(`${id}.hello`)).toBe(true);
      expect(STORY_DIALOGUE.has(`${id}.home`)).toBe(true);
      expected += 3;
      for (const quest of TRAVELER_QUESTS[id]) {
        expect(STORY_DIALOGUE.has(`${quest.id}.progress`)).toBe(true);
        expect(STORY_DIALOGUE.has(`${quest.id}.done`)).toBe(true);
        expected += 2;
      }
    }
    expect(STORY_DIALOGUE.size).toBe(expected);
  });

  it("gives every node a speaker, a line, a haptic tick and a way out", () => {
    for (const node of STORY_DIALOGUE.values()) {
      expect(node.speakerName.length).toBeGreaterThan(0);
      expect(node.dialogueText.trim().length).toBeGreaterThan(0);
      expect(node.vibratePattern.length).toBeGreaterThan(0);
      for (const ms of node.vibratePattern) {
        expect(Number.isInteger(ms)).toBe(true);
        expect(ms).toBeGreaterThan(0);
      }
      expect(node.choices.some((choice) => !choice.commits)).toBe(true);
      const committing = node.choices.filter((choice) => choice.commits);
      expect(committing.length).toBe(node.onComplete === null ? 0 : 1);
    }
  });

  it("speaks in each traveler's own name", () => {
    for (const id of TRAVELER_IDS) {
      expect(storyNode(`${id}.hello`).speakerName).toBe(TRAVELER_CATALOGUE[id].name);
    }
  });

  it("writes plain sentences", () => {
    for (const node of STORY_DIALOGUE.values()) {
      expect(node.dialogueText).not.toContain("—");
      expect(node.dialogueText).not.toContain(" -- ");
    }
  });

  it("commits the right intent from hello and done", () => {
    expect(storyNode("pierre.hello").onComplete).toEqual({ action: "story-meet", traveler: "pierre" });
    expect(storyNode("pierre.q1.done").onComplete).toEqual({ action: "story-turn-in", traveler: "pierre" });
    expect(storyNode("pierre.q1.done").choices[0].label).toBe(TRAVELER_QUESTS.pierre[0].turnInLabel);
    expect(storyNode("pierre.q1.progress").onComplete).toBeNull();
    expect(storyNode("pierre.locked").onComplete).toBeNull();
    expect(storyNode("pierre.home").onComplete).toBeNull();
  });

  it("saves the fanfare for the last turn-in", () => {
    expect(storyNode("ray.q1.done").vibratePattern).toBe(HAPTIC_DOUBLE);
    expect(storyNode("ray.q3.done").vibratePattern).toBe(HAPTIC_FANFARE);
    expect(storyNode("ray.q2.progress").vibratePattern).toBe(HAPTIC_TICK);
    expect(storyNode("ray.hello").vibratePattern).toBe(HAPTIC_DOUBLE);
  });

  it("throws on an id nobody wrote", () => {
    expect(() => storyNode("bleep.hello")).toThrow();
    expect(() => storyNode("ray.q4.done")).toThrow();
  });
});

describe("dialogueNodeFor", () => {
  it("picks the node that matches the traveler's state", () => {
    expect(dialogueNodeFor("ray", LOCKED).id).toBe("ray.locked");
    expect(dialogueNodeFor("ray", UNMET).id).toBe("ray.hello");
    expect(dialogueNodeFor("ray", onQuest(0, false)).id).toBe("ray.q1.progress");
    expect(dialogueNodeFor("ray", onQuest(0, true)).id).toBe("ray.q1.done");
    expect(dialogueNodeFor("ray", onQuest(2, true)).id).toBe("ray.q3.done");
    expect(dialogueNodeFor("ray", DONE).id).toBe("ray.home");
  });

  it("returns the shared node object, so identity tracks the beat", () => {
    expect(dialogueNodeFor("bea", onQuest(1, false))).toBe(dialogueNodeFor("bea", onQuest(1, false)));
  });
});
