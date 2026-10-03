/**
 * The traveler keepsakes: what finishing a traveler's line hands the
 * player. Same posture as friendship.ts's KEEPSAKE_ITEMS. Never Gold-valued, never sold by Ray, never tradeable, never swept
 * by a harvest. stackacres-service.ts pins Gold to exactly four credit sites
 * and a story reward is not a fifth.
 *
 * SHRUNK 2026-09-28: the eight items below belonged to the eight travelers
 * removed with the six districts they stood in (../travelers.ts's own
 * header). Ray's, Pierre's and Ivy's are all that remain.
 */

export const STORY_ITEM_IDS = ["rays_heritage_cap", "liquid_chowder_bowl", "hyperdense_square_seeds"] as const;

export type StoryItemId = (typeof STORY_ITEM_IDS)[number];

export function isStoryItemId(value: unknown): value is StoryItemId {
  return typeof value === "string" && (STORY_ITEM_IDS as readonly string[]).includes(value);
}

export interface StoryItemDef {
  label: string;
  /** Shown once it is held. Before that the UI shows "???", the same
   *  treatment an unclaimed keepsake gets. */
  blurb: string;
  /** A plain emoji, only ever drawn in a dialogue's own chrome. */
  icon: string;
}

export const STORY_ITEM_CATALOGUE: Readonly<Record<StoryItemId, StoryItemDef>> = {
  rays_heritage_cap: {
    label: "Ray's Heritage Cap",
    blurb: "Sun-faded and sweat-stained. He wore it every day he worked this land, and he says it fits you.",
    icon: "🧢",
  },
  liquid_chowder_bowl: {
    label: "Liquid Chowder Bowl",
    blurb: "Never empties, never cools. Pierre insists the recipe was a rendering bug and refuses to fix it.",
    icon: "🍲",
  },
  hyperdense_square_seeds: {
    label: "Hyperdense Square Seeds",
    blurb: "Ivy's proudest cross. Each one is a perfect square and refuses to explain how.",
    icon: "🌱",
  },
};
