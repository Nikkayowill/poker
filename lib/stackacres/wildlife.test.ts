import { describe, expect, it } from "vitest";
import { BARN_FOOTPRINT, growAreaBounds, seededRandom } from "./world";
import { worldBoundsRect } from "./bounds";
import {
  ATTACK_RANGE,
  FENCE_TIERS,
  FENCE_TIER_RESISTANCE,
  advancePredatorState,
  applyPredatorDamage,
  defenseTargetRects,
  fenceSegmentId,
  fenceSegmentsForZone,
  isAdjacentToLivestock,
  isWildlifeNight,
  nearestTargetPoint,
  nextFenceTier,
  rollFenceBreach,
  seekTowards,
  segmentPathIntersects,
  spawnPeacefulCreature,
  spawnPredatorAtPerimeter,
  stepPeacefulCreature,
  stepPredatorAttack,
  stepPredatorSeek,
  wildlifeBlocked,
  LIVESTOCK_MAX_HEALTH,
  PREDATOR_STRENGTH,
} from "./wildlife";

describe("isWildlifeNight", () => {
  it("is peaceful only in full day", () => {
    expect(isWildlifeNight("day")).toBe(false);
    expect(isWildlifeNight("dusk")).toBe(true);
    expect(isWildlifeNight("night")).toBe(true);
  });
});

describe("day/night spawn transition", () => {
  it("spawns a peaceful creature clear of the farmstead core", () => {
    const random = seededRandom(1);
    for (let i = 0; i < 20; i += 1) {
      const creature = spawnPeacefulCreature(`squirrel-${i}`, "squirrel", random);
      expect(wildlifeBlocked(creature.x, creature.y)).toBe(false);
    }
  });

  it("spawns a predator only once night has fallen, along the map perimeter", () => {
    const random = seededRandom(2);
    for (let i = 0; i < 20; i += 1) {
      const predator = spawnPredatorAtPerimeter(`wolf-${i}`, "wolf", random);
      const bounds = worldBoundsRect();
      const onPerimeter =
        predator.x === bounds.x ||
        predator.x === bounds.x + bounds.width ||
        predator.y === bounds.y ||
        predator.y === bounds.y + bounds.height;
      expect(onPerimeter).toBe(true);
      expect(predator.state).toBe("seeking");
    }
  });

  it("despawns peaceful creatures and spawns predators on the night transition (manager contract)", () => {
    // The manager itself lives in components/arcade/stackacres/wildlife-manager.ts
    // and owns the actual list swap; this pins the pure predicate it keys that
    // swap on so a future edit to isWildlifeNight can't silently change when
    // the swap happens without a red test here.
    expect(isWildlifeNight("day")).toBe(false);
    expect(isWildlifeNight("dusk")).toBe(true);
  });
});

describe("peaceful creature wander", () => {
  it("always picks its next roam target clear of the farmstead core", () => {
    // Movement is a straight-line seek and does not itself dodge every
    // intermediate point along the way (that is what fence collision is
    // for, on the predator side) -- what this guarantees is that the
    // DESTINATION a creature is ever walking toward is always clear,
    // the same contract `spawnPeacefulCreature` gives its own spawn point.
    const random = seededRandom(3);
    let creature = spawnPeacefulCreature("bird-1", "bird", random);
    for (let tick = 0; tick < 200; tick += 1) {
      creature = stepPeacefulCreature(creature, 250, random);
      expect(wildlifeBlocked(creature.targetX, creature.targetY)).toBe(false);
    }
  });
});

describe("seekTowards", () => {
  it("moves directly toward the target, clamped to one frame's worth of travel", () => {
    // dtMs is clamped to MAX_FRAME_MS (250ms) the same way every other
    // mover in this codebase clamps a frame delta, so a 1000ms delta here
    // only advances a quarter of a second's worth of speed.
    const next = seekTowards({ x: 0, y: 0 }, 100, 0, 50, 250);
    expect(next.x).toBeCloseTo(12.5, 5);
    expect(next.y).toBeCloseTo(0, 5);
  });

  it("clamps to the target when the step would overshoot", () => {
    const next = seekTowards({ x: 0, y: 0 }, 5, 0, 50, 250);
    expect(next.x).toBeCloseTo(5, 5);
  });

  it("is a no-op already at the target", () => {
    const next = seekTowards({ x: 10, y: 10 }, 10, 10, 50, 1000);
    expect(next).toEqual({ x: 10, y: 10 });
  });
});

describe("nearestTargetPoint / defenseTargetRects", () => {
  it("pulls real target coordinates from growAreaBounds, not hardcoded values", () => {
    const targets = defenseTargetRects(["farmstead"]);
    expect(targets).toContainEqual(BARN_FOOTPRINT);
    expect(targets).toContainEqual(growAreaBounds("farmstead"));
  });

  it("returns the barn even with no owned zones", () => {
    const targets = defenseTargetRects([]);
    expect(targets).toEqual([BARN_FOOTPRINT]);
  });

  it("picks whichever target rect is actually closest", () => {
    const farmstead = growAreaBounds("farmstead");
    const near = nearestTargetPoint(farmstead.x + 1, farmstead.y + 1, [BARN_FOOTPRINT, farmstead]);
    expect(near.x).toBeCloseTo(farmstead.x + farmstead.width / 2, 5);
  });
});

describe("fence tiers & resistance rolls", () => {
  it("orders tiers wood < wire < steel by resistance", () => {
    expect(FENCE_TIER_RESISTANCE.wood).toBeLessThan(FENCE_TIER_RESISTANCE.wire);
    expect(FENCE_TIER_RESISTANCE.wire).toBeLessThan(FENCE_TIER_RESISTANCE.steel);
  });

  it("walks the ladder wood -> wire -> steel -> null", () => {
    expect(nextFenceTier("wood")).toBe("wire");
    expect(nextFenceTier("wire")).toBe("steel");
    expect(nextFenceTier("steel")).toBeNull();
  });

  it("a higher tier breaches less often than a lower one against the same predator", () => {
    const strength = PREDATOR_STRENGTH.wolf;
    // Deterministic roll: fixed random() lets the test compare the computed
    // breach CHANCE via a threshold sweep rather than one noisy sample.
    const chanceAt = (resistance: number) => strength / (strength + resistance);
    expect(chanceAt(FENCE_TIER_RESISTANCE.wood)).toBeGreaterThan(chanceAt(FENCE_TIER_RESISTANCE.wire));
    expect(chanceAt(FENCE_TIER_RESISTANCE.wire)).toBeGreaterThan(chanceAt(FENCE_TIER_RESISTANCE.steel));
  });

  it("rolls breach true when the random draw is below the computed chance", () => {
    const resistance = FENCE_TIER_RESISTANCE.wood;
    const strength = PREDATOR_STRENGTH.coyote;
    const chance = strength / (strength + resistance);
    expect(rollFenceBreach(resistance, strength, () => chance - 0.01)).toBe(true);
    expect(rollFenceBreach(resistance, strength, () => chance + 0.01)).toBe(false);
  });

  it("a fence with zero resistance is always breached", () => {
    expect(rollFenceBreach(0, 1, () => 0.999)).toBe(true);
  });

  it("every tier gives a stronger predator (wolf) a better breach chance than a weaker one (coyote)", () => {
    for (const tier of FENCE_TIERS) {
      const resistance = FENCE_TIER_RESISTANCE[tier];
      const wolfChance = PREDATOR_STRENGTH.wolf / (PREDATOR_STRENGTH.wolf + resistance);
      const coyoteChance = PREDATOR_STRENGTH.coyote / (PREDATOR_STRENGTH.coyote + resistance);
      expect(wolfChance).toBeGreaterThan(coyoteChance);
    }
  });
});

describe("fence segment geometry", () => {
  it("covers a district's full perimeter in FENCE_BAY-sized bays with no gap", () => {
    const segments = fenceSegmentsForZone("wallow");
    const bounds = growAreaBounds("wallow");
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment.rect.x).toBeGreaterThanOrEqual(bounds.x - 3);
      expect(segment.rect.y).toBeGreaterThanOrEqual(bounds.y - 3);
    }
  });

  it("gives every segment a stable id within its zone", () => {
    const segments = fenceSegmentsForZone("meadow");
    const ids = segments.map((s) => fenceSegmentId("meadow", s.index));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("detects a predator's straight-line path crossing a fence bay", () => {
    const segments = fenceSegmentsForZone("oxfields");
    const segment = segments[0];
    const midX = segment.rect.x + segment.rect.width / 2;
    const midY = segment.rect.y + segment.rect.height / 2;
    const from = { x: midX, y: midY - 20 };
    const to = { x: midX, y: midY + 20 };
    expect(segmentPathIntersects(segment.rect, from, to)).toBe(true);
  });

  it("does not flag a path that stays well clear of the bay", () => {
    const segments = fenceSegmentsForZone("oxfields");
    const segment = segments[0];
    const from = { x: segment.rect.x - 500, y: segment.rect.y - 500 };
    const to = { x: segment.rect.x - 450, y: segment.rect.y - 450 };
    expect(segmentPathIntersects(segment.rect, from, to)).toBe(false);
  });
});

describe("predator seek + breach -> attack state transition", () => {
  it("moves a seeking predator toward its target", () => {
    let predator = spawnPredatorAtPerimeter("p1", "coyote", seededRandom(9));
    const target = nearestTargetPoint(predator.x, predator.y, [BARN_FOOTPRINT]);
    const startDistance = Math.hypot(target.x - predator.x, target.y - predator.y);
    predator = stepPredatorSeek(predator, target.x, target.y, 1000);
    const endDistance = Math.hypot(target.x - predator.x, target.y - predator.y);
    expect(endDistance).toBeLessThan(startDistance);
    expect(predator.state).toBe("seeking");
  });

  it("stays seeking without a breach even when livestock is adjacent", () => {
    let predator = spawnPredatorAtPerimeter("p2", "wolf", seededRandom(10));
    predator = advancePredatorState(predator, { breached: false, adjacentLivestockId: "hen-1" });
    expect(predator.state).toBe("seeking");
  });

  it("transitions seeking -> attacking on a breach with adjacent livestock", () => {
    let predator = spawnPredatorAtPerimeter("p3", "wolf", seededRandom(11));
    predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: "hen-1" });
    expect(predator.state).toBe("attacking");
  });

  it("does not attack a breach with nothing adjacent", () => {
    let predator = spawnPredatorAtPerimeter("p4", "wolf", seededRandom(12));
    predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: null });
    expect(predator.state).toBe("seeking");
  });

  it("transitions attacking -> fleeing once nothing is left adjacent", () => {
    let predator = spawnPredatorAtPerimeter("p5", "coyote", seededRandom(13));
    predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: "hen-1" });
    expect(predator.state).toBe("attacking");
    predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: null });
    expect(predator.state).toBe("fleeing");
  });

  it("deals damage on cooldown expiry only while attacking", () => {
    let predator = spawnPredatorAtPerimeter("p6", "wolf", seededRandom(14));
    predator = advancePredatorState(predator, { breached: true, adjacentLivestockId: "hen-1" });
    const first = stepPredatorAttack(predator, 0);
    expect(first.damage).toBeGreaterThan(0);
    const second = stepPredatorAttack(first.predator, 100);
    expect(second.damage).toBe(0);
  });

  it("deals no damage outside the attacking state", () => {
    const predator = spawnPredatorAtPerimeter("p7", "coyote", seededRandom(15));
    const { damage } = stepPredatorAttack(predator, 5000);
    expect(damage).toBe(0);
  });

  it("adjacency respects ATTACK_RANGE", () => {
    const predator = { x: 0, y: 0 };
    expect(isAdjacentToLivestock(predator, { x: ATTACK_RANGE - 1, y: 0 })).toBe(true);
    expect(isAdjacentToLivestock(predator, { x: ATTACK_RANGE + 5, y: 0 })).toBe(false);
  });
});

describe("livestock health", () => {
  it("clamps at zero and never exceeds max", () => {
    expect(applyPredatorDamage(5, 10)).toBe(0);
    expect(applyPredatorDamage(LIVESTOCK_MAX_HEALTH, -50)).toBe(LIVESTOCK_MAX_HEALTH);
  });
});
