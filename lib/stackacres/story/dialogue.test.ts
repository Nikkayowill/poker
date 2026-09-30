import { describe, expect, it } from "vitest";

import { HAPTIC_DOUBLE, HAPTIC_FANFARE, HAPTIC_TICK, STORY_DIALOGUE, dialogueNodeFor, questProgressNodeId, storyNode } from "./dialogue";
import { ALL_STORY_QUESTS, TRAVELER_QUESTS, type StoryQuest } from "./quests";
import type { TravelerStoryView } from "./state";
import { TRAVELER_CATALOGUE, TRAVELER_IDS } from "./travelers";

const LOCKED: TravelerStoryView = {
  unlocked: false,
  hint: "Break ground in the Crop Fields",
  met: false,
  done: false,
  quest: null,
  ready: false,
  questBlocked: false,
};
const UNMET: TravelerStoryView = { ...LOCKED, unlocked: true, hint: null };
const DONE: TravelerStoryView = { ...UNMET, met: true, done: true };

function onQuest(index: number, ready: boolean, questBlocked = false): TravelerStoryView {
  return { ...UNMET, met: true, ready, questBlocked, quest: { index, total: 3, title: "", objectives: [] } };
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
        // A gated quest (StoryQuest.requires) also gets a `.blocked` node.
        if (quest.requires !== undefined) {
          expect(STORY_DIALOGUE.has(`${quest.id}.blocked`)).toBe(true);
          expected += 1;
        }
      }
    }
    expect(STORY_DIALOGUE.size).toBe(expected);
  });

  it("gives every node a speaker, a line, a haptic tick and a way out", () => {
    const questById = new Map(ALL_STORY_QUESTS.map((quest) => [quest.id, quest]));
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
      // A `.done` node with 2+ rewards gets one committing choice per reward
      // instead of the usual single one; every other node still commits at
      // most once. No remaining quest (Ray, Pierre, Ivy) offers 2+ rewards,
      // so `rewardCount` is always 0 here -- the multi-reward shape is still
      // exercised by dialogue.ts's own buildNodes() logic, just not by real
      // content since the eight travelers whose quests used it left with the
      // six districts (../travelers.ts's own header).
      const questId = node.id.endsWith(".done") ? node.id.slice(0, -".done".length) : null;
      const rewardCount = questId !== null ? (questById.get(questId)?.rewards?.length ?? 0) : 0;
      const expectedCommitting = node.onComplete === null ? 0 : Math.max(1, rewardCount);
      expect(committing.length).toBe(expectedCommitting);
      expect(committing.every((choice) => choice.reward === undefined)).toBe(true);
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
    expect(storyNode("pierre.q1.done").choices[0].reward).toBeUndefined();
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
    expect(dialogueNodeFor("ray", LOCKED).id).toBe("ray.locked");
    expect(dialogueNodeFor("ray", UNMET).id).toBe("ray.hello");
    expect(dialogueNodeFor("ray", onQuest(0, false)).id).toBe("ray.q1.progress");
    expect(dialogueNodeFor("ray", onQuest(0, true)).id).toBe("ray.q1.done");
    expect(dialogueNodeFor("ray", onQuest(2, true)).id).toBe("ray.q3.done");
    expect(dialogueNodeFor("ray", DONE).id).toBe("ray.home");
  });

  it("returns the shared node object, so identity tracks the beat", () => {
    expect(dialogueNodeFor("ivy", onQuest(1, false))).toBe(dialogueNodeFor("ivy", onQuest(1, false)));
  });

  it("shows the blocked line for a gated quest, even once its objective is ready", () => {
    // Index 3 is ray.q4, the one real quest with a `requires` today.
    expect(dialogueNodeFor("ray", onQuest(3, false, true)).id).toBe("ray.q4.blocked");
    expect(dialogueNodeFor("ray", onQuest(3, true, true)).id).toBe("ray.q4.blocked");
    expect(dialogueNodeFor("ray", onQuest(3, true, false)).id).toBe("ray.q4.done");
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
