/**
 * Juice & Feedback: configuration and pure math for StackAcres's tap-driven
 * impact effects -- the harvest pop, the crit flash, and the barn-absorb
 * flight.
 *
 * PHASER-FREE ON PURPOSE, the same rule ./crop-visuals.ts states at its own
 * top: vitest only reaches lib/ and app/, so every number and curve a test
 * can hold to its value lives here. The only caller,
 * components/arcade/stackacres/game-juice-manager.ts, owns none of these
 * decisions -- it plays them back through Phaser and nothing else.
 *
 * THERE IS NO "TOMATO" IN THIS FARM. StackAcres' crop track is carrot
 * (`sprout`) and corn (`cash_crop`); livestock pays eggs, wool and milk (see
 * ./catalogue.ts and ./items.ts). This file styles all five real items
 * StackAcres actually pays out, not an invented sixth -- a "tomato" style
 * would be dead config nothing ever looks up.
 */

import { STACKACRES_STOCK, type StackAcresStock } from "./catalogue";
import { STACKACRES_YIELDS, type StackAcresItem } from "./items";

/* ------------------------------------------------------------------ */
/* Harvest pop: procedural shard styling per stock                     */
/* ------------------------------------------------------------------ */

/**
 * One stock's harvest-pop shard style.
 *
 * `ramp` names a components/arcade/stackacres/art-palette.ts RAMPS entry,
 * kept a plain string for the same reason StackAcresItemDef.icon (./items.ts)
 * is: this file stays free of a components/ import, and the caller casts the
 * name back to `RampName` to look the colour up.
 */
export interface JuiceShardStyle {
  /** RAMPS key the shard's fill is drawn from. */
  ramp: string;
  /** How many shards one harvest pop throws. */
  shardCount: number;
  /** Shard fill radius, screen px, before any crit scaling. */
  shardRadius: number;
  /** Outward launch speed range, screen px/s. */
  speed: { min: number; max: number };
  /** Downward accel applied after launch, screen px/s^2. A crop's husk or
   *  kernel falls harder than livestock's soft produce drifting down --
   *  this is the whole reason gravity is per-style and not one constant. */
  gravity: number;
  /** How long a shard lives, ms. */
  lifeMs: { min: number; max: number };
}

/**
 * Every real StackAcres stock gets a style; nothing here is optional.
 * Crops throw hard, small, fast-falling shards (a kernel or a shred of
 * leaf popping off); livestock throws softer, slower, longer-hanging
 * puffs (a feather, a tuft of fleece, a splash of milk) -- the same
 * "which track is this" split ./catalogue.ts's own `isLivestock` draws
 * everywhere else, just spent on how a burst FEELS instead of how it is
 * tended.
 */
export const STACKACRES_JUICE_STYLES: Readonly<Record<StackAcresStock, JuiceShardStyle>> = {
  sprout: {
    ramp: "carrot",
    shardCount: 9,
    shardRadius: 2.2,
    speed: { min: 70, max: 150 },
    gravity: 340,
    lifeMs: { min: 380, max: 620 },
  },
  cash_crop: {
    ramp: "corn",
    shardCount: 12,
    shardRadius: 2.6,
    speed: { min: 100, max: 200 },
    gravity: 420,
    lifeMs: { min: 420, max: 680 },
  },
  hen: {
    ramp: "chalk",
    shardCount: 7,
    shardRadius: 2,
    speed: { min: 50, max: 110 },
    gravity: 220,
    lifeMs: { min: 460, max: 720 },
  },
  pig: {
    ramp: "chalk",
    shardCount: 10,
    shardRadius: 2.4,
    speed: { min: 60, max: 120 },
    gravity: 200,
    lifeMs: { min: 500, max: 780 },
  },
  cattle: {
    ramp: "chalk",
    shardCount: 8,
    shardRadius: 2.8,
    speed: { min: 40, max: 90 },
    gravity: 160,
    lifeMs: { min: 560, max: 860 },
  },
};

export function juiceStyleFor(stock: StackAcresStock): JuiceShardStyle {
  return STACKACRES_JUICE_STYLES[stock];
}

/** Which item a stock's own harvest pop is celebrating -- lifted straight
 *  off ./items.ts, never a second guess at what a Hen Coop pays. */
export function juiceItemFor(stock: StackAcresStock): StackAcresItem {
  return STACKACRES_YIELDS[stock].item;
}

/**
 * The launch cone every shard emitter is configured with: ~100 degrees
 * centred straight up (screen-space "up" is angle 270), so a burst reads as
 * "popped into the air" rather than "sprayed sideways". Kept here as the one
 * source of truth for that physics rather than restated as a literal angle
 * range at the emitter config -- game-juice-manager.ts's own
 * `ensureShardEmitter` reads this to build the Phaser
 * `ParticleEmitterConfig.angle` range it hands to `add.particles`, which is
 * what actually launches shards; there is no second, Phaser-free copy of the
 * launch math to keep in sync with it.
 */
export const HARVEST_POP_CONE_DEGREES = 100;
/** Degrees, matching Phaser's own angle convention (0 = +x/right, increasing
 *  clockwise); 270 is straight up. */
export const HARVEST_POP_UP_ANGLE_DEGREES = 270;

export function harvestPopAngleRange(): { min: number; max: number } {
  return {
    min: HARVEST_POP_UP_ANGLE_DEGREES - HARVEST_POP_CONE_DEGREES / 2,
    max: HARVEST_POP_UP_ANGLE_DEGREES + HARVEST_POP_CONE_DEGREES / 2,
  };
}

/* ------------------------------------------------------------------ */
/* Crit flash                                                          */
/* ------------------------------------------------------------------ */

/**
 * "CRIT! x1.75", "CRIT! x2" -- never "CRIT! x1.750" or "CRIT! x2.00".
 *
 * `multiplier` is the harvest's TOTAL payout multiple, not
 * equipment.ts's own `critBonus` (what a crit adds ON TOP): callers pass
 * `1 + critBonus`, so the Iron Shovel's 0.75 bonus reads as "CRIT! x1.75"
 * and the Golden Spade's 1 reads as "CRIT! x2".
 */
export function critFlashLabel(multiplier: number): string {
  const safe = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  const fixed = safe.toFixed(2).replace(/\.?0+$/, "");
  return `CRIT! x${fixed}`;
}

/**
 * Camera-shake intensity for a crit flash: MICRO on purpose. StackAcres often
 * runs in a tab next to a live poker table -- a shake big enough to read as
 * satisfying "juice" here would read as "the page glitched" there. Duration
 * is fixed (see the manager); only intensity rides the multiplier, and even
 * the richest crit live today (the Golden Spade's x2) stays under a third of
 * Phaser's own commonly-cited "noticeable" shake intensity (~0.01).
 */
const CRIT_SHAKE_BASE = 0.0012;
const CRIT_SHAKE_PER_BONUS = 0.0015;
/** The Golden Spade's own critBonus (1) is the richest crit in the game
 *  today; clamping the bonus this scales against means a future, richer
 *  rung cannot shake harder than "micro" without this file changing too. */
const CRIT_SHAKE_BONUS_CAP = 1;

export function critShakeIntensity(multiplier: number): number {
  const bonus = Math.min(CRIT_SHAKE_BONUS_CAP, Math.max(0, multiplier - 1));
  return CRIT_SHAKE_BASE + bonus * CRIT_SHAKE_PER_BONUS;
}

export const CRIT_SHAKE_DURATION_MS = 90;
export const CRIT_FLASH_DURATION_MS = 120;

/* ------------------------------------------------------------------ */
/* Barn absorb                                                         */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

/** A point on the quadratic Bezier from `p0` through control `p1` to `p2`,
 *  at t in [0, 1]. One control point is enough to arc an item up and over
 *  into the barn -- nothing here needs a cubic. */
export function quadraticBezierPoint(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

/**
 * The control point for a barn-absorb arc: lifted straight up from the
 * flight's own midpoint, never off to a side -- a diamond-tiled isometric
 * world has no natural "left" or "right" for an arc to lean toward, so
 * height is the only bias that reads as intentional rather than arbitrary.
 *
 * Lift scales with the flight's own length (a longer flight arcs higher),
 * floored so a short hop from right next to the barn still visibly leaves
 * the ground.
 */
const BARN_ARC_LIFT_RATIO = 0.35;
const BARN_ARC_LIFT_MIN = 24;

export function barnArcControlPoint(start: Point, end: Point): Point {
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const lift = Math.max(BARN_ARC_LIFT_MIN, dist * BARN_ARC_LIFT_RATIO);
  return { x: midX, y: midY - lift };
}

/** Where the fade to nothing starts along the flight, as a fraction of its
 *  own duration -- full size and fully opaque until the last quarter, then
 *  shrinking and fading into the barn. A `linear` fade across the WHOLE
 *  flight would read as "half-gone while still clearly mid-air", which is
 *  not what "fading out upon contact" means. */
const BARN_ABSORB_FADE_START = 0.75;

export function barnAbsorbScale(t: number): number {
  if (t <= BARN_ABSORB_FADE_START) return 1;
  const local = (t - BARN_ABSORB_FADE_START) / (1 - BARN_ABSORB_FADE_START);
  return 1 - local * 0.6;
}

export function barnAbsorbAlpha(t: number): number {
  if (t <= BARN_ABSORB_FADE_START) return 1;
  const local = (t - BARN_ABSORB_FADE_START) / (1 - BARN_ABSORB_FADE_START);
  return 1 - local;
}

/**
 * The flight's depth at `t`: a straight lerp between the two ends' own
 * isoDepthAt values (see ./iso.ts), not a third projection of some point
 * along the screen-space arc -- the arc itself is drawn in screen space and
 * does not correspond to any single world point along its curve. Depth only
 * has to be MONOTONIC across the flight for the item to slot correctly
 * between the crop layer it left and the barn it is entering, and a lerp of
 * two already-correct depths is exactly that, at no extra projection cost.
 */
export function barnAbsorbDepth(startDepth: number, endDepth: number, t: number): number {
  return startDepth + (endDepth - startDepth) * t;
}

export { STACKACRES_STOCK };
