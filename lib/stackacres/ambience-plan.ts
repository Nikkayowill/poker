/**
 * What the farm should SOUND like at a given hour, in a given district.
 *
 * Pure and tested, for the same reason `tools.ts` is: the engine that turns
 * this into noise (`lib/audio/stackacres-ambience.ts`) can only be judged by
 * ear, so every decision that can be made as data is made here instead, where
 * it can be asserted. The engine owns oscillators and gain ramps; it owns no
 * opinions about what a wallow sounds like at midnight.
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

import type { ZoneId } from "./zones";

/** Which third of the day the farm is in. Mirrors `timeOfDay` in lib/audio/stackacres-music.ts. */
export type AmbienceTimeOfDay = "day" | "dusk" | "night";

/**
 * The continuous layers. Each is one synthesis recipe in the engine.
 *
 * `air` is the only one that is never silent -- it is the floor the rest sit
 * on, and a farm with every other bed at zero should still not sound like the
 * audio has failed.
 *
 * THERE IS NO `wind` BED, and that is a decision rather than an omission. One
 * shipped, was turned down once for being the loudest thing on the farm by a
 * wide margin, and was then cut outright: a band of noise whose level and
 * centre frequency both wander is the layer an ear locks onto and follows,
 * and this whole layer exists to be un-followed. What is left of the weather
 * is `air` underneath everything and `grass` moving on top of it, which is
 * the same picture with the part that kept asking to be listened to taken
 * out. Do not reinstate it as a quieter gust walk: that is exactly what was
 * tried first, and quieter wind is still wind.
 */
export const AMBIENCE_BEDS = ["air", "grass", "water", "insects"] as const;
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

const SILENT: AmbienceMix = { air: 0, grass: 0, water: 0, insects: 0 };

/**
 * The bed mix for a district at an hour.
 *
 * Read the numbers as a picture rather than as levels. The Wallow is wet and
 * sheltered, so it carries water and barely rustles; the Ox Fields are bare
 * open ground with nothing standing on them, so they are the thinnest and
 * quietest place on the map and carry no water at all; the Long Meadow is the
 * grass one, which is also the district the scythe works in; the Farmstead
 * sits among buildings, so its rustle is broken up and its water is the yard
 * pump.
 *
 * Night drops `insects` to zero on purpose even though crickets are a night
 * sound: the `insects` bed is the daytime hum of flies and bees, a continuous
 * texture, where crickets are a CUE with gaps in it. Running both would be
 * one noise layer too many under a sleeping farm.
 */
export function ambienceMix(tod: AmbienceTimeOfDay, zone: ZoneId): AmbienceMix {
  const base = zoneBed(zone);
  const day = timeBed(tod);
  return {
    air: clamp01(base.air * day.air),
    grass: clamp01(base.grass * day.grass),
    water: clamp01(base.water * day.water),
    insects: clamp01(base.insects * day.insects),
  };
}

function zoneBed(zone: ZoneId): AmbienceMix {
  switch (zone) {
    case "farmstead":
      // Buildings break the rustle up and the yard pump is the only water.
      return { air: 1, grass: 0.3, water: 0.16, insects: 0.5 };
    case "meadow":
      // Open grass, the loudest rustle on the map, no standing water.
      return { air: 1, grass: 0.9, water: 0, insects: 0.85 };
    case "oxfields":
      // Bare open ground with nothing standing on it to make a noise. `air`
      // carries this district nearly on its own, and it is the quietest of
      // the four on purpose -- it used to be the loudest, on the wind bed.
      return { air: 1, grass: 0.42, water: 0, insects: 0.35 };
    case "wallow":
      // Wet, sheltered, low. Water carries; not much else does.
      return { air: 1, grass: 0.34, water: 0.85, insects: 0.7 };
    default:
      return SILENT;
  }
}

function timeBed(tod: AmbienceTimeOfDay): AmbienceMix {
  switch (tod) {
    case "day":
      return { air: 1, grass: 1, water: 1, insects: 1 };
    case "dusk":
      // The grass settles with the light; the insects are at their loudest.
      return { air: 1, grass: 0.85, water: 1, insects: 1 };
    case "night":
      // Still air, and the daytime hum hands over to the cricket cue.
      return { air: 0.9, grass: 0.55, water: 1, insects: 0 };
    default:
      return SILENT;
  }
}

/**
 * The sparse cues for a district at an hour, longest-gap-first for no reason
 * the engine depends on -- it is just easier to read a table that runs from
 * "constant" to "rare".
 *
 * Gaps are deliberately long. The temptation with a cue list is to make the
 * farm busy, and a busy farm is a noisy one: the point of this layer is that
 * a player who stops moving hears something happen every ten or twenty
 * seconds, not every two.
 */
export function ambienceCues(tod: AmbienceTimeOfDay, zone: ZoneId): AmbienceCue[] {
  const cues: AmbienceCue[] = [];
  const night = tod === "night";
  const dusk = tod === "dusk";
  const day = tod === "day";

  if (night || dusk) {
    cues.push({
      cue: "cricket",
      minGapMs: night ? 1_800 : 3_200,
      maxGapMs: night ? 5_200 : 8_000,
      gain: night ? 0.5 : 0.34,
    });
  }
  if (day || dusk) {
    cues.push({
      cue: "bird-high",
      minGapMs: day ? 2_600 : 6_000,
      maxGapMs: day ? 9_000 : 16_000,
      gain: day ? 0.42 : 0.28,
    });
    cues.push({
      cue: "bird-low",
      minGapMs: day ? 5_000 : 9_000,
      maxGapMs: day ? 15_000 : 24_000,
      gain: 0.3,
    });
  }

  switch (zone) {
    case "farmstead":
      if (day) cues.push({ cue: "pigeon-coo", minGapMs: 14_000, maxGapMs: 38_000, gain: 0.3 });
      cues.push({ cue: "windmill-creak", minGapMs: 11_000, maxGapMs: 26_000, gain: 0.24 });
      cues.push({ cue: "gate-creak", minGapMs: 30_000, maxGapMs: 90_000, gain: 0.18 });
      cues.push({ cue: "straw-rustle", minGapMs: 9_000, maxGapMs: 24_000, gain: 0.2 });
      cues.push({ cue: "water-drop", minGapMs: 4_000, maxGapMs: 12_000, gain: 0.22 });
      if (dusk) cues.push({ cue: "farm-bell", minGapMs: 60_000, maxGapMs: 150_000, gain: 0.16 });
      break;
    case "meadow":
      cues.push({ cue: "straw-rustle", minGapMs: 7_000, maxGapMs: 18_000, gain: 0.26 });
      if (dusk) cues.push({ cue: "crow-caw", minGapMs: 16_000, maxGapMs: 44_000, gain: 0.26 });
      if (night) cues.push({ cue: "owl-hoot", minGapMs: 22_000, maxGapMs: 60_000, gain: 0.26 });
      break;
    case "oxfields":
      // Open ground with nothing on it: `air` carries this district almost on
      // its own, and the few cues are all far away.
      if (dusk || day) cues.push({ cue: "crow-caw", minGapMs: 12_000, maxGapMs: 34_000, gain: 0.3 });
      if (night) cues.push({ cue: "owl-hoot", minGapMs: 18_000, maxGapMs: 52_000, gain: 0.3 });
      cues.push({ cue: "gate-creak", minGapMs: 26_000, maxGapMs: 70_000, gain: 0.16 });
      break;
    case "wallow":
      cues.push({ cue: "water-drop", minGapMs: 1_600, maxGapMs: 5_400, gain: 0.34 });
      cues.push({ cue: "frog", minGapMs: night ? 2_400 : 6_000, maxGapMs: night ? 7_000 : 16_000, gain: 0.34 });
      break;
  }

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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
