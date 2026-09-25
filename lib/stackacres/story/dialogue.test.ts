import { describe, expect, it } from "vitest";

import {
  HAPTIC_DOUBLE,
  HAPTIC_FANFARE,
  HAPTIC_TICK,
  STORY_DIALOGUE,
  dialogueNodeFor,
  questProgressNodeId,
  storyNode,
} from "./dialogue";
import { TRAVELER_QUESTS, type StoryQuest } from "./quests";
import type { StackAcresStoryFinale, TravelerStoryView } from "./state";
import { TRAVELER_CATALOGUE, TRAVELER_IDS } from "./travelers";

const LOCKED: TravelerStoryView = { unlocked: false, hint: "Break ground in the Crop Fields", met: false, done: false, quest: null, ready: false };
const UNMET: TravelerStoryView = { ...LOCKED, unlocked: true, hint: null };
const DONE: TravelerStoryView = { ...UNMET, met: true, done: true };

/** No one else home yet -- the ordinary case, matching every fixture above
 *  except the finale test below. */
const NOT_FINALE: StackAcresStoryFinale = { travelersHome: 0, travelersNeeded: 10, leoUnlocked: false };

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
    // Ray alone also has the finale-hint variant of his `home` line.
    expect(STORY_DIALOGUE.has("ray.home.finale-hint")).toBe(true);
    expected += 1;
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
    expect(storyNode("ray.q4.done").vibratePattern).toBe(HAPTIC_FANFARE);
    expect(storyNode("ray.q2.progress").vibratePattern).toBe(HAPTIC_TICK);
    expect(storyNode("ray.hello").vibratePattern).toBe(HAPTIC_DOUBLE);
  });

  it("throws on an id nobody wrote", () => {
    expect(() => storyNode("bleep.hello")).toThrow();
    expect(() => storyNode("ray.q5.done")).toThrow();
  });
});

describe("dialogueNodeFor", () => {
  it("picks the node that matches the traveler's state", () => {
    expect(dialogueNodeFor("ray", LOCKED, NOT_FINALE).id).toBe("ray.locked");
    expect(dialogueNodeFor("ray", UNMET, NOT_FINALE).id).toBe("ray.hello");
    expect(dialogueNodeFor("ray", onQuest(0, false), NOT_FINALE).id).toBe("ray.q1.progress");
    expect(dialogueNodeFor("ray", onQuest(0, true), NOT_FINALE).id).toBe("ray.q1.done");
    expect(dialogueNodeFor("ray", onQuest(2, true), NOT_FINALE).id).toBe("ray.q3.done");
    expect(dialogueNodeFor("ray", DONE, NOT_FINALE).id).toBe("ray.home");
  });

  it("returns the shared node object, so identity tracks the beat", () => {
    expect(dialogueNodeFor("bea", onQuest(1, false), NOT_FINALE)).toBe(dialogueNodeFor("bea", onQuest(1, false), NOT_FINALE));
  });

  it("has Ray point at the hidden zones once he's the last one home and Leo hasn't turned up", () => {
    const oneShort: StackAcresStoryFinale = { travelersHome: 9, travelersNeeded: 10, leoUnlocked: false };
    expect(dialogueNodeFor("ray", DONE, oneShort).id).toBe("ray.home.finale-hint");
  });

  it("goes back to Ray's plain home line once Leo has unlocked", () => {
    const leoUp: StackAcresStoryFinale = { travelersHome: 10, travelersNeeded: 10, leoUnlocked: true };
    expect(dialogueNodeFor("ray", DONE, leoUp).id).toBe("ray.home");
  });

  it("never gives anyone but Ray the finale hint", () => {
    const oneShort: StackAcresStoryFinale = { travelersHome: 9, travelersNeeded: 10, leoUnlocked: false };
    expect(dialogueNodeFor("bea", DONE, oneShort).id).toBe("bea.home");
  });

});

describe("questProgressNodeId", () => {
  const FLAT: StoryQuest = { id: "test.flat", title: "Flat", objectives: [], turnInLabel: "Done" };
  const SEGMENTED: StoryQuest = {
    id: "test.segmented",
    title: "Segmented",
    turnInLabel: "Done",
    segments: [
      { id: "test.segmented.s0", objectives: [] },
      { id: "test.segmented.s1", objectives: [] },
    ],
  };

  it("is the flat node id for a flat quest, ignoring the segment index", () => {
    expect(questProgressNodeId(FLAT, 0)).toBe("test.flat.progress");
    expect(questProgressNodeId(FLAT, 5)).toBe("test.flat.progress");
  });

  it("names the checkpoint's own node for a segmented quest", () => {
    expect(questProgressNodeId(SEGMENTED, 0)).toBe("test.segmented.s0.progress");
    expect(questProgressNodeId(SEGMENTED, 1)).toBe("test.segmented.s1.progress");
  });
});
