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
 *   <traveler>.q<n>.progress   quest open, not yet satisfied
 *   <traveler>.q<n>.done       quest satisfied; commits story-turn-in
 *   <traveler>.home        the whole line is finished
 *
 * The scripts are checked against TRAVELER_QUESTS at module load: a
 * traveler with two quests and three scripted beats throws here rather
 * than showing the wrong line later.
 */

import { STORY_ITEM_CATALOGUE, type StoryItemId } from "./items";
import { TRAVELER_QUESTS } from "./quests";
import type { StackAcresStoryFinale, TravelerStoryView } from "./state";
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
  if (node.id.endsWith(".finale-hint")) return "surprised";
  if (node.id.endsWith(".hello") || node.id.endsWith(".done")) return "happy";
  if (node.id.endsWith(".progress") || node.id.endsWith(".locked")) return "thinking";
  return "neutral";
}

/** Short ticks, not buzzes. A bubble opening is a tap, not an alarm. */
export const HAPTIC_TICK: readonly number[] = [10];
export const HAPTIC_DOUBLE: readonly number[] = [10, 30, 10];
export const HAPTIC_FANFARE: readonly number[] = [20, 40, 20, 40, 40];

/* ------------------------------------------------------------------ */
/* Scripts                                                             */
/* ------------------------------------------------------------------ */

interface QuestBeats {
  readonly progress: string;
  readonly done: string;
}

interface TravelerScript {
  readonly locked: string;
  readonly hello: string;
  readonly quests: readonly QuestBeats[];
  readonly home: string;
  /** Ray only -- an alternate `home` line for when he's the last one done
   *  and the finale traveler hasn't turned up yet. */
  readonly homeFinaleHint?: string;
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
          "Wheat's only wheat until you mill it. Put up a mill in the workshop and run a batch through. You'll want timber off those trees first.",
        done: "Flour. That's the whole trick of this place: nothing leaves here as the thing it grew as.",
      },
      {
        progress: "Now let it grow. Ten of anything, doesn't matter what. A farm is patience with a fence around it.",
        done: "A full basket. You've got the hands for this. I always figured you would.",
      },
      {
        progress:
          "The town posts what it wants on the board by the road. Fill one of their orders. That's how they learn your name out here.",
        done: "Word travels. They'll ask for you by name now. Here, take my cap. It's kept the sun off this family for a long time.",
      },
    ],
    home: "Go on and see to your guests. Strange folk, but lost is lost, and we've always kept a door open here.",
    /** Shown instead of `home` once every other traveler but one has gone
     *  home and that last one hasn't turned up yet -- see `dialogueNodeFor`.
     *  Points at the hidden zones without naming the odds or the item. */
    homeFinaleHint:
      "Go on and see to your guests. Though I hear there's still something buried on this land: a well, a loose board, the gear in that windmill. Might be worth a poke around before you call this place finished.",
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
  miles: {
    locked: "Not now, kid. I'm on a case, and the case is you not being ready yet.",
    hello:
      "Name's Miles. One minute I'm tailing a suspect down a rainy alley, next minute I'm standing in a field with more colours than my whole city. Something tore. I want to know where. Help me look?",
    quests: [
      {
        progress:
          "There's three spots on this farm that don't add up. A well, a loose board, a gear in the windmill. Poke at them. Tell me what you find.",
        done: "Three anomalies, all humming the same note. That's not a coincidence, that's a pattern. Good work, partner.",
      },
      {
        progress:
          "The signal's strongest under the wild growth on the edge of the property. Clear a district and let me get a look at the ground.",
        done: "Bare ground, and the trail runs right through it. Here, take the scanner. It'll tell you when you're close to the seam.",
      },
    ],
    home: "Case closed, mostly. The last page always ends at the edge of the screen. I've made my peace with that.",
  },
  skye: {
    locked: "Hold up, I'm not painting yet. Get the farm going and then we talk colour.",
    hello:
      "Yo. Skye. Where I'm from the walls repaint themselves every twelve frames, and here they just... stay. It's beautiful. I need pigment though. Real pigment. Radishes and tomatoes, grown, not spawned.",
    quests: [
      {
        progress: "Six radishes for the reds, six tomatoes for the deep ones. Don't rush them, colour that grows fast fades fast.",
        done: "Look at this red. You can't get this red from a palette, you have to grow it.",
      },
      {
        progress: "Now I need something to paint on. Two bolts of cloth from the loom. Canvas, basically.",
        done: "Done. First mural this world's ever had. Take this fence post, it flickers three colours, and no, I won't fix it.",
      },
    ],
    home: "I'm leaving the mural. Every world should have at least one wall that changes.",
  },
  barnaby: {
    locked: "Gurgle. Not yet. The oxygen bar's low and so is the tide.",
    hello:
      "Barnaby. Diver. I surfaced in your pond with my rig half-crushed and no timer ticking, which is new. There's fish in that water. Catch a few, I want to know what swims here.",
    quests: [
      {
        progress: "Three fish. Bluegill, trout, catfish, I'm not particular. Just want to see what the water holds.",
        done: "Trout! An actual trout, not a sprite that loops every eight frames. My rig's still wrecked, but my spirits aren't.",
      },
      {
        progress: "The rig needs pressure lines. Lay four irrigation tiles and I'll borrow the fittings.",
        done: "Pressure's holding. Rig's alive. Here, this waterwheel valve ran a whole reef once. It's yours now.",
      },
    ],
    home: "I'm going to miss water that doesn't count down. Look after the pond.",
  },
  arthur: {
    locked: "Hold, farmer. A knight does not treat with a land the town does not yet trust.",
    hello:
      "Arthur, of the Flat Kingdom. My realm scrolled in one direction forever, and now I find myself here, in a land that goes every way at once. I seek ground for a new garrison. It will need grain.",
    quests: [
      {
        progress: "Ten wheat, for the stores. A garrison marches on bread.",
        done: "Good grain. Heavier than ours ever was. The stores are begun.",
      },
      {
        progress: "Now the town must speak for you. Fill two of its orders and I will call this ground held.",
        done: "The town speaks for you, and so do I. Take this seal. Good for one honourable favour, whenever you need it.",
      },
    ],
    home: "The garrison stands. It is small and it has no walls, and I have never been prouder of one.",
  },
  brayden: {
    locked: "Nope. Not ready. You dig straight down without the right tools and you hit lava. Trust me.",
    hello:
      "Brayden. I dig. Or I did, until the shimmer put me next to your mine with nothing but my hands. Rocks here have curves. It's upsetting. I need iron tools.",
    quests: [
      {
        progress: "Get yourself an iron shovel. Ray's store sells them. Can't dig curved rocks with a trowel.",
        done: "That's iron. Real, non-cubic iron. Okay. Okay, we can work with this.",
      },
      {
        progress:
          "Now take it to the Sunlight Forge and put an edge on it. One enchantment. I want to see what this world does to a tool.",
        done: "It glows and it's still not a cube. Take my spare bit, cuts perfect squares no matter what you point it at.",
      },
    ],
    home: "I'm keeping one curved rock. Nobody back home is going to believe it.",
  },
  ivy: {
    locked: "Not yet! My nursery grid's not initialised and neither is your farm.",
    hello:
      "Ivy. I programmed a nursery where every seed was a tidy square and every cross was a lookup table. Ray's crops don't follow ANY table. I need to see what they do when you cross them.",
    quests: [
      {
        progress: "One harvest from the Crossbreeding Bed. Anything. I just want to see an outcome I didn't write.",
        done: "That's not in my table. That's not in ANY table. This is the best day of my career.",
      },
      {
        progress: "Three more crosses. I'm building a new table from scratch and I need the data.",
        done: "Table's done and it's beautiful and it's wrong in six places. Take these seeds. Perfect squares. Don't ask me how.",
      },
    ],
    home: "I'm going home to delete my old nursery. Everything in it was too tidy.",
  },
  wes: {
    locked: "Whoa there. Pasture's not cleared. Can't run cattle on bush.",
    hello:
      "Wes. Wrangler. My cattle had twelve polygons each and one cloud to stand under. Yours have... a lot more. I can help you run them, but first the barn needs hay.",
    quests: [
      {
        progress: "Stock the loft. Twelve servings of feed, and put six of them in front of an animal so I know it's good.",
        done: "Loft's full and the stock's eating. That's a working barn.",
      },
      {
        progress: "Now let's see them earn their keep. Eight collections. Eggs, milk, wool, whatever they give.",
        done: "Eight. Good animals. I rigged this harness for a team of oxen I never met. It fits Ray's old yoke exact.",
      },
    ],
    home: "Ranch back home has one cloud. I'm going to tell them about the rest of the sky.",
  },
  bea: {
    locked: "Buzz off, kindly. The hive isn't awake and the farm isn't ready.",
    hello:
      "Bea. My bees were three pixels each and my flowers looped forever. Your flowers don't loop. They open. I need whole fields of them near my hive, and I'll show you what the bees make of it.",
    quests: [
      {
        progress: "Bell pepper and green bean blossoms, sixteen between them. The bees aren't picky, but they are hungry.",
        done: "Sixteen blooms and the hive's singing a note I've never heard.",
      },
      {
        progress: "Keep the fields wet. Twenty waterings. Dry flowers make thin honey.",
        done: "Thick as gold and it glows. Cross-dimensional pollen does that, apparently. Take a comb. Careful, it's warm.",
      },
    ],
    home: "I'm taking a jar of your pollen home. My bees are about to become four pixels.",
  },
  leo: {
    locked: "Not yet, pilot. The others need to be home before I can chart the way for all of us.",
    hello:
      "Leo. I was on the last stage when the shimmer took me, and I've been watching you send everyone else home one at a time. There's a faster way. A beacon. Help me build it and we open the door for good.",
    quests: [
      {
        progress: "Components. Five flour, five cheese, five cloth. I know how it sounds. The beacon runs on whatever this world makes best.",
        done: "Components received. It's holding a charge. A beacon made of bread and cheese and cloth, and it's holding a charge.",
      },
      {
        progress: "Six irrigation tiles for the conduits, and one forged enchantment for the focusing core. Then we light it.",
        done: "It's lit. The whole sky's the colour of the shimmer. Everyone's going home. I'm leaving you the core, so the way stays open.",
      },
    ],
    home: "The door's open both ways now. Come visit. Bring Pierre's chowder.",
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
      put({
        id: `${quest.id}.progress`,
        speakerName,
        dialogueText: beats.progress,
        vibratePattern: HAPTIC_TICK,
        choices: CLOSE_ONLY("On it"),
        onComplete: null,
      });
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
    if (script.homeFinaleHint !== undefined) {
      put({
        id: `${id}.home.finale-hint`,
        speakerName,
        dialogueText: script.homeFinaleHint,
        vibratePattern: HAPTIC_TICK,
        choices: CLOSE_ONLY("Keep looking"),
        onComplete: null,
      });
    }
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

/**
 * Which node a tap on `id` opens, given what the view says about them.
 *
 * `finale` only changes what Ray says once he's home: with every other
 * traveler done but one, and that one not unlocked yet, he points at the
 * hidden zones instead of his usual closing line -- the only in-game nudge
 * toward Leo now that a locked traveler doesn't stand around to be tapped
 * (see `paintTravelers`/`setTravelerUnlocks` in stackacres-scene.ts).
 */
export function dialogueNodeFor(id: TravelerId, traveler: TravelerStoryView, finale: StackAcresStoryFinale): StoryDialogueNode {
  if (!traveler.unlocked) return storyNode(`${id}.locked`);
  if (!traveler.met) return storyNode(`${id}.hello`);
  if (traveler.done || traveler.quest === null) {
    if (
      id === "ray" &&
      !finale.leoUnlocked &&
      finale.travelersHome === finale.travelersNeeded - 1 &&
      STORY_DIALOGUE.has("ray.home.finale-hint")
    ) {
      return storyNode("ray.home.finale-hint");
    }
    return storyNode(`${id}.home`);
  }
  const quest = TRAVELER_QUESTS[id][traveler.quest.index];
  return storyNode(`${quest.id}.${traveler.ready ? "done" : "progress"}`);
}
