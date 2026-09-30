/**
 * The cast. Ray, Pierre and Ivy: an auroral shimmer dropped travelers onto
 * his land in East Preston, Nova Scotia, and these two stayed on the
 * Homestead itself.
 *
 * This is the identity source for the story: who each character is, where
 * they stand, when they will talk, and what finishing their line hands
 * over. Quests live in ./quests.ts, lines in ./dialogue.ts, progress in
 * ./state.ts, placement in ./placement.ts. Replaces the ten stranded
 * visitors that used to live in ../visitors.ts (art + a one-shot greeting,
 * no quests) -- that module is gone.
 *
 * SHRUNK 2026-09-28: eight travelers (Miles, Skye, Barnaby, Arthur, Brayden,
 * Wes, Bea, Leo) stood in the Fold, Cattle Pasture, Coastal Market, the
 * Ancestral Oak, the Mine and Town Square -- the six districts removed the
 * same day (see art/stackacres-td/areas/rig/, now gone). They and their
 * quests, dialogue and reward items went with those maps. Leo's departure
 * also took the whole "finale" mechanic with it (./unlocks.ts, ./state.ts):
 * it only ever gated his own arrival, and nothing else in the game reads it.
 *
 * Everyone, Ray included, is drawn on the same character rig at the same
 * quality (Kayo: "same quality and same structure as Ray") -- the old
 * isometric-era "true pixel art in a flat-vector world" visual tell, and
 * Ray as a spirit rather than a person standing near his house, are both
 * stale. He is the land's own; Pierre and Ivy are the ones the shimmer
 * dropped onto it.
 */

import type { StoryItemId } from "./items";
import { levelUnlock, type StoryUnlock } from "./unlocks";

export const TRAVELER_IDS = ["ray", "pierre", "ivy"] as const;

export type TravelerId = (typeof TRAVELER_IDS)[number];

export function isTravelerId(value: unknown): value is TravelerId {
  return typeof value === "string" && (TRAVELER_IDS as readonly string[]).includes(value);
}

export interface TravelerDef {
  /** The name shown as the bubble's speaker. */
  readonly name: string;
  /** One-line role, shown under the name. */
  readonly title: string;
  /** Where they came from, in their own idiom. Shown on first contact. */
  readonly origin: string;
  readonly unlock: StoryUnlock;
  /** Granted once their last quest turns in. */
  readonly reward: StoryItemId;
}

export const TRAVELER_CATALOGUE: Readonly<Record<TravelerId, TravelerDef>> = {
  ray: {
    name: "Ray",
    title: "The Pioneer",
    origin: "East Preston, Nova Scotia. Built the house himself, raised heritage stock, broke the ground with a team of oxen.",
    unlock: levelUnlock(1),
    reward: "rays_heritage_cap",
  },
  pierre: {
    name: "Chef Pierre",
    title: "The Retro Cook",
    origin: "A four-colour kitchen where every dish was a sprite and nothing ever went cold.",
    unlock: levelUnlock(2),
    reward: "liquid_chowder_bowl",
  },
  ivy: {
    name: "Botanist Ivy",
    title: "The Nursery Programmer",
    origin: "A greenhouse simulation where every seed was a tidy square and every cross was a lookup table.",
    unlock: levelUnlock(4),
    reward: "hyperdense_square_seeds",
  },
};

export type PortraitExpression = "neutral" | "happy" | "sad" | "surprised" | "thinking" | "love";

/** A traveler's 64x64 dialogue portrait in one expression, drawn by art/stackacres-td/rich/portraits.py
 *  and exported by rich/export_rich.py. */
export function travelerPortrait(id: TravelerId, expression: PortraitExpression): string {
  return `/stackacres-td/portraits/${id}-${expression}.png`;
}

/** Each traveler's neutral portrait. */
export const TRAVELER_PORTRAIT: Readonly<Record<TravelerId, string>> = Object.fromEntries(
  TRAVELER_IDS.map((id) => [id, travelerPortrait(id, "neutral")]),
) as Record<TravelerId, string>;
