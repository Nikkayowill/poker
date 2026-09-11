/**
 * The cast. Ray, and the ten travelers an auroral shimmer dropped onto his
 * land in East Preston, Nova Scotia.
 *
 * This is the identity source for the story: who each character is, where
 * they stand, when they will talk, and what finishing their line hands
 * over. Quests live in ./quests.ts, lines in ./dialogue.ts, progress in
 * ./state.ts, placement in ./placement.ts. Replaces the ten stranded
 * visitors that used to live in ../visitors.ts (art + a one-shot greeting,
 * no quests) -- that module is gone.
 *
 * The ten travelers are true pixel art in a flat-vector world, and they can
 * tell. That mismatch is the visual tell that they are not from here, the
 * same premise the retired visitors carried. Ray is not one of them. He is
 * the land's own, drawn as a spirit standing near his house.
 */

import type { ZoneId } from "../zones";
import type { StoryItemId } from "./items";
import { levelUnlock, type StoryUnlock } from "./unlocks";

export const TRAVELER_IDS = [
  "ray",
  "pierre",
  "miles",
  "skye",
  "barnaby",
  "arthur",
  "brayden",
  "ivy",
  "wes",
  "bea",
  "leo",
] as const;

export type TravelerId = (typeof TRAVELER_IDS)[number];

export function isTravelerId(value: unknown): value is TravelerId {
  return typeof value === "string" && (TRAVELER_IDS as readonly string[]).includes(value);
}

/** Everyone but Leo. His own gate counts the rest. */
export const TRAVELERS_IN_FINALE = TRAVELER_IDS.length - 1;

export interface TravelerDef {
  /** The name shown as the bubble's speaker. */
  readonly name: string;
  /** One-line role, shown under the name. */
  readonly title: string;
  /** Where they came from, in their own idiom. Shown on first contact. */
  readonly origin: string;
  /** Which district they stand in. The exact spot is the scene's job. */
  readonly zone: ZoneId;
  readonly unlock: StoryUnlock;
  /** Granted once their last quest turns in. */
  readonly reward: StoryItemId;
}

export const TRAVELER_CATALOGUE: Readonly<Record<TravelerId, TravelerDef>> = {
  ray: {
    name: "Great-Grandpa Ray",
    title: "The Pioneer",
    origin: "East Preston, Nova Scotia. Built the house himself, raised heritage stock, broke the ground with a team of oxen.",
    zone: "farmstead",
    unlock: levelUnlock(1),
    reward: "rays_heritage_cap",
  },
  pierre: {
    name: "Chef Pierre",
    title: "The Retro Cook",
    origin: "A four-colour kitchen where every dish was a sprite and nothing ever went cold.",
    zone: "farmstead",
    unlock: levelUnlock(2),
    reward: "liquid_chowder_bowl",
  },
  miles: {
    name: "Detective Miles",
    title: "The Low-Res PI",
    origin: "A rain-soaked city rendered at 160 by 144. Every case ended at the edge of the screen.",
    zone: "coast",
    unlock: levelUnlock(2),
    reward: "anomalous_scanner",
  },
  skye: {
    name: "Artist Skye",
    title: "The Street Animator",
    origin: "A side-scrolling city block where the walls repainted themselves every twelve frames.",
    zone: "oak",
    unlock: levelUnlock(3),
    reward: "glitched_neon_fence",
  },
  barnaby: {
    name: "Diver Barnaby",
    title: "The 16-Bit Aqua-Nut",
    origin: "An underwater stage with an oxygen bar and a very strict timer.",
    zone: "coast",
    unlock: levelUnlock(3),
    reward: "deepsea_waterwheel_node",
  },
  arthur: {
    name: "Knight Arthur",
    title: "The Flat Kingdom Paladin",
    origin: "A realm of two-tone castles and grain fields that scrolled forever in one direction.",
    zone: "townsquare",
    unlock: { kind: "flag", flag: "town_trusted" },
    reward: "aegis_plaza_token",
  },
  brayden: {
    name: "Miner Brayden",
    title: "The Blocky Excavator",
    origin: "A world of metre cubes, where you dig straight down and hope.",
    zone: "mine",
    unlock: levelUnlock(4),
    reward: "glitched_drill_bit",
  },
  ivy: {
    name: "Botanist Ivy",
    title: "The Nursery Programmer",
    origin: "A greenhouse simulation where every seed was a tidy square and every cross was a lookup table.",
    zone: "farmstead",
    unlock: levelUnlock(4),
    reward: "hyperdense_square_seeds",
  },
  wes: {
    name: "Cowboy Wes",
    title: "The Low-Poly Wrangler",
    origin: "A ranch of twelve-polygon cattle under a sky with exactly one cloud.",
    zone: "oxfields",
    unlock: { kind: "flag", flag: "cleared_oxfields" },
    reward: "oxen_speed_harness",
  },
  bea: {
    name: "Beekeeper Bea",
    title: "The Sprite Apiarist",
    origin: "A meadow tileset where the flowers looped and the bees were three pixels each.",
    zone: "oak",
    unlock: levelUnlock(5),
    reward: "liquid_gold_honeycomb",
  },
  leo: {
    name: "Astronaut Leo",
    title: "The Cosmic Voyager",
    origin: "A vertical shooter. He was on the last stage when the shimmer took him.",
    zone: "townsquare",
    unlock: { kind: "finale" },
    reward: "infinite_shard_matrix",
  },
};

/** The pixel-art PNG each bubble shows, the same file the world draws.
 *  Ray's is the spirit sprite, not the retired standing one. Art is a
 *  separate pass; these paths are the contract for it. */
export const TRAVELER_PORTRAIT: Readonly<Record<TravelerId, string>> = Object.fromEntries(
  TRAVELER_IDS.map((id) => [id, `/stackacres/sprites/traveler-${id}.png`]),
) as Record<TravelerId, string>;
