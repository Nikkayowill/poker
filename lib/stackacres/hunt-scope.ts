/**
 * The tracking scope: the skill half of a stalk.
 *
 * Pure and renderer-free, the same split ./fishing-gauge.ts keeps against
 * its own Phaser scene -- every number a frame needs comes out of this file,
 * and components/arcade/stackacres-td/hunt-scope-scene.ts owns only
 * textures and GameObjects.
 *
 * WHAT IT ADDS. ./hunting.ts decides WHICH quarry a completed stalk gives
 * (the server's roll, via `pickQuarry`). This module is the part that can be
 * missed: a lens is dragged across a patch of brush, something moves inside
 * it on randomised pathing, and holding the crosshair on that something
 * fills a lock meter. A full meter does NOT end the stalk -- it arms it, and
 * the player still has to press Use to take the mark. That second press is
 * deliberate: it is the one moment the player commits, and without it a
 * stalk would resolve itself while they watched.
 *
 * TWO METERS, NOT ONE, which is the whole difference from the fishing gauge.
 * `lock` rewards holding still on the mark. `spook` punishes snatching the
 * lens around, and climbs on its own the longer the stalk runs, so patience
 * is bounded and a stalk can never be waited out. Filling `spook` loses the
 * animal. That pair is what makes this a stealth game rather than a second
 * tug-of-war, and it is why a young player who yanks the lens straight onto
 * the animal is taught something a single meter could not teach them.
 *
 * DIFFICULTY IS NOT THE CATCH. `species` here picks how hard the stalk plays
 * and nothing else, exactly as `FishingGaugeRequest.species` does -- what a
 * bagged stalk actually yields is rolled server-side inside `bag-quarry`.
 * The copy the scene shows stays species-free for that reason.
 *
 * Every function takes its RNG as a parameter (same reason `pickQuarry`
 * does): a test hands it a fixed sequence instead of patching Math.random.
 */

import { QUARRY_SPECIES, type HuntingWeapon, type QuarrySpecies } from "./hunting";
import { clampFrameMs } from "./world";

/** The brush patch is a normalised unit square: 0,0 is its top left and 1,1
 *  its bottom right. Nothing here knows about pixels -- the scene scales
 *  this to whatever the viewport ended up being, the same way the fishing
 *  gauge scales its own 0..1 track. */
export interface ScopePoint {
  readonly x: number;
  readonly y: number;
}

/** How far the quarry's own body reaches from its centre, as a fraction of
 *  the patch. Shared by all three species: the animal is what the eye
 *  tracks, so it keeps one size and the LENS changes instead -- the same
 *  call `FISH_MARKER_SPAN` makes for the same reason. */
export const QUARRY_RADIUS = 0.055;

/**
 * Lens travel per second past which the hand is too unsteady to settle on
 * anything. Lock builds on a scale that reaches zero here, so a lens being
 * dragged simply does not aim, however perfectly it is covering the animal.
 *
 * THIS SITS BELOW EVERY QUARRY SPEED, and that one relationship is the whole
 * game: nothing can be locked while it is walking, because keeping up with
 * it costs more than this. You lock what is STANDING STILL, which is what
 * makes the animal's own rest timer the window you are really playing for,
 * and what makes the fast animals hard -- a Boar rests in short snatches, a
 * Rabbit in long ones.
 *
 * Both of the obvious alternatives were measured and thrown out. Punishing
 * only a "snatch" above the quarry speeds (0.85) never fired at all, because
 * following an animal never needs that speed: a careless hand and a careful
 * one both locked 100% of the time, in about two seconds. Punishing it only
 * while the animal was already inside the lens made the whole approach free,
 * so charging straight in was strictly FASTER than stalking.
 */
const STEADY_SPEED = 0.25;

/**
 * Lens travel per second a RESTING animal will tolerate nearby before it
 * starts getting nervous. A walking animal notices nothing: it is busy, and
 * moving the lens while it moves is free.
 *
 * SO THE RULE IS RED LIGHT, GREEN LIGHT. While it walks, reposition freely
 * and get ahead of it. The moment it stops it is looking around, and then
 * both halves of this module point the same way: movement costs you, and
 * only stillness builds lock. Freeze while it is stopped, move while it is
 * not.
 *
 * That shape was arrived at by measurement, after two others failed. Charging
 * for raw lens speed near the animal does not work at all, because the cost
 * of crossing a fixed distance is then LOWER the faster you cross it -- you
 * are exposed for less time -- which is why a snatching hand kept beating a
 * patient one (83% against 47% on Rabbits) no matter where the threshold
 * sat. Gating on the animal's own attention fixes that without a second
 * curve to tune, and it is a rule a young player already knows from the
 * playground.
 */
const NOTICE_SPEED = 0.12;

/**
 * How far the animal notices the lens moving, as a fraction of the patch --
 * deliberately much wider than any lens, because what gives a stalker away
 * is movement in the animal's direction, not movement already on top of it.
 * A sweep across the far side of the brush is free; the same sweep arriving
 * next to the animal is what spooks it.
 */
const NOTICE_RADIUS = 0.45;

/** How long a stalk may run before wariness alone ends it, in seconds, at a
 *  species' baseline. Not enforced as a timer -- it falls out of
 *  `warinessPerSec` filling `spook` -- but it is the number those are tuned
 *  against, and it keeps a stalk inside one held breath. */
export const STALK_PATIENCE_SEC = 18;

export interface HuntWeaponProfile {
  /** Lens radius as a fraction of the patch. The rifle's is WIDER, not
   *  narrower: it is a Level 4 reward, and a reward that makes the game
   *  harder to read is not one. */
  readonly lensRadius: number;
  /** Lock gained per second at a dead-centre hold, and lost per second with
   *  the mark outside the lens. */
  readonly lockPerSec: number;
  readonly lockDrainPerSec: number;
  /** 0..1, how much of a snatch the weapon absorbs before it reaches the
   *  animal. The rifle is braced; the bow is drawn by hand. */
  readonly steadiness: number;
}

/**
 * Bow first, rifle at Level 4 (see `RIFLE_UNLOCK`). The rifle is better at
 * every one of the four, deliberately -- it is earned, and StackAcres'
 * audience should not have to work out a trade-off to know an upgrade
 * happened. The stalk stays hard because the QUARRY scales, not because the
 * tool fights the player.
 */
export const HUNT_WEAPON_PROFILES: Readonly<Record<HuntingWeapon, HuntWeaponProfile>> = {
  bow: {
    lensRadius: 0.18,
    lockPerSec: 0.34,
    lockDrainPerSec: 0.5,
    steadiness: 0.55,
  },
  rifle: {
    lensRadius: 0.22,
    lockPerSec: 0.55,
    lockDrainPerSec: 0.32,
    steadiness: 0.85,
  },
};

export interface QuarryProfile {
  /** Patch fractions/second the animal moves toward its next spot at. */
  readonly speed: number;
  /** How long it STANDS STILL on arrival before picking somewhere new, in
   *  ms. This is the window the whole stalk is played for -- see
   *  `STEADY_SPEED` on why nothing can be locked while it is walking. */
  readonly restMinMs: number;
  readonly restMaxMs: number;
  /** Spook/second the animal accrues just by being stalked. This is the
   *  clock on the whole encounter. */
  readonly warinessPerSec: number;
  /** How hard a snatch lands on this animal, as a multiplier on the spook a
   *  jerk would otherwise add. */
  readonly jumpiness: number;
}

/**
 * Per-species difficulty, read against ./hunting.ts's own `QUARRY_WEIGHTS`:
 * a Rabbit is 55% of stalks and the forgiving one, a Boar is 13% and the one
 * worth the walk. At their own baseline a Rabbit gives roughly the full
 * `STALK_PATIENCE_SEC` before wariness alone ends it, a Boar closer to half.
 */
export const QUARRY_PROFILES: Readonly<Record<QuarrySpecies, QuarryProfile>> = {
  rabbit: {
    speed: 0.3,
    restMinMs: 900,
    restMaxMs: 1600,
    warinessPerSec: 1 / STALK_PATIENCE_SEC,
    jumpiness: 0.8,
  },
  deer: {
    speed: 0.42,
    restMinMs: 650,
    restMaxMs: 1150,
    warinessPerSec: 1.45 / STALK_PATIENCE_SEC,
    jumpiness: 1.15,
  },
  boar: {
    speed: 0.56,
    restMinMs: 420,
    restMaxMs: 820,
    warinessPerSec: 1.8 / STALK_PATIENCE_SEC,
    jumpiness: 1.5,
  },
};

/**
 * `stalking` -- tracking, nothing armed yet.
 * `locked`   -- the meter is full and Use will take the mark. Spook still
 *               climbs here, so this is a window, not a resting place.
 * `bagged`   -- Use was pressed while locked. The one winning end.
 * `fled`     -- spook filled. No catch, no cost.
 */
export type HuntScopePhase = "stalking" | "locked" | "bagged" | "fled";

export interface HuntScopeState {
  readonly species: QuarrySpecies;
  readonly weapon: HuntingWeapon;
  readonly phase: HuntScopePhase;
  /** Lens centre, clamped inside the patch. */
  readonly lens: ScopePoint;
  /** Quarry centre, and where it is currently headed. While it is `resting`
   *  the two are equal: it has arrived and is standing on the spot. */
  readonly quarry: ScopePoint;
  readonly quarryTarget: ScopePoint;
  /** Whether it is walking to its spot or standing on it. Only a `resting`
   *  animal can actually be locked. */
  readonly quarryMode: "moving" | "resting";
  /** While `resting`, how long it stays put. Counts down only then. */
  readonly restMs: number;
  /** 0..1. Full arms the shot. */
  readonly lock: number;
  /** 0..1. Full loses the animal. */
  readonly spook: number;
  /** Wall-clock the stalk has run, and how much of it was spent with the
   *  mark inside the lens. The scene shows neither; both are worth having
   *  when this loop gets tuned again, the same reason the fishing gauge
   *  keeps its own pair. */
  readonly elapsedMs: number;
  readonly onMarkMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Keeps a point inside the patch, inset by `radius` so a body never hangs
 *  half outside the brush. */
function clampInside(point: ScopePoint, radius: number): ScopePoint {
  return { x: clamp(point.x, radius, 1 - radius), y: clamp(point.y, radius, 1 - radius) };
}

function rollQuarryTarget(random: () => number): ScopePoint {
  return clampInside({ x: random(), y: random() }, QUARRY_RADIUS);
}

function rollRestMs(profile: QuarryProfile, random: () => number): number {
  return profile.restMinMs + random() * (profile.restMaxMs - profile.restMinMs);
}

export function huntWeaponProfile(weapon: HuntingWeapon): HuntWeaponProfile {
  return HUNT_WEAPON_PROFILES[weapon];
}

export function quarryProfile(species: QuarrySpecies): QuarryProfile {
  return QUARRY_PROFILES[species];
}

/**
 * Which difficulty a fresh stalk plays at. Weighted the same way the reward
 * roll is, so the stalk a player fights is as hard as the thing they are
 * statistically about to be given -- without this module ever learning what
 * that thing turns out to be. Mirrors `rollGaugeDifficulty`'s job for
 * fishing.
 */
export function rollQuarryDifficulty(random: () => number = Math.random): QuarrySpecies {
  const roll = random() * QUARRY_SPECIES.length;
  return QUARRY_SPECIES[Math.min(QUARRY_SPECIES.length - 1, Math.floor(roll))];
}

/**
 * A fresh stalk. The lens starts dead centre (the player has not dragged
 * anything yet) and the animal starts off to one side already heading
 * somewhere else, so the first frame has motion in it and the first thing
 * the player must do is follow rather than react.
 */
export function createHuntScopeState(
  species: QuarrySpecies,
  weapon: HuntingWeapon,
  random: () => number = Math.random,
): HuntScopeState {
  return {
    species,
    weapon,
    phase: "stalking",
    lens: { x: 0.5, y: 0.5 },
    quarry: rollQuarryTarget(random),
    quarryTarget: rollQuarryTarget(random),
    // Already walking, so the first thing the player sees is movement and the
    // first thing they must do is wait for it to settle.
    quarryMode: "moving",
    restMs: 0,
    lock: 0,
    spook: 0,
    elapsedMs: 0,
    onMarkMs: 0,
  };
}

/** Distance from the lens centre to the quarry centre, in patch fractions. */
export function markDistance(state: HuntScopeState): number {
  return Math.hypot(state.quarry.x - state.lens.x, state.quarry.y - state.lens.y);
}

/**
 * How well the lens is holding the mark, 0..1. This is the whole scoring
 * rule: 1 dead centre, tapering to 0 at the rim of the lens, so a player who
 * keeps the animal in the middle locks on markedly faster than one who lets
 * it ride the edge. The quarry's own body counts, which is why a big slow
 * animal is easier to hold than its speed alone suggests.
 */
export function markHold(state: HuntScopeState): number {
  const reach = huntWeaponProfile(state.weapon).lensRadius + QUARRY_RADIUS;
  if (reach <= 0) return 0;
  return clamp01(1 - markDistance(state) / reach);
}

/**
 * Advance one frame.
 *
 * `lens` is where the player's finger has put the lens THIS frame, in patch
 * fractions -- the caller reads that off a drag and this module stays out of
 * input entirely, the same contract `stepFishingGauge`'s `holding` flag
 * keeps. Lens speed is derived here rather than passed in, so a caller
 * cannot accidentally under-report a snatch.
 *
 * Returns a new state; a finished stalk returns itself untouched, so a scene
 * that keeps calling update through its own exit tween cannot flip a bagged
 * animal back to fled.
 */
export function stepHuntScope(
  state: HuntScopeState,
  dtMs: number,
  lens: ScopePoint,
  random: () => number = Math.random,
): HuntScopeState {
  if (state.phase === "bagged" || state.phase === "fled") return state;

  const frameMs = clampFrameMs(dtMs);
  const dt = frameMs / 1000;
  if (dt === 0) return state;

  const weapon = huntWeaponProfile(state.weapon);
  const profile = quarryProfile(state.species);

  // The lens goes exactly where the finger put it -- this is a drag, not a
  // body with momentum -- but how FAR it travelled to get there is what the
  // animal reacts to.
  const nextLens = clampInside(lens, weapon.lensRadius);
  const travelled = Math.hypot(nextLens.x - state.lens.x, nextLens.y - state.lens.y);
  const lensSpeed = travelled / dt;

  // Quarry: walk to the spot it picked, stand on it for a while, then pick
  // another -- the same idle/roam shape ./wildlife.ts's `stepPeacefulCreature`
  // already gives a wandering animal. Standing still is not a detail here; it
  // is the only moment the stalk can be won. Both branches roll from the same
  // RNG, so a seeded sequence replays a whole stalk exactly.
  let restMs = state.restMs;
  let quarryTarget = state.quarryTarget;
  let quarry = state.quarry;
  let quarryMode = state.quarryMode;

  if (quarryMode === "resting") {
    restMs -= frameMs;
    if (restMs <= 0) {
      quarryTarget = rollQuarryTarget(random);
      quarryMode = "moving";
    }
  } else {
    const step = profile.speed * dt;
    const dx = quarryTarget.x - quarry.x;
    const dy = quarryTarget.y - quarry.y;
    const toTarget = Math.hypot(dx, dy);
    if (toTarget <= step || toTarget < 1e-6) {
      quarry = quarryTarget;
      quarryMode = "resting";
      restMs = rollRestMs(profile, random);
    } else {
      quarry = { x: quarry.x + (dx / toTarget) * step, y: quarry.y + (dy / toTarget) * step };
    }
  }
  quarry = clampInside(quarry, QUARRY_RADIUS);

  const moved: HuntScopeState = {
    ...state,
    lens: nextLens,
    quarry,
    quarryTarget,
    quarryMode,
    restMs,
  };
  const hold = markHold(moved);
  const steady = clamp01(1 - lensSpeed / STEADY_SPEED);

  // Lock: needs the mark inside the lens AND a hand that has stopped moving.
  // Either one alone builds nothing, which is what makes "wait for it to
  // stand still" the answer rather than "drag the circle onto it".
  const lockDelta =
    hold > 0 ? weapon.lockPerSec * hold * steady * dt : -weapon.lockDrainPerSec * dt;
  const lock = clamp01(moved.lock + lockDelta);

  // Spook: the stalk's own clock, plus whatever a watching animal caught.
  // Only a RESTING animal is watching, and only within `NOTICE_RADIUS` of the
  // lens, so repositioning while it walks and sweeping the far brush are both
  // free -- see `NOTICE_SPEED`.
  let spookDelta = profile.warinessPerSec * dt;
  const watching = quarryMode === "resting";
  const notice = clamp01(1 - markDistance(moved) / NOTICE_RADIUS);
  if (watching && notice > 0 && lensSpeed > NOTICE_SPEED) {
    const overshoot = lensSpeed - NOTICE_SPEED;
    spookDelta += overshoot * (1 - weapon.steadiness) * profile.jumpiness * notice * dt;
  }
  const spook = clamp01(moved.spook + spookDelta);

  const phase: HuntScopePhase = spook >= 1 ? "fled" : lock >= 1 ? "locked" : "stalking";

  return {
    ...moved,
    lock,
    spook,
    phase,
    elapsedMs: state.elapsedMs + frameMs,
    onMarkMs: state.onMarkMs + (hold > 0 ? frameMs : 0),
  };
}

/**
 * Takes the mark. The one transition the player drives rather than the
 * simulation: pressing Use while locked. Pressing it at any other moment is
 * a deliberate no-op returning the same state, NOT a miss that spooks the
 * animal -- an accidental press should never cost a stalk the player had
 * already earned, and a young player mashing Use while tracking is the
 * expected way to learn what the key does.
 */
export function takeMark(state: HuntScopeState): HuntScopeState {
  if (state.phase !== "locked") return state;
  return { ...state, phase: "bagged" };
}

/**
 * Gives the stalk up as a loss. The shell calls this when the player closes
 * the overlay some other way (a back press, a route change) so a stalk
 * always ends in one of the two outcomes this module defines, never in a
 * scene still running with nobody watching. Mirrors the fishing gauge's own
 * `giveUp`.
 */
export function abandonStalk(state: HuntScopeState): HuntScopeState {
  if (state.phase === "bagged" || state.phase === "fled") return state;
  return { ...state, phase: "fled", spook: 1 };
}

/**
 * How close the animal is to bolting, 0..1, for whatever the scene wants to
 * redden or shake. This is `spook` itself rather than a second tracked
 * value, for the same reason `gaugeTension` mirrors `progress`: one number
 * decides the stalk, so one number drives the tell.
 */
export function stalkAlarm(state: HuntScopeState): number {
  return state.spook;
}
