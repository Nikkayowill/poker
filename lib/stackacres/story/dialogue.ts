/**
 * The narrative database: every line every traveler says, keyed by node
 * id, and the one function that picks which node a tap should open.
 *
 * A node is what the bubble renders: who is speaking, the line, the haptic
 * tick to play on open, the buttons, and the intent a committing button
 * posts. The intent is the WHOLE payload. A node never names an item, a
 * Gold amount, or a counter to change; the server decides all of that
 * when it runs the intent (see ./state.ts), and the bubble re-renders off
 * whatever view comes back.
 *
 * Node ids follow the quest ids in ./quests.ts:
 *
 *   <traveler>.locked      tapped before their unlock is met
 *   <traveler>.hello       first contact; commits story-meet
 *   <traveler>.q<n>.progress      a flat quest, open, not yet satisfied
 *   <traveler>.q<n>.s<i>.progress a segmented quest's checkpoint i, active
 *   <traveler>.q<n>.blocked       quest open, but its own requires isn't met
 *   <traveler>.q<n>.done       quest satisfied; commits story-turn-in
 *   <traveler>.home        the whole line is finished
 *
 * The scripts are checked against TRAVELER_QUESTS at module load: a
 * traveler with two quests and three scripted beats throws here rather
 * than showing the wrong line later.
 */

import { STORY_ITEM_CATALOGUE, type StoryItemId } from "./items";
import { TRAVELER_QUESTS, questSegments, type StoryQuest } from "./quests";
import type { TravelerStoryView } from "./state";
import { TRAVELER_CATALOGUE, TRAVELER_IDS, type PortraitExpression, type TravelerId } from "./travelers";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type StoryIntent =
  | { readonly action: "story-meet"; readonly traveler: TravelerId }
  | { readonly action: "story-turn-in"; readonly traveler: TravelerId; readonly reward?: StoryItemId };

export interface StoryChoice {
  readonly label: string;
  /** True for the button that posts `onComplete`. False only closes. */
  readonly commits: boolean;
  /** Only set on a turn-in choice offering 2+ rewards -- the reward THIS
   *  button commits, merged into `onComplete` when chosen. Absent on every
   *  other choice, including a turn-in with 0 or 1 reward. */
  readonly reward?: StoryItemId;
}

export interface StoryDialogueNode {
  readonly id: string;
  readonly speakerName: string;
  readonly dialogueText: string;
  /** navigator.vibrate pattern played when the bubble opens. */
  readonly vibratePattern: readonly number[];
  readonly choices: readonly StoryChoice[];
  /** Posted when a committing choice is taken. Null for a node that only closes. */
  readonly onComplete: StoryIntent | null;
}

/** The face a traveler's portrait wears for a node: glad to see you, weighing a task up, pleased it's done. */
export function portraitExpression(node: Pick<StoryDialogueNode, "id">): PortraitExpression {
  if (node.id.endsWith(".hello") || node.id.endsWith(".done")) return "happy";
  if (node.id.endsWith(".progress") || node.id.endsWith(".locked")) return "thinking";
  return "neutral";
}

/** Short ticks, not buzzes. A bubble opening is a tap, not an alarm. */
export const HAPTIC_TICK: readonly number[] = [10];
export const HAPTIC_DOUBLE: readonly number[] = [10, 30, 10];
export const HAPTIC_FANFARE: readonly number[] = [20, 40, 20, 40, 40];

/** The progress node id for a quest at a given checkpoint: `${quest.id}.s${i}.progress`
 *  for a segmented quest, or the flat `${quest.id}.progress` otherwise.
 *  `segmentIndex` is ignored for a flat quest. Pure, so a synthetic quest
 *  fixture exercises this without touching TRAVELER_QUESTS or SCRIPTS. */
export function questProgressNodeId(quest: StoryQuest, segmentIndex: number): string {
  return questSegments(quest) === null ? `${quest.id}.progress` : `${quest.id}.s${segmentIndex}.progress`;
}

/* ------------------------------------------------------------------ */
/* Scripts                                                             */
/* ------------------------------------------------------------------ */

interface QuestBeats {
  /** A flat quest's one progress line. Exactly one of this and `segments`
   *  is set, matching the quest's own shape -- buildNodes() throws otherwise. */
  readonly progress?: string;
  /** A segmented quest's progress line per checkpoint, same length and
   *  order as `StoryQuest.segments`. */
  readonly segments?: readonly string[];
  readonly done: string;
  /** Required exactly when the quest declares `requires` -- what the
   *  traveler says while its objectives may already be done but its own
   *  gate (a friendship level, another traveler's line) isn't yet. */
  readonly blocked?: string;
}

interface TravelerScript {
  readonly locked: string;
  readonly hello: string;
  readonly quests: readonly QuestBeats[];
  readonly home: string;
}

const SCRIPTS: Readonly<Record<TravelerId, TravelerScript>> = {
  ray: {
    locked: "Take your time, kid. I've got nowhere to be.",
    hello:
      "There you are. This was my land before it was yours, and it'll hold you the same way it held me. I can't lift a spade anymore, but I can still tell you where to put one. Shall we start?",
    quests: [
      {
        progress:
          "Get some water on those beds by the house. The ground here is stubborn until it's wet, then it'll give you anything.",
        done: "Look at that. Water down, seed in. That's the first honest day's work this place has seen in a long while.",
      },
      {
        progress:
          "Wheat's only wheat until you grind it. Put up a feed grinder in the workshop and run a batch through. You'll want timber off those trees first.",
        done: "Flour. Some weeks it pays to grind it, some weeks the elevator pays better for the grain. You'll learn which.",
      },
      {
        progress: "Now let it grow. Ten of anything, doesn't matter what. A farm is patience with a fence around it.",
        done: "A full basket. You've got the hands for this. I always figured you would.",
      },
      {
        progress:
          "The town posts what it wants on the board by the road. Fill one of their orders. That's how they learn your name out here.",
        done: "Word travels. They'll ask for you by name now. Here, take my cap. It's kept the sun off this family for a long time.",
        blocked:
          "Slow down, kid. I don't hand a body my name until I know them a little. Come around more, we'll get there.",
      },
    ],
    home: "Go on and see to your guests. Strange folk, but lost is lost, and we've always kept a door open here.",
  },
  pierre: {
    locked: "Non non, not yet. Ze kitchen is not ready, and neither, I think, are you.",
    hello:
      "Zut! Zis potato has DIRT on it. In my kitchen a potato is four pixels and appears when you press A. Bring me real ones, and carrots, and I will test my glitched recipes on them.",
    quests: [
      {
        progress: "Five potatoes, five carrots. Do not wash them, I wish to study ze dirt.",
        done: "Magnifique. Zey are lumpy. Zey are imperfect. I have never been so happy.",
      },
      {
        progress:
          "Now, ze Workshop. Bake me one cake. In my world a cake is a single sprite and it never rises. I need to see one rise.",
        done: "It ROSE. It has crumb. Take zis bowl, it never empties, a bug I have decided is a feature.",
      },
    ],
    home: "I am opening a bistro in ze square when I get home. Ze menu will have dirt on it.",
  },
  ivy: {
    locked: "Not yet! My nursery grid's not initialised and neither is your farm.",
    hello:
      "Ivy. I programmed a nursery where every seed was a tidy square and every plant was a lookup table. Ray's crops don't follow ANY table. I need to see how they really grow.",
    quests: [
      {
        progress: "Bring in twelve crops. Any kind. I just want to see an outcome I didn't write.",
        done: "That's not in my table. That's not in ANY table. This is the best day of my career.",
      },
      {
        progress: "Now water twenty of them. I'm building a new table from scratch and I need the data.",
        done: "Table's done and it's beautiful and it's wrong in six places. Take these seeds. Perfect squares. Don't ask me how.",
      },
    ],
    home: "I'm going home to delete my old nursery. Everything in it was too tidy.",
  },
};

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

const CLOSE_ONLY = (label: string): readonly StoryChoice[] => [{ label, commits: false }];

function buildNodes(): ReadonlyMap<string, StoryDialogueNode> {
  const nodes = new Map<string, StoryDialogueNode>();
  for (const id of TRAVELER_IDS) {
    const script = SCRIPTS[id];
    const quests = TRAVELER_QUESTS[id];
    if (script.quests.length !== quests.length) {
      throw new Error(`${id}: ${script.quests.length} scripted quests for ${quests.length} defined`);
    }
    const speakerName = TRAVELER_CATALOGUE[id].name;
    const put = (node: StoryDialogueNode) => nodes.set(node.id, node);

    put({
      id: `${id}.locked`,
      speakerName,
      dialogueText: script.locked,
      vibratePattern: HAPTIC_TICK,
      choices: CLOSE_ONLY("Leave them be"),
      onComplete: null,
    });
    put({
      id: `${id}.hello`,
      speakerName,
      dialogueText: script.hello,
      vibratePattern: HAPTIC_DOUBLE,
      choices: [
        { label: "I'll help", commits: true },
        { label: "Not now", commits: false },
      ],
      onComplete: { action: "story-meet", traveler: id },
    });
    quests.forEach((quest, i) => {
      const beats = script.quests[i];
      const gated = quest.requires !== undefined;
      if (gated !== (beats.blocked !== undefined)) {
        throw new Error(`${quest.id}: ${gated ? "needs" : "must not have"} a scripted "blocked" beat`);
      }
      if (beats.blocked !== undefined) {
        put({
          id: `${quest.id}.blocked`,
          speakerName,
          dialogueText: beats.blocked,
          vibratePattern: HAPTIC_TICK,
          choices: CLOSE_ONLY("Understood"),
          onComplete: null,
        });
      }
      const segments = questSegments(quest);
      if (segments === null) {
        if (beats.progress === undefined) {
          throw new Error(`${quest.id}: flat quest needs a "progress" beat, not "segments"`);
        }
        put({
          id: questProgressNodeId(quest, 0),
          speakerName,
          dialogueText: beats.progress,
          vibratePattern: HAPTIC_TICK,
          choices: CLOSE_ONLY("On it"),
          onComplete: null,
        });
      } else {
        if (beats.segments === undefined || beats.segments.length !== segments.length) {
          throw new Error(`${quest.id}: ${segments.length} segments need that many scripted "segments" beats`);
        }
        segments.forEach((_segment, segmentIndex) => {
          put({
            id: questProgressNodeId(quest, segmentIndex),
            speakerName,
            dialogueText: (beats.segments as readonly string[])[segmentIndex],
            vibratePattern: HAPTIC_TICK,
            choices: CLOSE_ONLY("On it"),
            onComplete: null,
          });
        });
      }
      const rewardChoices = quest.rewards ?? [];
      put({
        id: `${quest.id}.done`,
        speakerName,
        dialogueText: beats.done,
        vibratePattern: i === quests.length - 1 ? HAPTIC_FANFARE : HAPTIC_DOUBLE,
        choices:
          rewardChoices.length >= 2
            ? [
                ...rewardChoices.map((reward) => ({
                  label: `${quest.turnInLabel} -- take the ${STORY_ITEM_CATALOGUE[reward].label}`,
                  commits: true,
                  reward,
                })),
                { label: "Not yet", commits: false },
              ]
            : [
                { label: quest.turnInLabel, commits: true },
                { label: "Not yet", commits: false },
              ],
        onComplete: { action: "story-turn-in", traveler: id },
      });
    });
    put({
      id: `${id}.home`,
      speakerName,
      dialogueText: script.home,
      vibratePattern: HAPTIC_TICK,
      choices: CLOSE_ONLY("Take care"),
      onComplete: null,
    });
  }
  return nodes;
}

export const STORY_DIALOGUE: ReadonlyMap<string, StoryDialogueNode> = buildNodes();

/** A node by id. Throws rather than returning a placeholder line. */
export function storyNode(id: string): StoryDialogueNode {
  const node = STORY_DIALOGUE.get(id);
  if (node === undefined) throw new Error(`no story dialogue node: ${id}`);
  return node;
}

/** Which node a tap on `id` opens, given what the view says about them. */
export function dialogueNodeFor(id: TravelerId, traveler: TravelerStoryView): StoryDialogueNode {
  if (!traveler.unlocked) return storyNode(`${id}.locked`);
  if (!traveler.met) return storyNode(`${id}.hello`);
  if (traveler.done || traveler.quest === null) {
    return storyNode(`${id}.home`);
  }
  const quest = TRAVELER_QUESTS[id][traveler.quest.index];
  if (traveler.questBlocked) return storyNode(`${quest.id}.blocked`);
  if (traveler.ready) return storyNode(`${quest.id}.done`);
  return storyNode(questProgressNodeId(quest, traveler.quest.segmentIndex ?? 0));
}
