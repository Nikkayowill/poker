/**
 * What the farm should SOUND like at a given hour.
 *
 * Pure and tested, for the same reason `tools.ts` is: the engine that turns
 * this into noise (`lib/audio/stackacres-ambience.ts`) can only be judged by
 * ear, so every decision that can be made as data is made here instead, where
 * it can be asserted. The engine owns oscillators and gain ramps; it owns no
 * opinions about what the farm sounds like at midnight.
 *
 * This used to vary per district too -- the Wallow wetter, the Ox Fields
 * thinner, a windmill creak only near the actual windmill. That made the
 * ambience a property of where you stood, which meant travelling reset it and
 * meant two districts could sound like two different games. It is now one mix
 * and one cue table for the whole map: the farm sounds like the farm no
 * matter where you are standing on it.
 *
 * The whole soundscape is SYNTHESISED at runtime -- there is no ambience file
 * to fetch and no ambience loop to hear repeat. That is a deliberate choice
 * and it is the same one StackAcres already makes about its pictures: the
 * farm's art is Canvas2D painters baked at boot rather than downloaded
 * sprites, and its sound is filtered noise and scheduled cues rather than a
 * downloaded loop. A ten-second ambience file under a quiet game is exactly
 * where a listener starts hearing the seam, and hearing the seam is the end
 * of the ASMR the whole layer exists for.
 *
 * Two things come out of here:
 *
 *   BEDS are continuous. They have a gain and nothing else; the engine holds
 *   one voice per bed for the life of the session and only ever ramps between
 *   the mixes this file returns.
 *
 *   CUES are sparse and one-shot. They carry an interval RANGE rather than a
 *   period, and the engine rolls a fresh gap inside that range after every
 *   firing, so nothing here lands on a beat. That is the other half of "not
 *   beats": a cricket every 4.0s is a metronome, a cricket every 2.5-7s is a
 *   field.
 */

import { clamp01 } from "./world";

/** Which third of the day the farm is in. Mirrors `timeOfDay` in lib/audio/stackacres-music.ts. */
export type AmbienceTimeOfDay = "day" | "dusk" | "night";

/**
 * The continuous layers. Each is one synthesis recipe in the engine.
 *
 * THERE IS NO `wind` BED, no `air` BED, and `grass` is held at 0 everywhere.
 * Wind shipped, was turned down once for being the loudest thing on the farm
 * by a wide margin, and was then cut outright. `grass` carried a gust walk of
 * its own, which read as wind just the same and was cut the next day, and
 * even flattened to a fixed static rustle it still read as wind once enough
 * of it was playing -- so `grass` is silenced rather than tuned a third time.
 * `air` was the last of it: a continuous low-passed noise floor under
 * everything, held at close to full gain always so the farm was never
 * silent -- which is exactly the brief for a wind bed, just without a gust to
 * point at. It was killed rather than tuned again after three straight
 * rounds of "still sounds like wind" against three different fixes. What is
 * left is `water`/`insects`. Do not reinstate a continuous noise-floor bed
 * under any name -- that is the shape that has read as wind three times now,
 * regardless of what wanders on top of it. `grass` stays in this list at 0
 * rather than being deleted, so the engine keeps holding one crossfaded
 * voice per bed rather than tearing one down.
 */
export const AMBIENCE_BEDS = ["grass", "water", "insects"] as const;
export type AmbienceBed = (typeof AMBIENCE_BEDS)[number];

/** Gain per bed, 0..1. A bed at 0 is held silent rather than torn down. */
export type AmbienceMix = Readonly<Record<AmbienceBed, number>>;

/**
 * The sparse one-shots.
 *
 * All but the last two are SYNTHESISED (see lib/audio/synth-voices.ts); the
 * two creaks are recordings. The split is not arbitrary and is worth stating,
 * because it is the rule for adding to this list: a sound made of tone and
 * noise -- a chirp, a cricket, a struck bell, a water drop -- synthesises well
 * and gains from it, because every firing can be slightly different and so a
 * cue heard two hundred times in a session never wears out. A sound made by a
 * throat or by complicated resonant timber does not, and is a file.
 *
 * Timbre is one of the two things making a cue read as far away; the other is
 * the engine's own distance damping. Both are needed -- a quiet bird is a
 * nearby quiet bird until the treble comes off it too.
 */
export const AMBIENCE_CUES = [
  "bird-high",
  "bird-low",
  "cricket",
  "frog",
  "water-drop",
  "pigeon-coo",
  "crow-caw",
  "owl-hoot",
  "farm-bell",
  "straw-rustle",
  "windmill-creak",
  "gate-creak",
] as const;
export type AmbienceCueName = (typeof AMBIENCE_CUES)[number];

export interface AmbienceCue {
  cue: AmbienceCueName;
  /** Shortest gap before this cue may fire again, ms. */
  minGapMs: number;
  /** Longest gap, ms. The engine rolls uniformly between the two. */
  maxGapMs: number;
  /** Playback gain, 0..1. Distance is spelled as loudness plus the engine's own damping. */
  gain: number;
}

const SILENT: AmbienceMix = { grass: 0, water: 0, insects: 0 };

/**
 * The one bed mix the whole map shares. `grass` stays out of it -- see
 * AMBIENCE_BEDS. `water` is pitched low on purpose: it is a wide band of
 * noise wandering in level and pitch (see the bed's synthesis in
 * stackacres-ambience.ts), which is the same shape as the wind bed that got
 * cut -- at its old gain it read as wind under the cues rather than as a
 * stream under the birds.
 */
const BASE_MIX: AmbienceMix = { grass: 0, water: 0.22, insects: 0.6 };

/**
 * The bed mix for an hour, the same wherever you are standing.
 *
 * Night drops `insects` to zero on purpose even though crickets are a night
 * sound: the `insects` bed is the daytime hum of flies and bees, a continuous
 * texture, where crickets are a CUE with gaps in it. Running both would be
 * one noise layer too many under a sleeping farm.
 */
export function ambienceMix(tod: AmbienceTimeOfDay): AmbienceMix {
  const day = timeBed(tod);
  return {
    grass: clamp01(BASE_MIX.grass * day.grass),
    water: clamp01(BASE_MIX.water * day.water),
    insects: clamp01(BASE_MIX.insects * day.insects),
  };
}

function timeBed(tod: AmbienceTimeOfDay): AmbienceMix {
  switch (tod) {
    case "day":
      return { grass: 1, water: 1, insects: 1 };
    case "dusk":
      return { grass: 1, water: 1, insects: 1 };
    case "night":
      // The daytime hum hands over to the cricket cue.
      return { grass: 1, water: 1, insects: 0 };
    default:
      return SILENT;
  }
}

/**
 * The sparse cues for an hour, the same wherever you are standing,
 * longest-gap-first for no reason the engine depends on -- it is just easier
 * to read a table that runs from "constant" to "rare".
 *
 * Gaps still vary a lot cue to cue: the mechanical ones (windmill, gate, the
 * owl) stay rare so the farm doesn't turn into a machine shop, but the birds,
 * crickets and frogs run close together on purpose -- that density is what
 * reads as "a living farm" rather than "an occasional sound effect", and each
 * firing is itself 2-4 varied chirps (see synth-voices.ts), so it never comes
 * out as a metronome even at a short gap.
 */
export function ambienceCues(tod: AmbienceTimeOfDay): AmbienceCue[] {
  const cues: AmbienceCue[] = [];
  const night = tod === "night";
  const dusk = tod === "dusk";
  const day = tod === "day";

  if (night || dusk) {
    cues.push({
      cue: "cricket",
      minGapMs: night ? 1_200 : 2_200,
      maxGapMs: night ? 3_600 : 5_500,
      gain: night ? 0.62 : 0.46,
    });
  }
  if (day || dusk) {
    cues.push({
      cue: "bird-high",
      minGapMs: day ? 1_000 : 1_600,
      maxGapMs: day ? 2_400 : 3_800,
      gain: day ? 0.6 : 0.44,
    });
    cues.push({
      cue: "bird-low",
      minGapMs: day ? 1_500 : 2_500,
      maxGapMs: day ? 4_200 : 6_500,
      gain: 0.44,
    });
    cues.push({ cue: "crow-caw", minGapMs: 9_000, maxGapMs: 22_000, gain: 0.38 });
  }
  if (day) cues.push({ cue: "pigeon-coo", minGapMs: 6_000, maxGapMs: 16_000, gain: 0.38 });
  if (dusk) cues.push({ cue: "farm-bell", minGapMs: 60_000, maxGapMs: 150_000, gain: 0.16 });
  if (night) cues.push({ cue: "owl-hoot", minGapMs: 14_000, maxGapMs: 34_000, gain: 0.4 });

  // These used to belong to one district apiece; now they just play,
  // wherever you are, because the farm is one place rather than four.
  cues.push({ cue: "windmill-creak", minGapMs: 11_000, maxGapMs: 26_000, gain: 0.24 });
  cues.push({ cue: "gate-creak", minGapMs: 28_000, maxGapMs: 80_000, gain: 0.17 });
  cues.push({ cue: "straw-rustle", minGapMs: 8_000, maxGapMs: 21_000, gain: 0.3 });
  cues.push({ cue: "water-drop", minGapMs: 2_500, maxGapMs: 8_000, gain: 0.28 });
  cues.push({ cue: "frog", minGapMs: night ? 1_800 : 4_000, maxGapMs: night ? 4_500 : 10_000, gain: 0.46 });

  return cues;
}

/**
 * How often an animal you actually own should speak up, and how loudly.
 *
 * Separate from `ambienceCues` because this one is not a property of the
 * place -- it is a property of your farm. Standing in the Ox Fields with no
 * cattle should sound like empty ground; standing there with three should
 * sound like you keep cattle. The count damps rather than multiplies: three
 * cows are not three times as talkative as one, they are one herd, so the gap
 * shortens on a square root and the gain barely moves.
 *
 * Returns null when nothing of that kind is standing there, which the engine
 * reads as "schedule nothing" rather than "schedule silence".
 */
export function livestockCue(
  count: number,
  tod: AmbienceTimeOfDay,
): { minGapMs: number; maxGapMs: number; gain: number } | null {
  if (count <= 0) return null;
  // Animals settle at night: the same herd speaks about half as often.
  const restfulness = tod === "night" ? 2.1 : tod === "dusk" ? 1.35 : 1;
  const herd = Math.sqrt(count);
  return {
    minGapMs: Math.round((7_000 / herd) * restfulness),
    maxGapMs: Math.round((22_000 / herd) * restfulness),
    gain: clamp01(0.3 + Math.min(count, 6) * 0.015),
  };
}

/**
 * A gap inside a cue's range. Takes its own random source so tests can pin it
 * and so nothing here reaches for Math.random behind the engine's back.
 */
export function rollGapMs(cue: { minGapMs: number; maxGapMs: number }, random: () => number): number {
  const span = Math.max(0, cue.maxGapMs - cue.minGapMs);
  return cue.minGapMs + random() * span;
}
