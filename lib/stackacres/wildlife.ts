/**
 * Wildlife Ecosystem & Nighttime Predator Defense.
 *
 * Pure and unit-based, same posture as ./world.ts: nothing here touches a
 * renderer or a store. Two populations, mutually exclusive by time of day:
 *
 *   DAY   -- peaceful creatures (squirrels, birds) roam near the treeline,
 *            explicitly avoiding the farmstead core.
 *   NIGHT -- predators (coyotes, wolves) spawn along the outer map
 *            perimeter and steer toward the barn or a district's livestock,
 *            testing every fence segment in their path along the way.
 *
 * `WildlifeTimeOfDay` deliberately MIRRORS lib/audio/stackacres-music.ts's
 * own `TimeOfDay` rather than importing it -- the same call
 * lib/stackacres/ambience-plan.ts already made for the identical reason
 * (stated in its own header): lib/stackacres/ is the pure domain layer and
 * lib/audio/ sits above it, so a value or type import in that direction
 * would be the wrong way round. `isWildlifeNight` folds dusk in with night
 * (predators are "coming out" through dusk, not popping into existence at
 * the 21:00 boundary) -- a caller driving this off the real `timeOfDay()`
 * value gets a defensible answer without this module needing to agree with
 * music/ambience about the exact hour split.
 *
 * Continuous float world-space points throughout, never tile-snapped --
 * this is a roaming/steering system, not a placement grid, and StackAcres
 * dropped its last tile grid on 2026-09-03 ("places, not plots").
 */

import {
  BARN_FOOTPRINT,
  clampFrameMs,
  CROP_FIELD_BEDS,
  forestDensityAt,
  growAreaBounds,
  inFarmZone,
  seededRandom,
  seedFromId,
  type Random,
  type WorldPoint,
  type WorldRect,
} from "./world";
import { nearPath } from "./paths";
import { inPondZone } from "./water";
import { inOuterZone, type ZoneId } from "./zones";
import { worldBoundsRect } from "./bounds";
import { FENCE_BAY } from "./fence";

/** Mirrors `TimeOfDay` in lib/audio/stackacres-music.ts. See this file's
 *  own header for why this is a restated literal union, not an import. */
export type WildlifeTimeOfDay = "day" | "dusk" | "night";

/** Peaceful creatures are out only in full day; dusk already reads as
 *  "night" for wildlife purposes, the same way it already does for
 *  ambience's own mix. */
export function isWildlifeNight(tod: WildlifeTimeOfDay): boolean {
  return tod !== "day";
}

/* ------------------------------------------------------------------ */
/* Where wildlife may stand                                            */
/* ------------------------------------------------------------------ */

/**
 * Whether a world point is inside the farmstead core, a path, the pond, or
 * one of ./zones.ts's districts -- composed from the same four exported
 * predicates ./world.ts's own private `blocked()` is built from (that
 * function is module-private to world.ts, so this restates its union
 * rather than reaching around the module boundary; see world.ts's own
 * `chunkScenery` for the sibling use of the same four checks).
 *
 * This is the one gate both populations share: a peaceful creature never
 * roams onto owned ground, and a predator's spawn point is never chosen
 * inside it either (though a predator's STEERING deliberately drives it
 * toward the farm on purpose -- see `nearestTargetPoint` below).
 */
export function wildlifeBlocked(x: number, y: number): boolean {
  return inFarmZone(x, y) || nearPath(x, y) || inPondZone(x, y) || inOuterZone(x, y);
}

/** How many rejection-sampling attempts a spawn function tries before
 *  falling back to "any unblocked point" -- generous, since the wilderness
 *  is mostly open, but bounded so a spawn call is never unbounded work. */
const WILDLIFE_SPAWN_ATTEMPTS = 24;

function randomPointInBounds(bounds: WorldRect, random: Random): WorldPoint {
  return { x: bounds.x + random() * bounds.width, y: bounds.y + random() * bounds.height };
}

/** Picks any wilderness point clear of the farmstead core -- the shared
 *  fallback both spawn functions reach for when their own preferred band
 *  (treeline density, map edge) doesn't turn up a hit within
 *  `WILDLIFE_SPAWN_ATTEMPTS`, so a spawn call always returns SOMEWHERE
 *  rather than occasionally throwing or returning inside the farm. */
function anyUnblockedPoint(bounds: WorldRect, random: Random): WorldPoint {
  for (let attempt = 0; attempt < WILDLIFE_SPAWN_ATTEMPTS; attempt += 1) {
    const candidate = randomPointInBounds(bounds, random);
    if (!wildlifeBlocked(candidate.x, candidate.y)) return candidate;
  }
  // The wilderness ring around the farm is wide; if every one of those
  // attempts landed on farm/path/pond/district ground this map is far
  // smaller than any shipped configuration -- return the last roll rather
  // than loop forever.
  return randomPointInBounds(bounds, random);
}

/** The treeline band `chunkScenery`'s own `forestDensityAt` reads as
 *  "near the edge of a stand" rather than open field (near 0) or deep
 *  woods (near 1) -- peaceful creatures live at the boundary, not in the
 *  open or buried in undergrowth. */
const FOREST_EDGE_DENSITY_MIN = 0.18;
const FOREST_EDGE_DENSITY_MAX = 0.55;

/* ------------------------------------------------------------------ */
/* Peaceful creatures (daytime)                                        */
/* ------------------------------------------------------------------ */

export const WILDLIFE_CREATURE_KINDS = ["squirrel", "bird"] as const;
export type WildlifeCreatureKind = (typeof WILDLIFE_CREATURE_KINDS)[number];

export function isWildlifeCreatureKind(value: string): value is WildlifeCreatureKind {
  return (WILDLIFE_CREATURE_KINDS as readonly string[]).includes(value);
}

/** Walking speed in world units/second -- brisk; these are meant to dart
 *  and startle, not amble like a pen animal. */
export function wildlifeCreatureSpeed(kind: WildlifeCreatureKind): number {
  return kind === "bird" ? 24 : 16;
}

const CREATURE_IDLE_MIN_MS = 600;
const CREATURE_IDLE_MAX_MS = 2_400;

export interface WildlifeCreature {
  id: string;
  kind: WildlifeCreatureKind;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  mode: "idle" | "roam";
  waitMs: number;
}

/** Spawns one peaceful creature at a deterministic-if-seeded point along
 *  the treeline, clear of the farmstead -- reachable either from a real
 *  `Math.random`-backed `Random` (a session's actual wildlife) or from
 *  `seededRandom(seedFromId(id))` for a creature whose spot should be
 *  reproducible, the same convention `spawnCritter`'s own callers use. */
export function spawnPeacefulCreature(id: string, kind: WildlifeCreatureKind, random: Random): WildlifeCreature {
  const bounds = worldBoundsRect();
  let point: WorldPoint | null = null;
  for (let attempt = 0; attempt < WILDLIFE_SPAWN_ATTEMPTS; attempt += 1) {
    const candidate = randomPointInBounds(bounds, random);
    if (wildlifeBlocked(candidate.x, candidate.y)) continue;
    const density = forestDensityAt(candidate.x, candidate.y);
    if (density < FOREST_EDGE_DENSITY_MIN || density > FOREST_EDGE_DENSITY_MAX) continue;
    point = candidate;
    break;
  }
  const at = point ?? anyUnblockedPoint(bounds, random);
  return { id, kind, x: at.x, y: at.y, targetX: at.x, targetY: at.y, mode: "idle", waitMs: 0 };
}

/** One tick of a peaceful creature's wander: stand about, then dart to
 *  another treeline-ish spot, forever -- the same idle/walk shape
 *  `stepCritter` uses for pen animals, but roaming the open wilderness
 *  bounded by the map edge rather than one district's fenced box. */
export function stepPeacefulCreature(creature: WildlifeCreature, dtMs: number, random: Random): WildlifeCreature {
  const dt = clampFrameMs(dtMs) / 1000;
  let next: WildlifeCreature = { ...creature };

  if (next.mode === "idle") {
    next.waitMs -= dt * 1000;
    if (next.waitMs <= 0) {
      const bounds = worldBoundsRect();
      let target: WorldPoint | null = null;
      for (let attempt = 0; attempt < WILDLIFE_SPAWN_ATTEMPTS; attempt += 1) {
        const candidate = randomPointInBounds(bounds, random);
        if (!wildlifeBlocked(candidate.x, candidate.y)) {
          target = candidate;
          break;
        }
      }
      const at = target ?? anyUnblockedPoint(bounds, random);
      next = { ...next, mode: "roam", targetX: at.x, targetY: at.y };
    }
    return next;
  }

  const speed = wildlifeCreatureSpeed(next.kind);
  const arrived = seekTowards(next, next.targetX, next.targetY, speed, dtMs);
  next.x = arrived.x;
  next.y = arrived.y;
  if (Math.hypot(next.targetX - next.x, next.targetY - next.y) < 0.5) {
    next.mode = "idle";
    next.waitMs = CREATURE_IDLE_MIN_MS + random() * (CREATURE_IDLE_MAX_MS - CREATURE_IDLE_MIN_MS);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Steering                                                             */
/* ------------------------------------------------------------------ */

/** One frame of straight-line seek toward a fixed point, clamped so a long
 *  frame (a phone waking from background) cannot overshoot -- the same
 *  `clampFrameMs` every other StackAcres mover uses. Never overshoots the
 *  target: the step is capped at the remaining distance. */
export function seekTowards(
  from: { x: number; y: number },
  targetX: number,
  targetY: number,
  speed: number,
  dtMs: number,
): WorldPoint {
  const dt = clampFrameMs(dtMs) / 1000;
  const dx = targetX - from.x;
  const dy = targetY - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) return { x: from.x, y: from.y };
  const step = Math.min(distance, speed * dt);
  return { x: from.x + (dx / distance) * step, y: from.y + (dy / distance) * step };
}

/** The nearest point among a set of target rects (barn footprint, a
 *  district's grow area) -- what a predator actually steers toward.
 *  Targets are ALWAYS pulled from live building/livestock state by the
 *  caller (see `defenseTargetRects`), never hardcoded here. */
export function nearestTargetPoint(x: number, y: number, targets: readonly WorldRect[]): WorldPoint {
  let best: WorldPoint = { x: BARN_FOOTPRINT.x + BARN_FOOTPRINT.width / 2, y: BARN_FOOTPRINT.y + BARN_FOOTPRINT.height / 2 };
  let bestDistance = Infinity;
  for (const rect of targets) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const distance = Math.hypot(cx - x, cy - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

/** Every rect a predator might steer toward: the barn (always present) and
 *  one grow area per district the player actually keeps stock in --
 *  pulled from ./world.ts's real `growAreaBounds`, never invented. An
 *  empty `ownedZones` still returns the barn, since it's a fixed,
 *  always-present target even on a brand new farm. */
export function defenseTargetRects(ownedZones: readonly ZoneId[]): WorldRect[] {
  return [BARN_FOOTPRINT, ...ownedZones.map((zone) => growAreaBounds(zone))];
}

/* ------------------------------------------------------------------ */
/* Fence tiers & resistance                                            */
/* ------------------------------------------------------------------ */

export const FENCE_TIERS = ["wood", "wire", "steel"] as const;
export type FenceTier = (typeof FENCE_TIERS)[number];

export function isFenceTier(value: string): value is FenceTier {
  return (FENCE_TIERS as readonly string[]).includes(value);
}

export const FENCE_TIER_LABEL: Readonly<Record<FenceTier, string>> = {
  wood: "Basic Wood",
  wire: "Reinforced Wire",
  steel: "Steel Mesh",
};

/** How much cumulative predator strength a segment of this tier can
 *  absorb before the breach roll starts favoring the predator -- read by
 *  `rollFenceBreach` below, not a hit-point pool a segment drains over
 *  many hits (that is `durability` on the STORED segment; see
 *  lib/server/stackacres-defense-store.ts). Steel resists roughly 3.5x
 *  what Basic Wood does; a wolf (strength 45) still has a real, if small,
 *  chance against it -- no tier is ever a hard wall. */
export const FENCE_TIER_RESISTANCE: Readonly<Record<FenceTier, number>> = {
  wood: 40,
  wire: 90,
  steel: 160,
};

/** Full durability of a freshly-built or freshly-repaired segment, in the
 *  same units `rollFenceBreach`'s resistance uses -- a segment degrades
 *  toward 0 as it absorbs hits (see the store's `damageFenceSegment`) and
 *  is breached outright once it gets there, independent of any single
 *  roll's outcome. */
export const FENCE_TIER_MAX_DURABILITY = FENCE_TIER_RESISTANCE;

export function nextFenceTier(tier: FenceTier): FenceTier | null {
  const index = FENCE_TIERS.indexOf(tier);
  return index >= 0 && index < FENCE_TIERS.length - 1 ? FENCE_TIERS[index + 1] : null;
}

/**
 * One resistance roll: does this predator get through THIS bay, right
 * now? Higher resistance (a better tier, or a segment that hasn't taken
 * much damage yet) reliably favors the fence; higher predator strength
 * favors the predator -- but neither is ever a certainty, which is the
 * whole point of rolling rather than a flat threshold. `random` is
 * injected so a test can pin the outcome exactly the way `Critter`'s own
 * `Random` type already does elsewhere in this codebase.
 */
export function rollFenceBreach(resistance: number, predatorStrength: number, random: Random): boolean {
  if (resistance <= 0) return true;
  const breachChance = predatorStrength / (predatorStrength + resistance);
  return random() < breachChance;
}

/* ------------------------------------------------------------------ */
/* Fence segment geometry                                              */
/* ------------------------------------------------------------------ */

/** A thin collision band straddling the rail a bay of fence actually
 *  draws -- generous enough that a fast-moving predator's per-frame step
 *  can't tunnel through it, narrow enough that it never reads as blocking
 *  ground well inside or outside the pen. */
const FENCE_SEGMENT_THICKNESS = 4;

export interface FenceSegmentGeometry {
  /** Stable within one zone: `paintDistrictBoundary`'s own bay walk order
   *  (top edge, bottom edge, left edge, right edge), so `${zone}:${index}`
   *  is a stable id across a session even though nothing here is drawn. */
  index: number;
  rect: WorldRect;
}

/**
 * Every fence bay around one district's grow area, as collidable
 * geometry -- derived the same way `paintDistrictBoundary` walks a
 * district's edge in `FENCE_BAY` steps to decide where to PAINT a post,
 * not read from a stored array (there isn't one; see this repo's own
 * fence.ts header -- a fence bay is a drawing convention, not stored
 * data). This is the one place that geometry gets derived a second time,
 * for predator collision rather than rendering.
 */
export function fenceSegmentsForZone(zone: ZoneId): FenceSegmentGeometry[] {
  // The Farmstead's own `GROW_AREA` entry is still just its Hen Coop
  // remnant (world.ts's own comment on why that box stayed put through the
  // 2026-09-08 district merge) -- no stock stands there, nothing to defend.
  // The Crop Fields, which DO hold real stock since that merge, use
  // `CROP_FIELD_BEDS` instead: the same fenced perimeter `growAreaBounds
  // ("meadow")` gave them before they were folded into this district.
  const bounds = zone === "farmstead" ? CROP_FIELD_BEDS : growAreaBounds(zone);
  const segments: FenceSegmentGeometry[] = [];
  let index = 0;

  for (const y of [bounds.y, bounds.y + bounds.height]) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += FENCE_BAY) {
      const width = Math.min(FENCE_BAY, bounds.x + bounds.width - x);
      segments.push({
        index: index++,
        rect: { x, y: y - FENCE_SEGMENT_THICKNESS / 2, width, height: FENCE_SEGMENT_THICKNESS },
      });
    }
  }

  for (const x of [bounds.x, bounds.x + bounds.width]) {
    for (let y = bounds.y; y < bounds.y + bounds.height; y += FENCE_BAY) {
      const height = Math.min(FENCE_BAY, bounds.y + bounds.height - y);
      segments.push({
        index: index++,
        rect: { x: x - FENCE_SEGMENT_THICKNESS / 2, y, width: FENCE_SEGMENT_THICKNESS, height },
      });
    }
  }

  return segments;
}

export function fenceSegmentId(zone: ZoneId, index: number): string {
  return `${zone}:${index}`;
}

/**
 * Liang-Barsky line-vs-AABB clip test: does the straight path from `from`
 * to `to` cross this rect at all? Used as the predator's own raycast
 * against a fence bay along its step this frame, rather than a cheaper
 * "is the endpoint inside the rect" test, since a fast predator's whole
 * frame-step can cross a thin fence band without either endpoint ever
 * landing inside it.
 */
export function segmentPathIntersects(rect: WorldRect, from: WorldPoint, to: WorldPoint): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let tMin = 0;
  let tMax = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > tMax) return false;
      if (r > tMin) tMin = r;
    } else {
      if (r < tMin) return false;
      if (r < tMax) tMax = r;
    }
    return true;
  };

  if (!clip(-dx, from.x - rect.x)) return false;
  if (!clip(dx, rect.x + rect.width - from.x)) return false;
  if (!clip(-dy, from.y - rect.y)) return false;
  if (!clip(dy, rect.y + rect.height - from.y)) return false;
  return tMin <= tMax;
}

/* ------------------------------------------------------------------ */
/* Predators & the attack state machine                                */
/* ------------------------------------------------------------------ */

export const PREDATOR_KINDS = ["coyote", "wolf"] as const;
export type PredatorKind = (typeof PREDATOR_KINDS)[number];

export function isPredatorKind(value: string): value is PredatorKind {
  return (PREDATOR_KINDS as readonly string[]).includes(value);
}

export const PREDATOR_STRENGTH: Readonly<Record<PredatorKind, number>> = { coyote: 25, wolf: 45 };
export const PREDATOR_SPEED: Readonly<Record<PredatorKind, number>> = { coyote: 20, wolf: 26 };
export const PREDATOR_MAX_HEALTH: Readonly<Record<PredatorKind, number>> = { coyote: 60, wolf: 100 };

export type PredatorState = "seeking" | "attacking" | "fleeing";

export interface PredatorEntity {
  id: string;
  kind: PredatorKind;
  x: number;
  y: number;
  state: PredatorState;
  health: number;
  attackCooldownMs: number;
}

/** How close counts as "standing next to" livestock for the attack state
 *  to trigger -- generous relative to a district's own `growAreaInterior`
 *  so a predator that just breached the fence line is already close
 *  enough to start attacking rather than needing one more full seek step. */
export const ATTACK_RANGE = 10;
const ATTACK_COOLDOWN_MS = 1_200;
export const ATTACK_DAMAGE = 10;
/** How long a predator lingers in "fleeing" before the manager despawns
 *  it -- purely a presentation beat (time to play a retreat animation),
 *  not a state this module re-enters from. */
export const FLEE_DURATION_MS = 1_500;

/** Spawns one predator at a uniformly-random point along the map's outer
 *  perimeter (`bounds.ts`'s `worldBoundsRect`) -- walking the rectangle's
 *  edge by arclength rather than picking a random side first, so every
 *  point on the perimeter is equally likely regardless of the map's
 *  aspect ratio. */
export function spawnPredatorAtPerimeter(id: string, kind: PredatorKind, random: Random): PredatorEntity {
  const bounds = worldBoundsRect();
  const perimeter = 2 * (bounds.width + bounds.height);
  let t = random() * perimeter;

  let x: number;
  let y: number;
  if (t < bounds.width) {
    x = bounds.x + t;
    y = bounds.y;
  } else if ((t -= bounds.width) < bounds.height) {
    x = bounds.x + bounds.width;
    y = bounds.y + t;
  } else if ((t -= bounds.height) < bounds.width) {
    x = bounds.x + bounds.width - t;
    y = bounds.y + bounds.height;
  } else {
    t -= bounds.width;
    x = bounds.x;
    y = bounds.y + bounds.height - t;
  }

  return {
    id,
    kind,
    x,
    y,
    state: "seeking",
    health: PREDATOR_MAX_HEALTH[kind],
    attackCooldownMs: 0,
  };
}

export function isAdjacentToLivestock(predator: { x: number; y: number }, livestock: WorldPoint): boolean {
  return Math.hypot(predator.x - livestock.x, predator.y - livestock.y) <= ATTACK_RANGE;
}

/** One seek step toward the nearest live target, while `seeking`. Returns
 *  the moved predator unchanged in state -- `advancePredatorState` below
 *  is the only thing that transitions `state`, kept as a separate pure
 *  step so a caller can run movement and state transition against
 *  different information (movement needs only a target point; the state
 *  transition needs to know about a breach and adjacency). */
export function stepPredatorSeek(predator: PredatorEntity, targetX: number, targetY: number, dtMs: number): PredatorEntity {
  if (predator.state !== "seeking") return predator;
  const moved = seekTowards(predator, targetX, targetY, PREDATOR_SPEED[predator.kind], dtMs);
  return { ...predator, x: moved.x, y: moved.y };
}

export interface AttackTransitionContext {
  /** Whether this frame's fence raycast (see `segmentPathIntersects`) plus
   *  resistance roll (see `rollFenceBreach`) let the predator through a
   *  perimeter it was pressing against. An open gap in the perimeter
   *  (no fence segment there at all) counts as a breach with no roll
   *  needed -- the caller passes `true` for that case too. */
  breached: boolean;
  /** The nearest livestock point within `ATTACK_RANGE`, or null. */
  adjacentLivestockId: string | null;
}

/**
 * Advances the predator's own state machine: seeking -> attacking on a
 * breach with adjacent livestock, attacking -> fleeing once nothing is
 * left adjacent to bite (driven off, or the livestock itself was cleared),
 * fleeing is terminal here -- the manager owns despawning it after
 * `FLEE_DURATION_MS`, since that is a presentation timer, not a rule this
 * pure function has any business tracking.
 */
export function advancePredatorState(predator: PredatorEntity, ctx: AttackTransitionContext): PredatorEntity {
  if (predator.state === "seeking") {
    if (ctx.breached && ctx.adjacentLivestockId) {
      return { ...predator, state: "attacking", attackCooldownMs: 0 };
    }
    return predator;
  }
  if (predator.state === "attacking") {
    if (!ctx.adjacentLivestockId) {
      return { ...predator, state: "fleeing" };
    }
    return predator;
  }
  return predator;
}

/** One tick of biting while `attacking`: respects its own cooldown so a
 *  predator doesn't deal `ATTACK_DAMAGE` every frame, only once per
 *  `ATTACK_COOLDOWN_MS`. Returns 0 damage, unchanged predator, outside
 *  the `attacking` state. */
export function stepPredatorAttack(predator: PredatorEntity, dtMs: number): { predator: PredatorEntity; damage: number } {
  if (predator.state !== "attacking") return { predator, damage: 0 };
  const cooldown = predator.attackCooldownMs - clampFrameMs(dtMs);
  if (cooldown > 0) return { predator: { ...predator, attackCooldownMs: cooldown }, damage: 0 };
  return { predator: { ...predator, attackCooldownMs: ATTACK_COOLDOWN_MS }, damage: ATTACK_DAMAGE };
}

/* ------------------------------------------------------------------ */
/* Livestock health                                                     */
/* ------------------------------------------------------------------ */

export const LIVESTOCK_MAX_HEALTH = 100;

export function applyPredatorDamage(health: number, damage: number): number {
  return Math.max(0, Math.min(LIVESTOCK_MAX_HEALTH, health - damage));
}

/** A stable per-session id for a creature/predator that doesn't need one
 *  from the server -- the same `seedFromId`-backed determinism `units.ts`
 *  already uses for a crop's fixed spot, reused here so a spawn seeded
 *  off e.g. `"wave:3:coyote:1"` reproduces identically in a test. */
export function wildlifeSeed(id: string): Random {
  return seededRandom(seedFromId(id));
}
