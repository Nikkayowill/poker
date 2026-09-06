/**
 * WildlifeManager: the Phaser side of lib/stackacres/wildlife.ts.
 *
 * Same split, and the same reason for it, as WeatherOverlayManager's own
 * header states: this class owns textures/GameObjects and renders no
 * opinion of its own about spawn rates, steering or combat -- every number
 * it reads comes from the pure module. A separate class rather than more
 * private fields on StackAcresScene, since several StackAcres features
 * land in parallel on this codebase and a self-contained manager is two
 * lines in `create`/`update` rather than a change to that file's own dense
 * private-field block.
 *
 * TWO FIXED-COST POOLS, allocated once in `create`, never grown -- the
 * same "a frame never makes a game object" rule sunlight.ts's sparkle pool
 * and weather.ts's dust/rain pools already follow. There is no supplied
 * art for a squirrel, a bird, a coyote or a wolf yet, so each entity is a
 * plain Phaser Shape circle (no asset, no download) rather than a baked
 * painter -- the same "placeholder now, real art later" posture
 * `paintGreenhouse`'s own Graphics volume took before its real PNG landed.
 *
 * SCOPE CUT, stated here and in the PR description: fence durability and
 * livestock health are tracked locally in this class during play and
 * exposed via `snapshotFenceDurability`/`snapshotLivestockHealth` plus the
 * `onLivestockDamaged` callback for the shell to persist through
 * lib/server/stackacres-defense-store.ts -- this manager does not itself
 * call a server route on every tick. Wiring a throttled or Realtime sync
 * of the live wave into the store on every frame is left as follow-up,
 * the same "service layer built, live-loop wiring deferred" posture
 * several other StackAcres passes have taken (the Sunlight Forge, the
 * Mill's recipe layer) pending a decision on how chatty that sync should
 * be.
 */

import * as Phaser from "phaser";
import { isoProject } from "@/lib/stackacres/iso";
import { growAreaBounds } from "@/lib/stackacres/world";
import type { ZoneId } from "@/lib/stackacres/zones";
import {
  FENCE_TIER_RESISTANCE,
  FLEE_DURATION_MS,
  LIVESTOCK_MAX_HEALTH,
  PREDATOR_KINDS,
  PREDATOR_STRENGTH,
  WILDLIFE_CREATURE_KINDS,
  advancePredatorState,
  applyPredatorDamage,
  defenseTargetRects,
  fenceSegmentsForZone,
  isAdjacentToLivestock,
  isWildlifeNight,
  nearestTargetPoint,
  rollFenceBreach,
  seekTowards,
  segmentPathIntersects,
  spawnPeacefulCreature,
  spawnPredatorAtPerimeter,
  stepPeacefulCreature,
  stepPredatorAttack,
  stepPredatorSeek,
  type FenceTier,
  type PredatorEntity,
  type WildlifeCreature,
  type WildlifeTimeOfDay,
} from "@/lib/stackacres/wildlife";

const MAX_PEACEFUL_CREATURES = 8;
const MAX_PREDATORS = 3;
/** How often (real frame time) the manager tops up its own population --
 *  a fresh creature wandering in by day, a fresh predator joining the wave
 *  by night. */
const CREATURE_SPAWN_CHECK_MS = 4_000;
const PREDATOR_SPAWN_CHECK_MS = 7_000;
/** World units/second a predator retreats at once it starts fleeing. */
const FLEE_SPEED = 22;

const CREATURE_COLOR: Readonly<Record<(typeof WILDLIFE_CREATURE_KINDS)[number], number>> = {
  squirrel: 0x8b5a2b,
  bird: 0x6fa8dc,
};
const PREDATOR_COLOR: Readonly<Record<(typeof PREDATOR_KINDS)[number], number>> = {
  coyote: 0x9c8062,
  wolf: 0x4b4b4f,
};

function zoneCenter(zone: ZoneId): { x: number; y: number } {
  const bounds = growAreaBounds(zone);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export interface WildlifeManagerCallbacks {
  /** Fired whenever a predator's attack lowers a district's livestock
   *  health -- the shell's cue to persist it (throttled on the shell's own
   *  side, not this manager's). */
  onLivestockDamaged?: (zone: ZoneId, health: number) => void;
}

export class WildlifeManager {
  private readonly scene: Phaser.Scene;
  private readonly random: () => number;
  private callbacks: WildlifeManagerCallbacks = {};

  private tod: WildlifeTimeOfDay = "day";
  private ownedZones: ZoneId[] = [];

  /** `${zone}:${segmentIndex}` -> tier. Hydrated from the store by the
   *  shell (see `setFenceTier`); defaults to Basic Wood, matching the
   *  store's own default for a segment nobody has upgraded. */
  private fenceTiers = new Map<string, FenceTier>();
  /** Same keying, current durability -- wears down as a predator collides
   *  with a bay and never below 0; a segment does not repair itself. */
  private fenceDurability = new Map<string, number>();
  private livestockHealth = new Map<ZoneId, number>();

  private creatures: WildlifeCreature[] = [];
  private creatureSprites: Phaser.GameObjects.Arc[] = [];
  private predators: PredatorEntity[] = [];
  private predatorSprites: Phaser.GameObjects.Arc[] = [];
  private fleeingSinceMs = new Map<string, number>();

  private creatureSpawnTimerMs = 0;
  private predatorSpawnTimerMs = 0;
  private nextEntitySeq = 0;

  constructor(scene: Phaser.Scene, random: () => number) {
    this.scene = scene;
    this.random = random;
  }

  create(): void {
    for (let i = 0; i < MAX_PEACEFUL_CREATURES; i += 1) {
      this.creatureSprites.push(
        this.scene.add.circle(0, 0, 3, 0x8b5a2b, 0.95).setVisible(false).setStrokeStyle(1, 0x3a2412, 0.6),
      );
    }
    for (let i = 0; i < MAX_PREDATORS; i += 1) {
      this.predatorSprites.push(
        this.scene.add.circle(0, 0, 5, 0x4b4b4f, 0.95).setVisible(false).setStrokeStyle(1, 0x111111, 0.85),
      );
    }
  }

  destroy(): void {
    for (const sprite of this.creatureSprites) sprite.destroy();
    for (const sprite of this.predatorSprites) sprite.destroy();
    this.creatureSprites = [];
    this.predatorSprites = [];
  }

  setCallbacks(callbacks: WildlifeManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Which districts a predator may actually target -- see
   *  `defenseTargetRects`'s own doc comment for why this must be the
   *  player's real owned/unlocked districts, not every `ZoneId`. */
  setOwnedZones(zones: ZoneId[]): void {
    this.ownedZones = zones;
  }

  setFenceTier(zone: ZoneId, segmentIndex: number, tier: FenceTier, durability: number): void {
    const key = `${zone}:${segmentIndex}`;
    this.fenceTiers.set(key, tier);
    this.fenceDurability.set(key, durability);
  }

  hydrateLivestockHealth(zone: ZoneId, health: number): void {
    this.livestockHealth.set(zone, health);
  }

  snapshotFenceDurability(): Map<string, { tier: FenceTier; durability: number }> {
    const out = new Map<string, { tier: FenceTier; durability: number }>();
    for (const [key, tier] of this.fenceTiers) {
      out.set(key, { tier, durability: this.fenceDurability.get(key) ?? FENCE_TIER_RESISTANCE[tier] });
    }
    return out;
  }

  snapshotLivestockHealth(): Map<ZoneId, number> {
    return new Map(this.livestockHealth);
  }

  /** Driven by the shell's own `timeOfDay()` poll (the same 60s interval
   *  stackacres-farm.tsx already runs for ambience) -- swaps the whole
   *  population the instant day flips to night or back. */
  setTimeOfDay(tod: WildlifeTimeOfDay): void {
    if (this.tod === tod) return;
    const wasNight = isWildlifeNight(this.tod);
    this.tod = tod;
    const isNight = isWildlifeNight(tod);
    if (wasNight === isNight) return;
    if (isNight) {
      this.creatures = [];
      this.predatorSpawnTimerMs = PREDATOR_SPAWN_CHECK_MS; // spawn the first one immediately
    } else {
      this.predators = [];
      this.fleeingSinceMs.clear();
      this.creatureSpawnTimerMs = CREATURE_SPAWN_CHECK_MS;
    }
  }

  update(time: number, delta: number): void {
    if (isWildlifeNight(this.tod)) {
      this.updatePredators(delta);
      this.predatorSpawnTimerMs += delta;
      if (this.predatorSpawnTimerMs >= PREDATOR_SPAWN_CHECK_MS) {
        this.predatorSpawnTimerMs = 0;
        this.maybeSpawnPredator();
      }
    } else {
      this.updateCreatures(delta);
      this.creatureSpawnTimerMs += delta;
      if (this.creatureSpawnTimerMs >= CREATURE_SPAWN_CHECK_MS) {
        this.creatureSpawnTimerMs = 0;
        this.maybeSpawnCreature();
      }
    }
    this.render();
  }

  /* ------------------------------------------------------------------ */
  /* Peaceful creatures                                                   */
  /* ------------------------------------------------------------------ */

  private maybeSpawnCreature(): void {
    if (this.creatures.length >= MAX_PEACEFUL_CREATURES) return;
    const kind = WILDLIFE_CREATURE_KINDS[Math.floor(this.random() * WILDLIFE_CREATURE_KINDS.length)]!;
    const id = `creature-${this.nextEntitySeq++}`;
    this.creatures.push(spawnPeacefulCreature(id, kind, this.random));
  }

  private updateCreatures(delta: number): void {
    this.creatures = this.creatures.map((creature) => stepPeacefulCreature(creature, delta, this.random));
  }

  /* ------------------------------------------------------------------ */
  /* Predators                                                            */
  /* ------------------------------------------------------------------ */

  private maybeSpawnPredator(): void {
    if (this.predators.length >= MAX_PREDATORS) return;
    const kind = PREDATOR_KINDS[Math.floor(this.random() * PREDATOR_KINDS.length)]!;
    const id = `predator-${this.nextEntitySeq++}`;
    this.predators.push(spawnPredatorAtPerimeter(id, kind, this.random));
  }

  /** The first owned-zone fence bay this frame's step crosses, if any. */
  private fenceCrossingInPath(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { zone: ZoneId; index: number } | null {
    for (const zone of this.ownedZones) {
      for (const segment of fenceSegmentsForZone(zone)) {
        if (segmentPathIntersects(segment.rect, from, to)) {
          return { zone, index: segment.index };
        }
      }
    }
    return null;
  }

  private updatePredators(delta: number): void {
    const targets = defenseTargetRects(this.ownedZones);
    const next: PredatorEntity[] = [];

    for (let predator of this.predators) {
      if (predator.state === "fleeing") {
        const elapsed = (this.fleeingSinceMs.get(predator.id) ?? 0) + delta;
        this.fleeingSinceMs.set(predator.id, elapsed);
        if (elapsed >= FLEE_DURATION_MS) continue; // despawned -- dropped from `next`
        const target = nearestTargetPoint(predator.x, predator.y, targets);
        // Retreat directly away from whatever it was seeking.
        const awayX = predator.x + (predator.x - target.x);
        const awayY = predator.y + (predator.y - target.y);
        const moved = seekTowards(predator, awayX, awayY, FLEE_SPEED, delta);
        next.push({ ...predator, x: moved.x, y: moved.y });
        continue;
      }

      if (predator.state === "seeking") {
        const target = nearestTargetPoint(predator.x, predator.y, targets);
        const before = { x: predator.x, y: predator.y };
        const moved = stepPredatorSeek(predator, target.x, target.y, delta);
        const crossing = this.fenceCrossingInPath(before, moved);

        if (!crossing) {
          predator = moved;
        } else {
          const key = `${crossing.zone}:${crossing.index}`;
          const tier = this.fenceTiers.get(key) ?? "wood";
          const resistance = this.fenceDurability.get(key) ?? FENCE_TIER_RESISTANCE[tier];
          const strength = PREDATOR_STRENGTH[predator.kind];
          const breached = rollFenceBreach(resistance, strength, this.random);
          if (breached) {
            predator = moved;
            this.fenceDurability.set(key, Math.max(0, resistance - strength));
          }
          // A refused bay: the predator holds position this tick and
          // presses again next frame, reading as pacing the fence line
          // rather than teleporting back to where it started.
          const center = zoneCenter(crossing.zone);
          const adjacent = breached && isAdjacentToLivestock(predator, center) ? crossing.zone : null;
          predator = advancePredatorState(predator, { breached, adjacentLivestockId: adjacent });
        }
      }

      if (predator.state === "attacking") {
        const zone = this.nearestAdjacentOwnedZone(predator);
        if (!zone) {
          predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: null });
        } else {
          const { predator: bitten, damage } = stepPredatorAttack(predator, delta);
          predator = bitten;
          if (damage > 0) {
            const current = this.livestockHealth.get(zone) ?? LIVESTOCK_MAX_HEALTH;
            const health = applyPredatorDamage(current, damage);
            this.livestockHealth.set(zone, health);
            this.callbacks.onLivestockDamaged?.(zone, health);
            if (health <= 0) {
              predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: null });
            }
          }
        }
      }

      if (predator.state === "fleeing" && !this.fleeingSinceMs.has(predator.id)) {
        this.fleeingSinceMs.set(predator.id, 0);
      }

      next.push(predator);
    }

    this.predators = next;
  }

  private nearestAdjacentOwnedZone(predator: { x: number; y: number }): ZoneId | null {
    let best: ZoneId | null = null;
    let bestDistance = Infinity;
    for (const zone of this.ownedZones) {
      const center = zoneCenter(zone);
      if (!isAdjacentToLivestock(predator, center)) continue;
      const distance = Math.hypot(center.x - predator.x, center.y - predator.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = zone;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                            */
  /* ------------------------------------------------------------------ */

  private render(): void {
    for (let i = 0; i < this.creatureSprites.length; i += 1) {
      const sprite = this.creatureSprites[i]!;
      const creature = this.creatures[i];
      if (!creature) {
        sprite.setVisible(false);
        continue;
      }
      const at = isoProject(creature.x, creature.y);
      sprite.setPosition(at.x, at.y).setDepth(at.y).setVisible(true).setFillStyle(CREATURE_COLOR[creature.kind]);
    }

    for (let i = 0; i < this.predatorSprites.length; i += 1) {
      const sprite = this.predatorSprites[i]!;
      const predator = this.predators[i];
      if (!predator) {
        sprite.setVisible(false);
        continue;
      }
      const at = isoProject(predator.x, predator.y);
      sprite
        .setPosition(at.x, at.y)
        .setDepth(at.y)
        .setVisible(true)
        .setFillStyle(PREDATOR_COLOR[predator.kind])
        .setAlpha(predator.state === "fleeing" ? 0.5 : 0.95);
    }
  }
}
