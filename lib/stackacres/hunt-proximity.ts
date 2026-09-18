/**
 * The stalk itself, played on the open world instead of behind glass.
 *
 * Replaces this module's own previous shape (a lens-and-lock minigame drawn
 * inside a fenced-off patch): there is no modal patch any more, no drag
 * target, no bow/rifle lens size or lock rate. The player walks up to the
 * quarry on the same ground the farm stands on, and the whole skill check is
 * proximity plus patience -- get close enough while `alertMeter` is still
 * under `ALERT_MAX`, then press Use.
 *
 * WHAT STAYS. ./hunting.ts still decides WHICH quarry a bagged stalk gives
 * (the server's roll inside `bag-quarry`) and nothing here reads or writes
 * that. `QUARRY_PROFILES`' idle/roam shape -- walk to a spot, stand on it,
 * pick another -- is kept exactly, because it is the same shape
 * ./wildlife.ts's `stepPeacefulCreature` already gives every other
 * wandering animal on this map; only the space it moves in changed, from a
 * 0..1 patch fraction to the world's own device-pixel units (see
 * ./world.ts's `WorldPoint`). And RED-LIGHT-GREEN-LIGHT survives too: an
 * animal only reads what is happening near it while it is standing still and
 * looking around (`quarryMode === "resting"`); while it is walking, it is
 * busy, and closing distance is free. That pair of rules was measured and
 * kept after two speed-based alternatives failed playtests (see git history
 * on this module's prior lens-based form), and nothing about moving the
 * stalk onto the open map changes why it works.
 *
 * WHAT'S GONE. No lens radius, no lock meter, no "hold the mark", no vector
 * aiming line, no bow-draw or rifle-shot trajectory. A weapon now changes
 * exactly one pair of numbers -- `focusRadius`, how close is close enough,
 * and `approachDiscount`, how much of a rushed final approach it forgives --
 * and nothing about how the world is drawn. The rifle is still the earned
 * reward (see ./hunting.ts's `RIFLE_LEVEL`); it just reaches farther and
 * forgives more instead of aiming steadier.
 *
 * Every function takes its RNG as a parameter, same reason ./hunting.ts's
 * `pickQuarry` does: a test hands it a fixed sequence instead of patching
 * `Math.random`.
 */

import { QUARRY_SPECIES, type HuntingWeapon, type QuarrySpecies } from "./hunting";
import { clampFrameMs, type WorldPoint } from "./world";

/** How far the quarry's own body reaches from its centre, in world units.
 *  One tile's worth: big enough that "adjacent" reads as adjacent. */
export const QUARRY_RADIUS = 12;

/**
 * Half-width of the square the quarry wanders inside, centred on where the
 * stalk started. Keeps a fled-from Deer from wandering the whole map before
 * the player ever finds it, and keeps every stalk playable on whatever patch
 * of ground the player walked up to.
 */
export const ROAM_HALF_EXTENT = 140;

/**
 * How fast the player has to be moving, in world units per second, before an
 * ALERT (resting) animal counts it as movement rather than standing still.
 * Below this a plant sway or a camera settle jitter would otherwise read as
 * a step.
 */
const PLAYER_STILL_SPEED = 6;

/**
 * How far a moving player is noticed by an alert animal, in world units --
 * deliberately wider than any `focusRadius`: what gives a stalker away is
 * closing in while it is watching, not already standing next to it.
 */
const NOTICE_RADIUS = 110;

/** How long a stalk may run before wariness alone ends it, in seconds, at a
 *  species' baseline. Not enforced as a timer -- it falls out of
 *  `warinessPerSec` filling `alertMeter` -- but it is the number that field
 *  is tuned against, and it keeps a stalk inside one held breath. */
export const STALK_PATIENCE_SEC = 18;

/** Alert runs 0..100 rather than 0..1: the number a floating gauge draws
 *  directly, with no scaling at the call site. */
export const ALERT_MAX = 100;

export interface HuntWeaponProfile {
  /** The focus range window: how close the player must be to the quarry's
   *  centre to attempt a catch, in world units. The Telephoto Lens Scanner
   *  reaches farther -- it is a Level 4 reward, and a reward that only a
   *  camera's own arm's-length approach could use would not read as one
   *  (see ./hunting.ts's `RIFLE_UNLOCK`). */
  readonly focusRadius: number;
  /** 0..1, how much of a rushed final approach's alert cost the weapon
   *  forgives. The rifle means a longer, steadier hold from farther back;
   *  the bow means getting properly close and staying careful the whole
   *  way in. */
  readonly approachDiscount: number;
}

/** Bow first, rifle at Level 4 (see ./hunting.ts's `RIFLE_UNLOCK`). The
 *  rifle is better at both numbers, deliberately -- it is earned, and
 *  StackAcres' audience should not have to work out a trade-off to know an
 *  upgrade happened. The stalk stays hard because the QUARRY scales, not
 *  because the tool fights the player. */
export const HUNT_WEAPON_PROFILES: Readonly<Record<HuntingWeapon, HuntWeaponProfile>> = {
  bow: {
    focusRadius: 26,
    approachDiscount: 0,
  },
  rifle: {
    focusRadius: 46,
    approachDiscount: 0.35,
  },
};

export interface QuarryProfile {
  /** World units/second the animal moves toward its next spot at. */
  readonly speed: number;
  /** How long it STANDS STILL on arrival before picking somewhere new, in
   *  ms -- the only window a catch can actually be forced without chasing,
   *  since a moving animal keeps outrunning `focusRadius`. */
  readonly restMinMs: number;
  readonly restMaxMs: number;
  /** Alert/second the animal accrues just by being stalked -- the clock on
   *  the whole encounter. */
  readonly warinessPerSec: number;
  /** How hard a close, moving approach lands on this animal's alert, as a
   *  multiplier. */
  readonly jumpiness: number;
}

/** Per-species difficulty, read against ./hunting.ts's own `QUARRY_WEIGHTS`:
 *  a Rabbit is 55% of stalks and the forgiving one, a Boar is 13% and the
 *  one worth the walk. At baseline a Rabbit gives roughly the full
 *  `STALK_PATIENCE_SEC` before wariness alone ends it, a Boar closer to
 *  half. */
export const QUARRY_PROFILES: Readonly<Record<QuarrySpecies, QuarryProfile>> = {
  rabbit: {
    speed: 34,
    restMinMs: 900,
    restMaxMs: 1600,
    warinessPerSec: 1 / STALK_PATIENCE_SEC,
    jumpiness: 0.8,
  },
  deer: {
    speed: 48,
    restMinMs: 650,
    restMaxMs: 1150,
    warinessPerSec: 1.45 / STALK_PATIENCE_SEC,
    jumpiness: 1.15,
  },
  boar: {
    speed: 64,
    restMinMs: 420,
    restMaxMs: 820,
    warinessPerSec: 1.8 / STALK_PATIENCE_SEC,
    jumpiness: 1.5,
  },
};

/**
 * `stalking` -- tracking, out of the focus range window (or too alert to
 *               try).
 * `inRange`  -- close enough that Use would attempt a catch right now; the
 *               scene's own cue to show the quick-time prompt.
 * `bagged`   -- Use was pressed while `inRange` and alert was under
 *               `ALERT_MAX`. The one winning end.
 * `fled`     -- alert filled: the animal was startled off before the shot
 *               was taken. No catch, no cost.
 */
export type HuntProximityPhase = "stalking" | "inRange" | "bagged" | "fled";

export interface HuntProximityState {
  readonly species: QuarrySpecies;
  readonly weapon: HuntingWeapon;
  readonly phase: HuntProximityPhase;
  readonly player: WorldPoint;
  readonly quarry: WorldPoint;
  readonly quarryTarget: WorldPoint;
  /** Whether it is walking to its spot or standing on it -- "alert" in the
   *  sense that only a resting animal is watching (see this file's header
   *  on the red-light-green-light rule). */
  readonly quarryMode: "moving" | "resting";
  /** While `resting`, how long it stays put. Counts down only then. */
  readonly restMs: number;
  /** 0..`ALERT_MAX`. Filling it ends the stalk in `fled`. */
  readonly alertMeter: number;
  readonly elapsedMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rollWithin(origin: WorldPoint, halfExtent: number, random: () => number): WorldPoint {
  return {
    x: origin.x + (random() * 2 - 1) * halfExtent,
    y: origin.y + (random() * 2 - 1) * halfExtent,
  };
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

/** Which difficulty a fresh stalk plays at, weighted the same way the
 *  reward roll is, so the stalk a player fights is as hard as the thing
 *  they are statistically about to be given -- without this module ever
 *  learning what that thing turns out to be. */
export function rollQuarryDifficulty(random: () => number = Math.random): QuarrySpecies {
  const roll = random() * QUARRY_SPECIES.length;
  return QUARRY_SPECIES[Math.min(QUARRY_SPECIES.length - 1, Math.floor(roll))];
}

/**
 * A fresh stalk, centred on where the player is standing when it starts.
 * The quarry spawns already partway into a roam, so the first frame has
 * something to follow rather than a still picture.
 */
export function createHuntProximityState(
  species: QuarrySpecies,
  weapon: HuntingWeapon,
  player: WorldPoint,
  random: () => number = Math.random,
): HuntProximityState {
  return {
    species,
    weapon,
    phase: "stalking",
    player,
    quarry: rollWithin(player, ROAM_HALF_EXTENT, random),
    quarryTarget: rollWithin(player, ROAM_HALF_EXTENT, random),
    quarryMode: "moving",
    restMs: 0,
    alertMeter: 0,
    elapsedMs: 0,
  };
}

/** Distance from the player to the quarry's centre, in world units. */
export function markDistance(state: HuntProximityState): number {
  return distance(state.player, state.quarry);
}

/** Whether the player is close enough to attempt a catch right now. */
export function inFocusRange(state: HuntProximityState): boolean {
  return markDistance(state) <= huntWeaponProfile(state.weapon).focusRadius;
}

/**
 * Advance one frame.
 *
 * `player` is where the caller's own movement has put the farmer this frame,
 * in world units -- the same space the map already tracks him in. Player
 * speed is derived here rather than passed in, so a caller cannot
 * accidentally under-report closing in fast.
 *
 * Returns a new state; a finished stalk (`bagged`/`fled`) returns itself
 * untouched, so a caller that keeps stepping through its own exit animation
 * cannot flip a bagged animal back to fled.
 */
export function stepHuntProximity(
  state: HuntProximityState,
  dtMs: number,
  player: WorldPoint,
  random: () => number = Math.random,
): HuntProximityState {
  if (state.phase === "bagged" || state.phase === "fled") return state;

  const frameMs = clampFrameMs(dtMs);
  const dt = frameMs / 1000;
  if (dt === 0) return state;

  const weapon = huntWeaponProfile(state.weapon);
  const profile = quarryProfile(state.species);

  const playerSpeed = distance(player, state.player) / dt;

  // Quarry: walk to the spot it picked, stand on it for a while, then pick
  // another -- the same idle/roam shape ./wildlife.ts's own
  // `stepPeacefulCreature` gives every other wandering animal, kept
  // identical here other than the space it moves in.
  let restMs = state.restMs;
  let quarryTarget = state.quarryTarget;
  let quarry = state.quarry;
  let quarryMode = state.quarryMode;

  if (quarryMode === "resting") {
    restMs -= frameMs;
    if (restMs <= 0) {
      quarryTarget = rollWithin(player, ROAM_HALF_EXTENT, random);
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

  const moved: HuntProximityState = {
    ...state,
    player,
    quarry,
    quarryTarget,
    quarryMode,
    restMs,
  };

  // Alert: the stalk's own clock, plus whatever a watching animal caught.
  // Only a RESTING animal is watching (red light, green light -- see this
  // file's header), and only within `NOTICE_RADIUS`, so closing distance
  // while it walks is free and only a moving approach while it is standing
  // still and looking around costs anything.
  let alertDelta = profile.warinessPerSec * ALERT_MAX * dt;
  const watching = quarryMode === "resting";
  const near = distance(player, quarry) <= NOTICE_RADIUS;
  if (watching && near && playerSpeed > PLAYER_STILL_SPEED) {
    const closing = (playerSpeed - PLAYER_STILL_SPEED) * (1 - weapon.approachDiscount) * profile.jumpiness;
    alertDelta += closing * dt * 0.15;
  }
  const alertMeter = clamp(moved.alertMeter + alertDelta, 0, ALERT_MAX);

  const phase: HuntProximityPhase =
    alertMeter >= ALERT_MAX ? "fled" : inFocusRange(moved) ? "inRange" : "stalking";

  return {
    ...moved,
    alertMeter,
    phase,
    elapsedMs: state.elapsedMs + frameMs,
  };
}

/**
 * Takes the mark: the player's own Use press. Succeeds only while `inRange`
 * and under `ALERT_MAX` -- both already true of every `inRange` state, since
 * `stepHuntProximity` only sets that phase when alert has not filled, but
 * checked again here so a press that lands the same frame alert tips over
 * cannot sneak a catch through.
 *
 * Pressed at any other moment, this is a deliberate no-op returning the same
 * state, NOT a miss that costs the stalk -- an accidental press should never
 * cost a stalk the player had not yet earned, and a young player mashing
 * Use while tracking is the expected way to learn what the key does.
 */
export function attemptCatch(state: HuntProximityState): HuntProximityState {
  if (state.phase !== "inRange") return state;
  if (state.alertMeter >= ALERT_MAX) return state;
  return { ...state, phase: "bagged" };
}

/**
 * Gives the stalk up as a loss. The caller reaches for this when the player
 * closes the encounter some other way (a back press, walking far enough
 * off, a route change) so a stalk always ends in `bagged` or `fled`, never
 * left running with nobody watching.
 */
export function abandonStalk(state: HuntProximityState): HuntProximityState {
  if (state.phase === "bagged" || state.phase === "fled") return state;
  return { ...state, phase: "fled", alertMeter: ALERT_MAX };
}

/** How close the animal is to being startled off, 0..1, for whatever the
 *  caller wants to redden or shake -- `alertMeter` itself, scaled down to a
 *  fraction. */
export function stalkAlarm(state: HuntProximityState): number {
  return state.alertMeter / ALERT_MAX;
}
