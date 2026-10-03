/**
 * The Farm Planner's one objective: the Journal's top line, turned into
 * something the player can act on without opening a sheet.
 *
 * BUILT ON THE JOURNAL, NOT BESIDE IT. ./journal.ts already decides what
 * matters most right now -- its `JournalCueKind` ladder is the priority
 * order, `journalCue` picks the winner, and `journalChapters`/./build-cost.ts
 * already know what the next building costs and where each material comes
 * from. This module adds the three things that ladder does not carry, because
 * the Journal is a sheet and this is a panel pinned over the map:
 *
 *   1. A title and a reason, separated, so a panel can lead with the
 *      objective and put the "why it matters" underneath it.
 *   2. The full requirement table -- every line, met or not, with where a
 *      short one comes from -- rather than the single worst line the Journal's
 *      one-sentence cue has room for.
 *   3. A typed destination, so the panel can put a real button on it instead
 *      of a place chip the player has to go and find.
 *
 * There is NO second priority ladder and NO second set of numbers: this reads
 * `view.now.kind` and answers for whichever rung the Journal already chose.
 * Change the ladder in ./journal.ts and this follows.
 *
 * NOTHING IS AUTHORED HERE beyond wording. Every quantity comes from the
 * catalogue that owns it (./build-cost.ts for a building, the contract row
 * for a town order, the quest view for a traveler), and every "where does it
 * come from" line is ./build-cost.ts's own `BuildLine.source` -- so a retune
 * anywhere moves this panel with it.
 *
 * IT NEVER NAMES SOMETHING THAT CANNOT BE DONE. That falls out of reusing the
 * Journal: `candidateCues` only pushes a cue the farm can truthfully show,
 * `nextReachableStackAcresMilestone` already skips any flag behind a
 * wall (./shop-locks.ts's `STACKACRES_UNREACHABLE_FLAGS`), and a locked
 * traveler is never a caller. The one thing added here is the same care about
 * DESTINATIONS: a rung whose work happens on the map in front of the player
 * (a dry bed, a ripe crop, a hungry animal) gets no button rather than a
 * button to somewhere unrelated.
 *
 * Pure, and derived from the same snapshot the Journal is. No clock of its
 * own, no store, nothing that moves Gold.
 */

import type { BuildLine } from "./build-cost";
import { machineItemLabel } from "./machine-items";
import type { MapPlaceId } from "./map-places";
import { SEED_SELLER_WHERE } from "./seed-seller";
import {
  STACKACRES_QUEST_LABELS,
  nextReachableStackAcresMilestone,
  type StackAcresQuestFlag,
} from "./shop-locks";
import type {
  JournalCueKind,
  JournalInput,
  JournalStep,
  JournalView,
} from "./journal";

/* ------------------------------------------------------------------ */
/* Where the button goes                                               */
/* ------------------------------------------------------------------ */

/**
 * A screen or a place the objective can send the player to.
 *
 * Named rather than passed as a callback so this module stays a pure leaf --
 * the farm screen owns every sheet and the camera, and it is the only thing
 * that can act on one of these.
 */
export type NextActionTarget =
  | { readonly kind: "workshop" }
  | { readonly kind: "house" }
  | { readonly kind: "contracts" }
  | { readonly kind: "travel"; readonly place: MapPlaceId };

export interface NextActionButton {
  /** "Open Workshop", "Go to the Crop Fields". */
  readonly label: string;
  readonly target: NextActionTarget;
}

/* ------------------------------------------------------------------ */
/* The objective                                                       */
/* ------------------------------------------------------------------ */

/** One thing the objective is waiting on, and how close it is. */
export interface NextActionRequirement {
  /** "Gold", "Wood", or a quest objective's own line. Already singular or
   *  plural to match `need`. */
  readonly label: string;
  readonly have: number;
  readonly need: number;
  /** Where to get more, when this line is short. Null when it is met, and
   *  null for a line that is a thing the player does rather than a thing they
   *  hold -- a quest objective's label already says what to do. */
  readonly source: string | null;
}

export interface NextAction {
  /**
   * Stable for as long as the objective is the same piece of work, and
   * different the moment it is not -- which is how the panel tells "the bar
   * moved" from "this is a new objective". Built from the cue and the thing
   * itself (`build:mill`), never from a counter, so chopping two more Wood
   * does not read as a new objective.
   */
  readonly id: string;
  /** Which rung of ./journal.ts's ladder this came off. */
  readonly cue: JournalCueKind;
  /** "Build the Mill". One line. */
  readonly title: string;
  /** Why it is worth doing, in terms of what it opens up. */
  readonly why: string;
  /** Every line, met or not, worst shortfall first. Empty for an objective
   *  that only needs doing. */
  readonly requirements: readonly NextActionRequirement[];
  /** Null when the work happens on the map rather than behind a door. */
  readonly button: NextActionButton | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function byShortfall(a: NextActionRequirement, b: NextActionRequirement): number {
  return a.have / a.need - b.have / b.need;
}

/** Cost lines as panel requirements. A met line needs no "where to get it". */
function requirementsFrom(lines: readonly BuildLine[]): NextActionRequirement[] {
  return lines
    .map((line) => ({
      label: line.label,
      have: line.have,
      need: line.need,
      source: line.met ? null : line.source,
    }))
    .sort(byShortfall);
}

/** The room a building goes up in, as a button. ./build-cost.ts's
 *  `BuildPlace` is the only thing that decides this, so the panel and the
 *  Journal's own place chip can never disagree. */
function roomButton(place: "Workshop" | "House"): NextActionButton {
  return place === "Workshop"
    ? { label: "Open Workshop", target: { kind: "workshop" } }
    : { label: "Open your kitchen", target: { kind: "house" } };
}

/** The build objective, shared by the `build` and `gather` rungs: the same
 *  work either way, the difference being only whether it is affordable yet. */
function buildAction(cue: JournalCueKind, step: JournalStep, chapterBlurb: string): NextAction {
  return {
    id: `${cue}:${step.kind}`,
    cue,
    title: `Build the ${step.name}`,
    why: step.opens ? `${chapterBlurb} ${step.opens}.` : chapterBlurb,
    requirements: requirementsFrom(step.lines),
    button: roomButton(step.place),
  };
}

/** The town order, whichever side of fillable it is on. */
function contractAction(
  cue: JournalCueKind,
  input: JournalInput,
  held: number,
): NextAction | null {
  const { contract } = input;
  if (!contract) return null;
  const goods = machineItemLabel(contract.item, contract.quantity);
  return {
    id: `${cue}:${contract.id}`,
    cue,
    title: `Deliver the town's order for ${goods}`,
    why: `It pays ${contract.goldReward.toLocaleString()} Gold and ${contract.influenceReward.toLocaleString()} Town Influence, and clears the board for the next order.`,
    requirements:
      held >= contract.quantity
        ? []
        : [{ label: goods, have: held, need: contract.quantity, source: null }],
    button: { label: "Open Town Board", target: { kind: "contracts" } },
  };
}

/** The Crop Fields are the one milestone flag with a place on the map. The
 *  other reachable flag is a town order, which the Town Board answers. */
const FLAG_BUTTON: Partial<Record<StackAcresQuestFlag, NextActionButton>> = {
  crop_fields_unlocked: {
    label: "Go to the Crop Fields",
    target: { kind: "travel", place: "cropfields" },
  },
  town_trusted: { label: "Open Town Board", target: { kind: "contracts" } },
};

/* ------------------------------------------------------------------ */
/* The answer                                                          */
/* ------------------------------------------------------------------ */

/**
 * One objective, or null when the Journal itself has nothing pressing to say
 * (its `idle` rung) -- at which point the panel shows nothing rather than
 * inventing an errand.
 *
 * Takes the same `input` the Journal was built from plus the `view` it
 * produced, mirroring `journalCue(input, chapters)`'s own shape: the view
 * carries the decision and the derived blocks, the input carries the couple of
 * raw rows (the contract, the story) whose own numbers the panel quotes.
 */
export function nextAction(input: JournalInput, view: JournalView): NextAction | null {
  const cue = view.now.kind;

  switch (cue) {
    case "hungry":
      return {
        id: "hungry",
        cue,
        // No button: feeding happens on the animal in front of you, so there
        // is no door to open. See the header on why a rung whose work is on
        // the map gets none rather than a door to somewhere else.
        title: "Feed the animals that have gone hungry",
        why: "A hungry animal stops its cycle, and a hungry hen loses that cycle outright.",
        requirements: [],
        button: null,
      };

    case "collect": {
      // `buildingCues` sets the cue's own `where` to a `BuildPlace`, so the
      // door the panel opens is the door the Journal already named.
      const room = view.now.where === "Workshop" ? "Workshop" : "House";
      return {
        id: `collect:${room}`,
        cue,
        title: room === "Workshop" ? "Take what's finished in the Workshop" : "Take what's finished in the kitchen",
        why: view.now.line,
        requirements: [],
        button: roomButton(room),
      };
    }

    case "contract":
      return contractAction(cue, input, heldForContract(input));

    case "ship":
      return {
        id: "ship",
        cue,
        title: "Sell your animals to Hank",
        why: "Hank at the sale barn pays for each hog and steer by its weight. Feed them well first and they fetch more.",
        requirements: [],
        button: { label: "Go to the City", target: { kind: "travel", place: "city" } },
      };

    case "harvest":
      return {
        id: "harvest",
        cue,
        title: "Bring in what's ready",
        why: "Finished crops and animals sit there until you take them, and nothing new goes in until they are out.",
        requirements: [],
        button: null,
      };

    case "water": {
      const canEmpty = input.water !== undefined && input.water < 1;
      return {
        id: canEmpty ? "water:fill" : "water",
        cue,
        title: canEmpty ? "Fill your can at the well" : "Water the beds that have gone dry",
        why: canEmpty
          ? "The can is empty, and a dry bed stops growing altogether. Tap the well, then water the beds."
          : "A dry bed stops growing altogether, and the time it stands dry is never credited back.",
        requirements: [],
        button: null,
      };
    }

    case "sow": {
      const wheat = (input.seedStock.wheat ?? 0) > 0;
      return {
        id: "sow",
        cue,
        title: wheat ? "Plant your wheat" : "Plant your seed",
        why: wheat
          ? "Wheat is the first crop on the farm. It grows while you chop, and the Feed Grinder turns it into flour."
          : "Hoe a bed on the grass by the house, sow the seed and water it from the well.",
        requirements: [],
        button: null,
      };
    }

    case "seeds":
      return {
        id: "seeds",
        cue,
        title: "Buy seed from Cora",
        why: `Cora sells seed at ${SEED_SELLER_WHERE}. Every crop you grow starts there.`,
        requirements: [],
        button: { label: "Go to the City", target: { kind: "travel", place: "city" } },
      };

    case "build":
    case "gather": {
      const chapter = view.currentChapter;
      const step = chapter?.steps.find((candidate) => !candidate.built);
      if (!chapter || !step) return null;
      return buildAction(cue, step, chapter.blurb);
    }

    case "caller": {
      const caller =
        view.callers.find((candidate) => candidate.state === "ready") ??
        view.callers.find((candidate) => candidate.state === "waiting");
      if (!caller) return null;
      const quest = input.story?.travelers[caller.traveler].quest ?? null;
      return {
        id: `caller:${caller.traveler}:${caller.state}`,
        cue,
        title:
          caller.state === "ready" && caller.detail
            ? `Take "${caller.detail}" back to ${caller.name}`
            : `Talk to ${caller.name}`,
        why: view.now.line,
        // A quest that is ready has nothing outstanding; one that is not is
        // not this rung (the Journal's `caller` cue only fires for ready or
        // unmet). The objectives are still listed when they exist, so the
        // panel can show what was asked for.
        requirements:
          quest === null
            ? []
            : quest.objectives.map((objective) => ({
                label: objective.label,
                have: objective.have,
                need: objective.need,
                source: null,
              })),
        // Travelers live on the Homestead, which is the only place the panel shows, so they are already
        // in sight and a button to travel there would go nowhere.
        button: null,
      };
    }

    case "reach": {
      const flag = nextReachableStackAcresMilestone(input.progress);
      if (flag === null) return null;
      const rung = view.reach.find((step) => step.flag === flag) ?? null;
      const opens = [...(rung?.brings ?? []), ...view.nextMilestoneOpens];
      return {
        id: `reach:${flag}`,
        cue,
        title: STACKACRES_QUEST_LABELS[flag],
        why:
          opens.length > 0
            ? `It raises your Standing, which opens ${opens.join(", ")}.`
            : "It raises your Standing, and another rung of Ray's shelf with it.",
        requirements: requirementsFrom(rung?.lines ?? []),
        button: FLAG_BUTTON[flag] ?? null,
      };
    }

    case "idle":
      return null;
  }
}

/** How much of the open order's good is on the shelf. Zero when there is no
 *  order, which never reaches a caller: the `contract` rung only fires with
 *  one open. */
function heldForContract(input: JournalInput): number {
  const { contract } = input;
  if (!contract) return 0;
  return input.inventory[contract.item] ?? 0;
}

/* ------------------------------------------------------------------ */
/* What the panel reads off it                                         */
/* ------------------------------------------------------------------ */

/** Everything still short, worst first. What the "Missing" line reads, and
 *  empty for an objective that only needs doing. */
export function missingRequirements(
  action: NextAction,
): readonly NextActionRequirement[] {
  return action.requirements.filter((requirement) => requirement.have < requirement.need);
}

/** Whether nothing is in the objective's way, so it is down to one action.
 *  True for an objective with no requirements at all. */
export function isActionable(action: NextAction): boolean {
  return missingRequirements(action).length === 0;
}

/** "8 Wood, 20 Gold" -- the missing side of the objective in one line. Null
 *  when nothing is missing. */
export function missingSummary(action: NextAction): string | null {
  const missing = missingRequirements(action);
  if (missing.length === 0) return null;
  return missing
    .map((requirement) => `${(requirement.need - requirement.have).toLocaleString()} ${requirement.label}`)
    .join(", ");
}

/**
 * How close the objective is, 0..1, as the WORST of its lines.
 *
 * The worst rather than the sum, exactly like ./journal.ts's own
 * `buildReadiness`: a building with all its Gold and none of its Wood is not
 * half done, it is stuck on the Wood, and a bar that reads half-full there is
 * the bug that helper exists to avoid. An objective with no requirements
 * reads as full -- there is nothing in the way of it -- rather than dividing
 * by nothing.
 */
export function actionProgress(action: NextAction): number {
  return action.requirements.reduce(
    (worst, requirement) =>
      Math.min(worst, requirement.need === 0 ? 1 : Math.min(1, Math.max(0, requirement.have) / requirement.need)),
    1,
  );
}
