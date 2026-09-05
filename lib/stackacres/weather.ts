/**
 * Weather: an ambient modifier layer over a session's farm, the same
 * "pure math, dumb scene" split as ./sunlight.ts -- WeatherOverlayManager
 * (components/arcade/stackacres/weather-overlay-manager.ts) owns textures,
 * blend modes and the camera-pinned GameObjects; this file owns every
 * number and every transition.
 *
 * WHY THIS IS INTERNAL TO STACKACRES, NOT POKER-DRIVEN. An earlier draft of
 * this spec proposed poker session events as the trigger. Rejected (Kayo,
 * 2026-09-04): poker and StackAcres are unrelated systems everywhere else in
 * this codebase (their own stores, their own currency history), and wiring
 * one to shift the other's weather would be a new, undocumented cross-system
 * dependency with no product reason behind it. Weather here rolls off
 * StackAcres' own clock -- `stepWeather` is a pure function of elapsed time
 * and a seeded random source, the same contract every other ambient effect
 * on this map already holds (see ./sunlight.ts, ./ambience-plan.ts).
 *
 * WHY THE ECONOMY SIDE IS COSMETIC-ONLY FOR THIS PASS. The spec also asked
 * for weather to alter the flat daily Gold ceiling (DRY_SPELL: -2,000/day).
 * Rejected for the same reason ./exchange.ts's own header exists: the flat
 * per-player daily ceiling is the one number in this subsystem every other
 * file is careful never to move, and moving it from a per-session weather
 * roll -- reversible by waiting the weather out, invisible until the day's
 * bill lands -- is exactly the shape of thing that turned Ante Up into a
 * money printer (see CLAUDE.md's Ante Up entries). `applyWeatherModifiers`
 * computes `upkeepCeilingDelta` and returns it, but nothing in this module
 * or in WeatherOverlayManager feeds it into `stackacresUpkeepFee` or the
 * real ceiling -- it is reported for a future, separately-reviewed pass.
 * DO NOT wire this into settlement without redoing the review that gated it.
 *
 * The crit/cost side is different and IS live: `critChanceBonus` only
 * changes how fast a session's own bucket fills -- exactly the thing
 * ./bounty.ts's synergy multiplier already does -- never how big the bucket
 * is, so it carries none of the risk above.
 */

import type { WorldRect } from "./world";

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

export enum StackAcresWeather {
  CLEAR = "clear",
  SOLAR_FLARE = "solar_flare",
  GOLD_RUSH_RAIN = "gold_rush_rain",
  DRY_SPELL = "dry_spell",
}

/** Every state, in a stable order used by tests and by `rollNextWeather`. */
export const STACKACRES_WEATHER_STATES: readonly StackAcresWeather[] = Object.freeze([
  StackAcresWeather.CLEAR,
  StackAcresWeather.SOLAR_FLARE,
  StackAcresWeather.GOLD_RUSH_RAIN,
  StackAcresWeather.DRY_SPELL,
]);

export interface WeatherModifierDef {
  /** Added to a tool tier's own `critChance` (./equipment.ts) before the
   *  caller's own roll and clamp. Fills the day's bucket faster; never
   *  raises the bucket -- see file header. */
  critChanceBonus: number;
  /** Fraction knocked off a harvest's yield before crit, 0..1. 0.05 is a 5%
   *  penalty, i.e. the yield is multiplied by 0.95. */
  costPenalty: number;
  /** Whether this state wants every ready unit swept automatically rather
   *  than waiting for a tap. A signal only -- this module never calls a
   *  collection route itself; see the header on WeatherOverlayManager for
   *  the wiring point that reads it. */
  autoCollect: boolean;
  /**
   * Gold, COMPUTED ONLY -- never applied. See this file's header. Kept on
   * the def (rather than left unmodeled) so a future, reviewed pass has one
   * place to read the intended number from instead of re-deriving it.
   */
  upkeepCeilingDelta: number;
}

export const STACKACRES_WEATHER_DEFS: Readonly<Record<StackAcresWeather, WeatherModifierDef>> = Object.freeze({
  [StackAcresWeather.CLEAR]: {
    critChanceBonus: 0,
    costPenalty: 0,
    autoCollect: false,
    upkeepCeilingDelta: 0,
  },
  [StackAcresWeather.SOLAR_FLARE]: {
    critChanceBonus: 0.1,
    costPenalty: 0.05,
    autoCollect: false,
    upkeepCeilingDelta: 0,
  },
  [StackAcresWeather.GOLD_RUSH_RAIN]: {
    critChanceBonus: 0,
    costPenalty: 0,
    autoCollect: true,
    upkeepCeilingDelta: 0,
  },
  [StackAcresWeather.DRY_SPELL]: {
    critChanceBonus: 0,
    costPenalty: 0,
    autoCollect: false,
    upkeepCeilingDelta: -2_000,
  },
});

/* ------------------------------------------------------------------ */
/* The modifier hook                                                   */
/* ------------------------------------------------------------------ */

export interface WeatherModifierResult {
  /** `baseYield` after the state's cost penalty. Never negative. */
  adjustedYield: number;
  /** Add to a tool tier's own critChance before rolling. */
  critChanceBonus: number;
  /** Computed only -- see file header. Not applied by anything here. */
  upkeepCeilingDelta: number;
  /** See `WeatherModifierDef.autoCollect`. */
  autoCollect: boolean;
}

/**
 * Plugs directly into the inventory delta calculation pipeline: given what a
 * unit would otherwise yield and the weather active when it settles, returns
 * what actually applies.
 *
 * Pure and total -- an unrecognized state (should never happen; the enum is
 * closed) falls back to CLEAR rather than throwing, the same defensive
 * posture ./harvest.ts's own clamps take.
 */
export function applyWeatherModifiers(
  baseYield: number,
  activeWeather: StackAcresWeather,
): WeatherModifierResult {
  const def = STACKACRES_WEATHER_DEFS[activeWeather] ?? STACKACRES_WEATHER_DEFS[StackAcresWeather.CLEAR];
  const safeYield = Number.isFinite(baseYield) ? Math.max(0, baseYield) : 0;
  return {
    adjustedYield: Math.max(0, safeYield * (1 - def.costPenalty)),
    critChanceBonus: def.critChanceBonus,
    upkeepCeilingDelta: def.upkeepCeilingDelta,
    autoCollect: def.autoCollect,
  };
}

/* ------------------------------------------------------------------ */
/* The session clock: when weather shifts                              */
/* ------------------------------------------------------------------ */

/**
 * How long a state holds before it is even eligible to roll again, ms.
 * Long enough to read as a session event rather than a strobe -- the same
 * reasoning GOD_RAY_PERIOD_MS states in ./sunlight.ts, at a scale that suits
 * something the player is meant to notice rather than merely feel.
 */
export const WEATHER_MIN_HOLD_MS = 45_000;

/**
 * Chance, on each `stepWeather` call once a state is past its minimum hold,
 * that it rolls to something else. Checked at roughly one frame's cadence
 * (the caller clamps its own delta below), so this is small on purpose --
 * it is a per-frame chance, not a per-window one, and a large value here
 * would flip the state almost the instant it becomes eligible.
 */
export const WEATHER_SHIFT_CHANCE = 0.0025;

export interface WeatherSessionState {
  active: StackAcresWeather;
  /** ms since `active` became the active state. */
  heldMs: number;
}

export function initialWeatherState(): WeatherSessionState {
  return { active: StackAcresWeather.CLEAR, heldMs: 0 };
}

/**
 * One frame of the weather clock. Internal to StackAcres -- driven only by
 * elapsed play time and a seeded random source, never by an event from
 * another subsystem. See this file's header for why poker was rejected as
 * a trigger.
 *
 * `deltaMs` is clamped the same way `stepSparkle` clamps its own delta: a
 * tab returning from the background can hand this a multi-second delta, and
 * without the clamp that single frame could both cross the hold window and
 * win the shift roll, which would make a backgrounded tab a reliable way to
 * force a shift.
 */
export function stepWeather(
  state: WeatherSessionState,
  deltaMs: number,
  random: () => number,
): WeatherSessionState {
  const step = Math.min(Math.max(deltaMs, 0), 250);
  const heldMs = state.heldMs + step;
  if (heldMs < WEATHER_MIN_HOLD_MS) return { ...state, heldMs };
  if (random() >= WEATHER_SHIFT_CHANCE) return { ...state, heldMs };
  return { active: rollNextWeather(state.active, random), heldMs: 0 };
}

/** The next state, never the one just held. */
function rollNextWeather(current: StackAcresWeather, random: () => number): StackAcresWeather {
  const pool = STACKACRES_WEATHER_STATES.filter((w) => w !== current);
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index] ?? StackAcresWeather.CLEAR;
}

/* ------------------------------------------------------------------ */
/* Camera tint                                                         */
/* ------------------------------------------------------------------ */

export interface WeatherTint {
  r: number;
  g: number;
  b: number;
  /** 0..1, the overlay's own alpha. 0 is "draw nothing" -- CLEAR's tint. */
  intensity: number;
}

/**
 * One tint per state, hand-picked against the app's own palette
 * (feedback_stackchips_visual_identity: green felt, gold table, violet-black
 * chrome). Kept low-intensity across the board for the reason
 * GOD_RAY_MAX_ALPHA states in ./sunlight.ts: StackAcres is flat, three-tone
 * vector art, and a strong screen-wide tint washes its material reads out.
 */
const WEATHER_TINTS: Readonly<Record<StackAcresWeather, WeatherTint>> = Object.freeze({
  [StackAcresWeather.CLEAR]: { r: 255, g: 255, b: 255, intensity: 0 },
  [StackAcresWeather.SOLAR_FLARE]: { r: 255, g: 178, b: 72, intensity: 0.16 },
  [StackAcresWeather.GOLD_RUSH_RAIN]: { r: 255, g: 214, b: 120, intensity: 0.12 },
  [StackAcresWeather.DRY_SPELL]: { r: 214, g: 186, b: 138, intensity: 0.14 },
});

/** How long a tint cross-fade takes, ms. Matches the pace a player can
 *  actually watch happen -- much faster and a shift reads as a flicker,
 *  much slower and the overlay lags the particle layer visibly changing
 *  underneath it. */
export const WEATHER_TINT_TRANSITION_MS = 2_600;

/**
 * The tint at `progressMs` into a transition from `from` to `to`, linearly
 * interpolated and clamped at both ends. Called once a frame by
 * WeatherOverlayManager; never mutates, never looks anything up beyond the
 * two states it is given.
 */
export function interpolateWeatherTint(
  from: StackAcresWeather,
  to: StackAcresWeather,
  progressMs: number,
): WeatherTint {
  const t = clamp01(WEATHER_TINT_TRANSITION_MS > 0 ? progressMs / WEATHER_TINT_TRANSITION_MS : 1);
  const a = WEATHER_TINTS[from] ?? WEATHER_TINTS[StackAcresWeather.CLEAR];
  const b = WEATHER_TINTS[to] ?? WEATHER_TINTS[StackAcresWeather.CLEAR];
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
    intensity: lerp(a.intensity, b.intensity, t),
  };
}

/** A tint's color packed as Phaser's 0xRRGGBB, for `Image.setTint`. */
export function packWeatherTint(t: WeatherTint): number {
  const r = clampByte(t.r);
  const g = clampByte(t.g);
  const b = clampByte(t.b);
  return (r << 16) | (g << 8) | b;
}

/* ------------------------------------------------------------------ */
/* Solar dust (SOLAR_FLARE)                                            */
/* ------------------------------------------------------------------ */

/** Hard pool size, not a spawn rate -- same contract SPARKLE_MAX states in
 *  ./sunlight.ts. Allocated once by the manager and recycled forever. */
export const SOLAR_DUST_MAX = 10;
export const SOLAR_DUST_MIN_LIFE_MS = 1_600;
export const SOLAR_DUST_MAX_LIFE_MS = 3_400;
/** World units a second, upward. Slower than a ground sparkle's drift
 *  (./sunlight.ts) -- this is dust suspended in a shaft of light, not a
 *  catch of light on the ground. */
export const SOLAR_DUST_RISE = 1.4;

export interface SolarDustMote {
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
}

export function spawnSolarDust(area: WorldRect, random: () => number): SolarDustMote {
  return {
    x: area.x + random() * area.width,
    y: area.y + random() * area.height,
    ageMs: 0,
    lifeMs: SOLAR_DUST_MIN_LIFE_MS + random() * (SOLAR_DUST_MAX_LIFE_MS - SOLAR_DUST_MIN_LIFE_MS),
  };
}

export function stepSolarDust(mote: SolarDustMote, deltaMs: number): SolarDustMote | null {
  const step = Math.min(Math.max(deltaMs, 0), 64);
  const ageMs = mote.ageMs + step;
  if (ageMs >= mote.lifeMs) return null;
  return { ...mote, ageMs, y: mote.y - (SOLAR_DUST_RISE * step) / 1000 };
}

/** Up slow, down slow -- a mote drifting through light, not catching it and
 *  losing it the way a ground sparkle does. */
export function solarDustAlpha(mote: SolarDustMote): number {
  const t = clamp01(mote.lifeMs > 0 ? mote.ageMs / mote.lifeMs : 1);
  return t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
}

/** One frame of the whole field. Same refill-to-ceiling shape as
 *  `sparkleField`: ages and drops what is spent, refills every free slot,
 *  so the live count never exceeds `SOLAR_DUST_MAX`. */
export function solarDustField(
  live: readonly SolarDustMote[],
  area: WorldRect,
  deltaMs: number,
  random: () => number,
): SolarDustMote[] {
  const next: SolarDustMote[] = [];
  for (const mote of live) {
    if (next.length >= SOLAR_DUST_MAX) break;
    const stepped = stepSolarDust(mote, deltaMs);
    if (stepped) next.push(stepped);
  }
  while (next.length < SOLAR_DUST_MAX) next.push(spawnSolarDust(area, random));
  return next;
}

/* ------------------------------------------------------------------ */
/* Rain streaks (GOLD_RUSH_RAIN)                                        */
/* ------------------------------------------------------------------ */

/** Hard pool size -- same fixed-cost contract as the dust field above. */
export const RAIN_STREAK_MAX = 18;
/** Screen-fraction units a second, downward. Fast enough to read as rain
 *  rather than as falling dust. */
export const RAIN_STREAK_SPEED = 1.1;
/** The streak's own lean, matching GOD_RAY_TILT's role in ./sunlight.ts:
 *  radians clockwise from straight down. */
export const RAIN_STREAK_TILT = 0.18;

/** One streak, in SCREEN-FRACTION space (0..1 of the viewport), the same
 *  space `GodRayBeam` uses in ./sunlight.ts -- so the same field renders
 *  correctly at any viewport size with no rescaling. `y` runs from -0.1
 *  (just above frame) to 1.1 (just below) and wraps. */
export interface RainStreak {
  x: number;
  y: number;
}

export function spawnRainStreak(random: () => number): RainStreak {
  return { x: random(), y: -0.1 - random() * 0.4 };
}

/** One frame of the whole field. Streaks that fall past the bottom wrap to
 *  a fresh spawn above the frame rather than being dropped and refilled --
 *  cheaper, and indistinguishable on screen from a new one. */
export function rainStreakField(
  live: readonly RainStreak[],
  deltaMs: number,
  random: () => number,
): RainStreak[] {
  const step = Math.min(Math.max(deltaMs, 0), 64) / 1000;
  const next: RainStreak[] = [];
  for (const streak of live) {
    if (next.length >= RAIN_STREAK_MAX) break;
    const y = streak.y + RAIN_STREAK_SPEED * step;
    next.push(y > 1.1 ? spawnRainStreak(random) : { x: streak.x, y });
  }
  while (next.length < RAIN_STREAK_MAX) next.push(spawnRainStreak(random));
  return next;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
