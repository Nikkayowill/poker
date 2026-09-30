/**
 * The fishing gauge: the skill half of a cast.
 *
 * Pure and renderer-free, the same split ./wildlife.ts and ./world.ts keep
 * against their Phaser managers -- every number a frame needs comes out of
 * this file, and components/arcade/stackacres/fishing-gauge-scene.ts owns
 * only textures and GameObjects.
 *
 * WHAT IT ADDS. ./fishing.ts decides WHICH fish a landed cast gives (the
 * server's roll, via `pickCaughtFish`); the world plays the cast itself and
 * says when a fish is on (lib/stackacres-td/fishing-cast.ts), and nothing in
 * either of those can be failed. This module is the part that can be missed:
 * once a fish is on the line, the player holds a capture bar over a fish that
 * darts up and down a track, and the overlap between the two is integrated
 * every frame into a progress value. Full progress lands the fish, empty
 * progress loses it.
 *
 * The species drives the difficulty, so the rare catch is the hard one:
 * catfish get a shorter bar, a faster fish and a steeper drain than a
 * bluegill. Nothing here knows about pixels -- the track is a normalised
 * 0..1 axis with 0 at the bottom, and the scene scales it to whatever the
 * panel ended up being.
 *
 * Every function takes its RNG as a parameter (same reason `pickCaughtFish`
 * does): a test hands it a fixed sequence instead of patching Math.random.
 */

import { FISH_SPECIES, pickCaughtFish, type CastTier, type FishSpecies } from "./fishing";
import { clampFrameMs } from "./world";

/** Length of the fish marker as a fraction of the track. Shared by all
 *  three species: the fish is what the eye tracks, so it keeps one size
 *  and the BAR changes instead. */
export const FISH_MARKER_SPAN = 0.12;

/** Progress a fresh hook starts at. Off zero on purpose -- a player who
 *  fumbles the first half second still has a moment to recover, which is
 *  the difference between a mini-game and a coin flip for the young end
 *  of this audience. */
export const START_PROGRESS = 0.34;

/**
 * How long a fresh hook refuses to drain.
 *
 * The opening used to teach the wrong lesson. The bar was parked at the
 * bottom of the well and the fish started mid-track, so the first thing that
 * happened after the bite was the meter falling -- before the player had
 * pressed anything, and while the bar was still climbing out of the floor.
 * You were punished for the half second it took to read the screen, which is
 * exactly the half second this audience needs.
 *
 * Two fixes, and this is the second. The bar now starts UNDER THE FISH (see
 * `createFishingGaugeState`), so the opening frame is already the winning
 * shape and the rule reads off the picture. This grace covers the rest: for
 * its duration a miss costs nothing, so letting go to look is free. Gaining
 * is not graced -- holding correctly pays from frame one.
 */
export const GRACE_MS = 450;

/** Track fractions/second the capture bar may travel at, in either
 *  direction. Without a cap a long fall lands with an unrecoverable
 *  bounce. */
const BAR_MAX_SPEED = 1.15;
/** Upward acceleration while the player holds, and the downward pull when
 *  they let go, both in track fractions/second². Lift beats gravity by
 *  enough that a steady hold climbs, so "press to go up" reads correctly
 *  on the first try. */
const BAR_LIFT = 4.6;
const BAR_GRAVITY = 2.1;

/**
 * How far below the well a released net sinks, as a share of its own length.
 *
 * It used to stop dead at the bottom of the track, which left it parked
 * across the lowest third of the water covering anything that swam past. A
 * player who never touched the screen landed 40% of bluegill that way -- the
 * most common fish in the pond, caught by doing nothing, which is the worst
 * thing a skill gate can do. Sinking the net clear of the water instead means
 * a hand off the screen earns exactly nothing, and the only way up is to hold.
 */
const BAR_SINK = 1;

export interface FishGaugeProfile {
  /** Capture bar length as a fraction of the track. */
  readonly barSpan: number;
  /** Track fractions/second the fish swims toward its next spot at. */
  readonly fishSpeed: number;
  /** How long the fish sits on a spot before picking another, in ms. */
  readonly restMinMs: number;
  readonly restMaxMs: number;
  /** Progress/second gained at full overlap, and lost with none. */
  readonly gainPerSec: number;
  readonly drainPerSec: number;
}

/**
 * Per-species difficulty. Read against ./fishing.ts's own FISH_WEIGHTS:
 * bluegill is 60% of catches and the forgiving one, catfish is 10% and the
 * one worth bragging about. From `START_PROGRESS` a bluegill lands in about
 * a second of clean tracking and is lost after about a second and a half of
 * none; a catfish gives roughly half that cushion.
 */
export const FISH_GAUGE_PROFILES: Readonly<Record<FishSpecies, FishGaugeProfile>> = {
  bluegill: {
    barSpan: 0.34,
    fishSpeed: 0.28,
    restMinMs: 520,
    restMaxMs: 1200,
    gainPerSec: 0.62,
    drainPerSec: 0.22,
  },
  trout: {
    barSpan: 0.26,
    fishSpeed: 0.46,
    restMinMs: 320,
    restMaxMs: 900,
    gainPerSec: 0.55,
    drainPerSec: 0.3,
  },
  catfish: {
    // Retuned 2026-09-17 off a simulated skill sweep: at barSpan 0.2 /
    // fishSpeed 0.62 a player tracking the fish PERFECTLY still lost 83% of
    // catfish, so the rare fish was not hard, it was a loss with extra steps.
    // These land ~85% for perfect tracking and ~40% for a human reacting
    // every 180ms -- the same shape trout already had, one step harder.
    barSpan: 0.24,
    fishSpeed: 0.5,
    restMinMs: 260,
    restMaxMs: 720,
    gainPerSec: 0.58,
    drainPerSec: 0.32,
  },
};

export type FishingGaugePhase = "playing" | "landed" | "escaped";

export interface FishingGaugeState {
  readonly species: FishSpecies;
  readonly phase: FishingGaugePhase;
  /** Bottom edge of the capture bar, 0..1 - barSpan. */
  readonly barPos: number;
  /** Bar velocity in track fractions/second, signed up-positive. */
  readonly barVel: number;
  /** Bottom edge of the fish marker, 0..1 - FISH_MARKER_SPAN. */
  readonly fishPos: number;
  /** Where the fish is currently headed, same units as `fishPos`. */
  readonly fishTarget: number;
  /** Time left before the fish picks a new target regardless of whether it
   *  reached this one. */
  readonly restMs: number;
  /** 0..1. Full lands the fish, empty loses it. */
  readonly progress: number;
  /** Wall-clock the hook has been live, and how much of it was spent with
   *  the bar touching the fish. The scene shows the second as a streak, and
   *  both are worth having when this loop gets tuned again. */
  readonly elapsedMs: number;
  readonly overlapMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Highest bottom-edge position a span of this length can sit at. */
function maxPos(span: number): number {
  return Math.max(0, 1 - span);
}

function rollFishTarget(random: () => number): number {
  return random() * maxPos(FISH_MARKER_SPAN);
}

function rollRestMs(profile: FishGaugeProfile, random: () => number): number {
  return profile.restMinMs + random() * (profile.restMaxMs - profile.restMinMs);
}

/** The profile a species plays at. */
export function fishGaugeProfile(species: FishSpecies): FishGaugeProfile {
  return FISH_GAUGE_PROFILES[species];
}

/**
 * A fresh hook. The fish starts mid-track already heading somewhere else, so
 * the first frame has motion in it -- and the bar starts CENTRED ON THE FISH
 * rather than parked at the bottom of the well.
 *
 * That centring is the whole opening. A player who has never seen this
 * screen gets one frame that already shows the answer: the fish sitting
 * inside the net, the meter climbing. Then the fish moves and the net falls,
 * and keeping the two together is obviously the job. Starting them apart
 * taught the opposite -- the meter fell first and the connection between the
 * press and the fill never landed. See `GRACE_MS` for the other half.
 */
export function createFishingGaugeState(
  species: FishSpecies,
  random: () => number = Math.random,
): FishingGaugeState {
  const profile = fishGaugeProfile(species);
  const fishPos = maxPos(FISH_MARKER_SPAN) / 2;
  const centred = fishPos + FISH_MARKER_SPAN / 2 - profile.barSpan / 2;
  return {
    species,
    phase: "playing",
    barPos: clamp(centred, 0, maxPos(profile.barSpan)),
    barVel: 0,
    fishPos,
    fishTarget: rollFishTarget(random),
    restMs: rollRestMs(profile, random),
    progress: START_PROGRESS,
    elapsedMs: 0,
    overlapMs: 0,
  };
}

/**
 * How much of the fish marker the capture bar currently covers, 0..1. This
 * is the whole scoring rule: partial cover earns partial progress, and
 * only a complete miss drains.
 */
export function gaugeOverlap(state: FishingGaugeState): number {
  const profile = fishGaugeProfile(state.species);
  const barTop = state.barPos + profile.barSpan;
  const fishTop = state.fishPos + FISH_MARKER_SPAN;
  const covered = Math.min(barTop, fishTop) - Math.max(state.barPos, state.fishPos);
  return clamp(covered / FISH_MARKER_SPAN, 0, 1);
}

/**
 * Advance one frame. `holding` is whether the player has the press down
 * this frame; the caller reads that off a pointer or a key and this module
 * stays out of input entirely.
 *
 * Returns a new state; a finished gauge returns itself untouched, so a
 * scene that keeps calling update through its own exit tween cannot flip a
 * landed fish back to escaped.
 */
export function stepFishingGauge(
  state: FishingGaugeState,
  dtMs: number,
  holding: boolean,
  random: () => number = Math.random,
): FishingGaugeState {
  if (state.phase !== "playing") return state;

  const frameMs = clampFrameMs(dtMs);
  const dt = frameMs / 1000;
  if (dt === 0) return state;

  const profile = fishGaugeProfile(state.species);

  // Bar: accelerate, cap, integrate, and kill the velocity at either stop
  // so a bar held against the top does not bank momentum for the release.
  const accel = holding ? BAR_LIFT - BAR_GRAVITY : -BAR_GRAVITY;
  let barVel = clamp(state.barVel + accel * dt, -BAR_MAX_SPEED, BAR_MAX_SPEED);
  const barLimit = maxPos(profile.barSpan);
  const barFloor = -profile.barSpan * BAR_SINK;
  let barPos = state.barPos + barVel * dt;
  if (barPos <= barFloor) {
    barPos = barFloor;
    barVel = Math.max(0, barVel);
  } else if (barPos >= barLimit) {
    barPos = barLimit;
    barVel = Math.min(0, barVel);
  }

  // Fish: swim toward the target, then pick another once it arrives or its
  // rest timer runs out. Both paths roll from the same RNG, so a seeded
  // sequence replays a whole fight exactly.
  let restMs = state.restMs - frameMs;
  let fishTarget = state.fishTarget;
  let fishPos = state.fishPos;
  const step = profile.fishSpeed * dt;
  const toTarget = fishTarget - fishPos;
  if (Math.abs(toTarget) <= step) {
    fishPos = fishTarget;
    restMs = Math.min(restMs, 0);
  } else {
    fishPos += Math.sign(toTarget) * step;
  }
  if (restMs <= 0) {
    fishTarget = rollFishTarget(random);
    restMs = rollRestMs(profile, random);
  }
  fishPos = clamp(fishPos, 0, maxPos(FISH_MARKER_SPAN));

  const moved: FishingGaugeState = { ...state, barPos, barVel, fishPos, fishTarget, restMs };
  const overlap = gaugeOverlap(moved);
  // Graced: a miss inside the opening window costs nothing, so the first read
  // of the screen is free. A hit still pays, so holding correctly is never
  // worth less than waiting.
  const graced = state.elapsedMs < GRACE_MS;
  const delta = overlap > 0 ? profile.gainPerSec * overlap * dt : graced ? 0 : -profile.drainPerSec * dt;
  const progress = clamp(moved.progress + delta, 0, 1);

  return {
    ...moved,
    progress,
    elapsedMs: state.elapsedMs + frameMs,
    overlapMs: state.overlapMs + (overlap > 0 ? frameMs : 0),
    phase: progress >= 1 ? "landed" : progress <= 0 ? "escaped" : "playing",
  };
}

/**
 * How close the line is to snapping, 0..1, for whatever the scene wants to
 * redden or shake. Mirrors `progress` rather than adding a second tracked
 * value: one number decides the fight, so one number drives the tell.
 */
export function gaugeTension(state: FishingGaugeState): number {
  return clamp(1 - state.progress / START_PROGRESS, 0, 1);
}

/** Every species this module has a profile for, in ./fishing.ts's order. */
export function gaugeSpeciesLadder(): readonly FishSpecies[] {
  return FISH_SPECIES;
}

/**
 * Which profile a cast fights at.
 *
 * This is DIFFICULTY, not the catch. Which fish a landed cast actually gives
 * is the server's roll inside `catch-fish` (see ./fishing.ts's
 * `pickCaughtFish`, called from lib/server/stackacres-service.ts), and this
 * client-side roll never reaches it. It borrows the same weights so the mix
 * of easy and hard fights matches the mix of fish the pond gives, which is
 * why the gauge's own copy never names a species -- see
 * `FishingGaugeSceneOptions.title`.
 */
export function rollGaugeDifficulty(cast: CastTier, random: () => number = Math.random): FishSpecies {
  return pickCaughtFish(random, false, cast);
}
