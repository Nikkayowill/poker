/**
 * The eleven traveler keepsakes: what finishing a traveler's line hands the
 * player. Same posture as friendship.ts's KEEPSAKE_ITEMS and devotion.ts's
 * relics. Never Gold-valued, never sold by Ray, never tradeable, never swept
 * by a harvest. stackacres-service.ts pins Gold to exactly four credit sites
 * and a story reward is not a fifth.
 */

export const STORY_ITEM_IDS = [
  "rays_heritage_cap",
  "liquid_chowder_bowl",
  "anomalous_scanner",
  "glitched_neon_fence",
  "deepsea_waterwheel_node",
  "aegis_plaza_token",
  "glitched_drill_bit",
  "hyperdense_square_seeds",
  "oxen_speed_harness",
  "liquid_gold_honeycomb",
  "infinite_shard_matrix",
] as const;

export type StoryItemId = (typeof STORY_ITEM_IDS)[number];

export function isStoryItemId(value: unknown): value is StoryItemId {
  return typeof value === "string" && (STORY_ITEM_IDS as readonly string[]).includes(value);
}

export interface StoryItemDef {
  label: string;
  /** Shown once it is held. Before that the UI shows "???", the same
   *  treatment an unclaimed relic or keepsake gets. */
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
  anomalous_scanner: {
    label: "Anomalous Scanner",
    blurb: "Miles's pocket detector. It beeps near the auroral seam and, for reasons he won't discuss, near the barn.",
    icon: "📟",
  },
  glitched_neon_fence: {
    label: "Glitched Neon Fence",
    blurb: "A fence post that flickers between three colours. Skye calls it a feature. It is.",
    icon: "🪩",
  },
  deepsea_waterwheel_node: {
    label: "Deepsea Waterwheel Node",
    blurb: "A brass valve from Barnaby's rig, still humming. He swears it ran a whole reef once.",
    icon: "⚙️",
  },
  aegis_plaza_token: {
    label: "Aegis Plaza Token",
    blurb: "Arthur's garrison seal, flat as a coin and heavier than it looks. Good for one honourable favour.",
    icon: "🛡️",
  },
  glitched_drill_bit: {
    label: "Glitched Drill Bit",
    blurb: "Brayden's spare bit. It cuts in perfect cubes no matter what you point it at.",
    icon: "🔩",
  },
  hyperdense_square_seeds: {
    label: "Hyperdense Square Seeds",
    blurb: "Ivy's proudest cross. Each one is a perfect square and refuses to explain how.",
    icon: "🌱",
  },
  oxen_speed_harness: {
    label: "Oxen Speed Harness",
    blurb: "Wes rigged this for a team of oxen he has never met. It fits Ray's old yoke exactly.",
    icon: "🐂",
  },
  liquid_gold_honeycomb: {
    label: "Liquid Gold Honeycomb",
    blurb: "Bea's cross-dimensional honey. It glows faintly and tastes like a warm afternoon.",
    icon: "🍯",
  },
  infinite_shard_matrix: {
    label: "Infinite Shard Matrix",
    blurb: "The beacon's spent core. Leo left it behind on purpose so the way home would stay open.",
    icon: "💠",
  },
};
