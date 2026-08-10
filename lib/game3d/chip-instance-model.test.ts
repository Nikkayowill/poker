import { describe, expect, it } from "vitest";
import {
  POT_PILE_SEED,
  buildPushLegs,
  pileChipCount,
  pileSlot,
  pushChipPoses,
  restingPileChipPoses,
  seatPileSeed,
  type ChipPose,
} from "./chip-instance-model";
import { chipBreakdown, CHIP_DENOMINATIONS, MAX_CHIPS_PER_PILE } from "./denominations";
import { CHIP } from "./dimensions";
import { chipStackY, pushDurationMs, sampleChipPush } from "./chip-trajectory";
import { PUSH_STYLES, pushStyleFor } from "./chip-push";
import { POT_POSITION, betSpotPosition, handLaunchPosition } from "./seat-layout";

const ORIGIN = { x: 0, y: 0.86, z: 0 };
const TARGET = { x: 1.2, y: 0.86, z: -0.4 };
const STYLE = PUSH_STYLES.bet;

/**
 * Two chips at the same height must not occupy the same cloth. Chips a
 * thickness apart are *meant* to touch — that is a stack — so the check is
 * scoped to poses sharing a height, which is exactly the case where
 * overlapping footprints mean interpenetration.
 */
function overlappingAtSameHeight(poses: ChipPose[]): Array<[ChipPose, ChipPose]> {
  const clashes: Array<[ChipPose, ChipPose]> = [];
  for (let i = 0; i < poses.length; i += 1) {
    for (let j = i + 1; j < poses.length; j += 1) {
      const a = poses[i];
      const b = poses[j];
      if (Math.abs(a.y - b.y) > CHIP.thickness * 0.5) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < CHIP.radius * 2) clashes.push([a, b]);
    }
  }
  return clashes;
}

describe("restingPileChipPoses", () => {
  it("returns one pose per chip in the greedy breakdown, in the same order", () => {
    const amount = 730;
    const poses = restingPileChipPoses(amount, ORIGIN, 3, "seat-0");
    const breakdown = chipBreakdown(amount);
    expect(poses).toHaveLength(breakdown.length);
    expect(poses.map((p) => p.denom)).toEqual(breakdown.map((d) => d.value));
  });

  it("stacks at exactly FELT_TOP_Y + thickness/2 + index * thickness", () => {
    const poses = restingPileChipPoses(2500, ORIGIN, 0, "pot");
    poses.forEach((pose, i) => {
      expect(pose.y).toBe(chipStackY(ORIGIN.y, i));
      expect(pose.y).toBeCloseTo(ORIGIN.y + CHIP.thickness / 2 + i * CHIP.thickness, 12);
    });
  });

  it("rests flat: nothing in a settled pile carries a tilt", () => {
    for (const pose of restingPileChipPoses(9999, ORIGIN, 4, "pot")) {
      expect(pose.tiltX).toBe(0);
      expect(pose.tiltZ).toBe(0);
    }
  });

  it("is empty for a zero or negative amount", () => {
    expect(restingPileChipPoses(0, ORIGIN, 0, "x")).toHaveLength(0);
    expect(restingPileChipPoses(-50, ORIGIN, 0, "x")).toHaveLength(0);
  });

  it("gives every chip a distinct, stable key", () => {
    const poses = restingPileChipPoses(1400, ORIGIN, 5, "seat-2");
    expect(new Set(poses.map((p) => p.key)).size).toBe(poses.length);
  });

  it("two different seeds jitter the same amount differently, so equal piles don't stack identically", () => {
    const a = restingPileChipPoses(1000, ORIGIN, 1, "a");
    const b = restingPileChipPoses(1000, ORIGIN, 2, "b");
    expect(a.some((pose, i) => pose.x !== b[i].x || pose.z !== b[i].z)).toBe(true);
  });

  it("never lands two chips of one pile on the same level", () => {
    expect(overlappingAtSameHeight(restingPileChipPoses(9999, ORIGIN, POT_PILE_SEED, "pot")))
      .toEqual([]);
  });

  it("keeps a full felt free of same-height overlaps across every pile at once", () => {
    // Six seats' standing bets plus the pot, all at the display cap. If any
    // two piles were close enough for their jitter to make chips at equal
    // heights intersect, this is where it shows.
    const poses = [
      ...restingPileChipPoses(9999, POT_POSITION, POT_PILE_SEED, "pot"),
      ...[0, 1, 2, 3, 4, 5].flatMap((slot) =>
        restingPileChipPoses(9999, betSpotPosition(slot), seatPileSeed(slot), `seat-${slot}`),
      ),
    ];
    expect(poses.length).toBe(7 * MAX_CHIPS_PER_PILE);
    expect(overlappingAtSameHeight(poses)).toEqual([]);
  });

  it("every rendered denomination is one this layer actually knows how to bucket", () => {
    // Guards the InstancedMesh layer's own assumption: it keeps one mesh per
    // CHIP_DENOMINATIONS entry, keyed by `.value`, so a pose whose `denom`
    // isn't one of those values would silently never be drawn.
    const known = new Set(CHIP_DENOMINATIONS.map((d) => d.value));
    for (const pose of restingPileChipPoses(9876, ORIGIN, 0, "big")) {
      expect(known.has(pose.denom)).toBe(true);
    }
  });
});

describe("buildPushLegs", () => {
  const origin = { position: ORIGIN, seed: 3, startIndex: 0, topFirst: true };
  const destination = { position: TARGET, seed: 9, startIndex: 0 };

  it("gives every chip its own source and its own destination", () => {
    const legs = buildPushLegs(5, origin, destination);
    expect(legs).toHaveLength(5);
    expect(new Set(legs.map((l) => `${l.source.x}:${l.source.y}:${l.source.z}`)).size).toBe(5);
    expect(new Set(legs.map((l) => `${l.target.x}:${l.target.y}:${l.target.z}`)).size).toBe(5);
  });

  it("builds its destination stack bottom-up in launch order, exactly flush", () => {
    const legs = buildPushLegs(6, origin, destination);
    legs.forEach((leg, i) => {
      expect(leg.target.y).toBe(chipStackY(TARGET.y, i));
    });
  });

  it("lands on top of what is already resting there, never inside it", () => {
    const resting = restingPileChipPoses(300, TARGET, 9, "resting");
    const legs = buildPushLegs(3, origin, {
      ...destination,
      startIndex: resting.length,
    });
    const landed: ChipPose[] = legs.map((leg, i) => ({
      key: `l-${i}`,
      denom: 25,
      x: leg.target.x,
      y: leg.target.y,
      z: leg.target.z,
      rotationY: leg.rotationY,
      tiltX: 0,
      tiltZ: 0,
    }));
    expect(overlappingAtSameHeight([...resting, ...landed])).toEqual([]);
    expect(landed[0].y).toBe(chipStackY(TARGET.y, resting.length));
  });

  it("a landing IS the resting slot it will become — the same coordinates, not near them", () => {
    // The whole reason a chip does not snap on arrival.
    const legs = buildPushLegs(4, origin, destination);
    const resting = restingPileChipPoses(4, TARGET, 9, "after");
    legs.forEach((leg, i) => {
      expect(leg.target.x).toBe(resting[i].x);
      expect(leg.target.y).toBe(resting[i].y);
      expect(leg.target.z).toBe(resting[i].z);
      expect(leg.rotationY).toBe(resting[i].rotationY);
    });
  });

  it("takes chips off the top first, from distinct slots of the pile it drains", () => {
    const potBase = 5;
    const legs = buildPushLegs(3, { position: POT_POSITION, seed: POT_PILE_SEED, startIndex: potBase, topFirst: true }, destination);
    // Slots potBase..potBase+2, highest first.
    expect(legs[0].source.y).toBe(pileSlot(POT_POSITION, POT_PILE_SEED, potBase + 2).y);
    expect(legs[1].source.y).toBe(pileSlot(POT_POSITION, POT_PILE_SEED, potBase + 1).y);
    expect(legs[2].source.y).toBe(pileSlot(POT_POSITION, POT_PILE_SEED, potBase).y);
  });

  it("stacks bottom-up instead when topFirst is off", () => {
    const legs = buildPushLegs(3, { ...origin, topFirst: false }, destination);
    expect(legs[0].source.y).toBe(pileSlot(ORIGIN, 3, 0).y);
    expect(legs[2].source.y).toBe(pileSlot(ORIGIN, 3, 2).y);
  });
});

describe("pushChipPoses", () => {
  const chips = chipBreakdown(325);
  const legs = buildPushLegs(
    chips.length,
    { position: handLaunchPosition(2), seed: seatPileSeed(2), startIndex: 0, topFirst: true },
    { position: betSpotPosition(2), seed: seatPileSeed(2), startIndex: 0 },
  );

  it("is not done at launch and is done once the push's own duration has elapsed", () => {
    expect(pushChipPoses(chips, legs, STYLE, 0, "p").done).toBe(false);
    const duration = pushDurationMs(chips.length, STYLE);
    expect(pushChipPoses(chips, legs, STYLE, duration, "p").done).toBe(true);
  });

  it("settles every chip exactly into its own final stack slot", () => {
    const duration = pushDurationMs(chips.length, STYLE);
    const { poses } = pushChipPoses(chips, legs, STYLE, duration, "p");
    poses.forEach((pose, i) => {
      expect(pose.x).toBe(legs[i].target.x);
      expect(pose.y).toBe(legs[i].target.y);
      expect(pose.z).toBe(legs[i].target.z);
      expect(pose.tiltX).toBe(0);
      expect(pose.tiltZ).toBe(0);
    });
    expect(overlappingAtSameHeight(poses)).toEqual([]);
  });

  it("completes in sequence — each chip settles exactly one stagger after the last", () => {
    const settlesAt = (index: number) => pushDurationMs(1, STYLE) + index * STYLE.staggerMs;
    for (let i = 0; i < chips.length; i += 1) {
      const leg = legs[i];
      expect(sampleChipPush(leg.source, leg.target, settlesAt(i) - 1, i, STYLE).done).toBe(false);
      expect(sampleChipPush(leg.source, leg.target, settlesAt(i), i, STYLE).done).toBe(true);
    }
    // The group retires exactly when its last chip does, never before.
    const last = settlesAt(chips.length - 1);
    expect(last).toBe(pushDurationMs(chips.length, STYLE));
    expect(pushChipPoses(chips, legs, STYLE, last - 1, "p").done).toBe(false);
    expect(pushChipPoses(chips, legs, STYLE, last, "p").done).toBe(true);
  });

  it("holds each chip at its own source until its own launch, for every style", () => {
    for (const style of Object.values(PUSH_STYLES)) {
      const held = pushChipPoses(chips, legs, style, style.staggerMs - 1, "p");
      expect(held.poses[1].x).toBe(legs[1].source.x);
      expect(held.poses[1].z).toBe(legs[1].source.z);
      const moving = pushChipPoses(chips, legs, style, style.staggerMs + 1, "p");
      expect(moving.poses[1].x).not.toBe(legs[1].source.x);
    }
  });

  it("is a deterministic function of elapsed time", () => {
    const a = pushChipPoses(chips, legs, STYLE, 211, "p");
    const b = pushChipPoses(chips, legs, STYLE, 211, "p");
    expect(a).toEqual(b);
    // And every sample is finite — a NaN reaching setMatrixAt makes an
    // InstancedMesh disappear whole, with nothing logged.
    for (const pose of a.poses) {
      expect(Number.isFinite(pose.x + pose.y + pose.z + pose.tiltX + pose.tiltZ)).toBe(true);
    }
  });

  it("under reduced motion lands the same positions the animation would have", () => {
    const reduced = pushChipPoses(chips, legs, STYLE, 0, "p", true);
    const finished = pushChipPoses(chips, legs, STYLE, pushDurationMs(chips.length, STYLE), "p");
    expect(reduced.done).toBe(true);
    expect(reduced.poses).toEqual(finished.poses);
  });

  it("an empty push is trivially done with no poses", () => {
    const result = pushChipPoses([], [], STYLE, 0, "empty");
    expect(result.done).toBe(true);
    expect(result.poses).toHaveLength(0);
  });

  it("a full-cap push of every style finishes well inside a hand's own boundary", () => {
    // The felt clears instantly at a hand boundary, so a payout still
    // travelling when the next hand deals is a payout the winner never saw.
    for (const style of Object.values(PUSH_STYLES)) {
      expect(pushDurationMs(MAX_CHIPS_PER_PILE, style)).toBeLessThan(2000);
    }
  });
});

describe("pileChipCount", () => {
  it("counts the chips actually drawn, which is what a stack lands on top of", () => {
    expect(pileChipCount(0)).toBe(0);
    expect(pileChipCount(325)).toBe(chipBreakdown(325).length);
    expect(pileChipCount(9_999_999)).toBe(MAX_CHIPS_PER_PILE);
  });
});

describe("action-driven cadence", () => {
  it("gives a raise a wider stagger and a harder landing than a call", () => {
    const call = pushStyleFor("call");
    const raise = pushStyleFor("raise");
    expect(raise.staggerMs).toBeGreaterThan(call.staggerMs);
    expect(raise.tiltRad).toBeGreaterThan(call.tiltRad);
    expect(raise.travelMs).toBeLessThan(call.travelMs);
  });
});
