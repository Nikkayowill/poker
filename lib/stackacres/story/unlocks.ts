/**
 * When a traveler is willing to talk to the player at all.
 *
 * DERIVED, NEVER STORED, the same rule ../shop-locks.ts sets for Ray's
 * shelf: every gate is read off permanent facts the farm already keeps.
 * There is no story level column. "Level" here is the shop's own milestone
 * ladder plus one, so a player who reads "Requires: Fill an order for the
 * town" in the supply store and in a traveler's bubble is being told the
 * same thing by the same code.
 *
 * Pure. The server decides whether a `story-meet` intent is allowed, the
 * client renders the same functions so the greyed-out traveler and the
 * refusal can never disagree.
 */

import {
  STACKACRES_MAX_MILESTONE,
  STACKACRES_QUEST_LABELS,
  nextStackAcresMilestone,
  stackacresMilestone,
  stackacresQuestFlags,
  type StackAcresQuestFlag,
  type StackAcresShopProgress,
} from "../shop-locks";
import type { TravelerId } from "./travelers";

export type StoryUnlock =
  /** Available from the first tap. Ray only. */
  | { readonly kind: "always" }
  /** At least this many shop milestone flags earned. */
  | { readonly kind: "milestone"; readonly count: number }
  /** One named flag earned. */
  | { readonly kind: "flag"; readonly flag: StackAcresQuestFlag }
  /** Every other traveler sent home. Leo only. */
  | { readonly kind: "finale" };

/** Everything an unlock is allowed to look at. */
export interface StoryProgress extends StackAcresShopProgress {
  /** Travelers whose whole line is done. Only the finale reads it. */
  readonly travelersHome: ReadonlySet<TravelerId>;
}

/** The highest level the farm can show. Level 1 is a fresh farm. */
export const STORY_MAX_LEVEL = 1 + STACKACRES_MAX_MILESTONE;

export function storyLevel(progress: StackAcresShopProgress): number {
  return 1 + stackacresMilestone(progress);
}

/** The spec's "Level N" as a milestone count. Level 1 asks for nothing. */
export function levelUnlock(level: number): StoryUnlock {
  if (!Number.isInteger(level) || level < 1 || level > STORY_MAX_LEVEL) {
    throw new Error(`story level out of range: ${level}`);
  }
  return level === 1 ? { kind: "always" } : { kind: "milestone", count: level - 1 };
}

export function storyUnlockMet(unlock: StoryUnlock, progress: StoryProgress, travelersInFinale: number): boolean {
  switch (unlock.kind) {
    case "always":
      return true;
    case "milestone":
      return stackacresMilestone(progress) >= unlock.count;
    case "flag":
      return stackacresQuestFlags(progress).has(unlock.flag);
    case "finale":
      return progress.travelersHome.size >= travelersInFinale;
  }
}

/**
 * What a locked traveler's bubble says is missing. Imperative, one line,
 * the same register STACKACRES_QUEST_LABELS uses. Null when nothing is.
 */
export function storyUnlockHint(unlock: StoryUnlock, progress: StoryProgress, travelersInFinale: number): string | null {
  if (storyUnlockMet(unlock, progress, travelersInFinale)) return null;
  switch (unlock.kind) {
    case "always":
      return null;
    case "milestone": {
      const next = nextStackAcresMilestone(progress);
      if (next === null) throw new Error("milestone unlock unmet with every flag earned");
      return STACKACRES_QUEST_LABELS[next];
    }
    case "flag":
      return STACKACRES_QUEST_LABELS[unlock.flag];
    case "finale":
      return "Send every other traveler home";
  }
}
