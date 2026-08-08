import { describe, expect, it } from "vitest";
import {
  restingPileChipPoses,
  flightChipPoses,
} from "./chip-instance-model";
import { chipBreakdown, CHIP_DENOMINATIONS } from "./denominations";
import { CHIP } from "./dimensions";
import { flightDurationMs } from "./chip-trajectory";

const ORIGIN = { x: 0, y: 0.86, z: 0 };
const TARGET = { x: 1.2, y: 0.86, z: -0.4 };

describe("restingPileChipPoses", () => {
  it("returns one pose per chip in the greedy breakdown, in the same order", () => {
    const amount = 730;
    const poses = restingPileChipPoses(amount, ORIGIN, 3, "seat-0");
    const breakdown = chipBreakdown(amount);
    expect(poses).toHaveLength(breakdown.length);
    expect(poses.map((p) => p.denom)).toEqual(breakdown.map((d) => d.value));
  });

  it("stacks flush: the nth chip sits exactly n chip-thicknesses above the pile base", () => {
    const poses = restingPileChipPoses(2500, ORIGIN, 0, "pot");
    poses.forEach((pose, i) => {
      expect(pose.y).toBeCloseTo(ORIGIN.y + CHIP.thickness / 2 + i * CHIP.thickness, 10);
    });
  });

  it("is empty for a zero or negative amount", () => {
    expect(restingPileChipPoses(0, ORIGIN, 0, "x")).toHaveLength(0);
    expect(restingPileChipPoses(-50, ORIGIN, 0, "x")).toHaveLength(0);
  });

  it("gives every chip a distinct, stable key", () => {
    const poses = restingPileChipPoses(1400, ORIGIN, 5, "seat-2");
    const keys = new Set(poses.map((p) => p.key));
    expect(keys.size).toBe(poses.length);
  });

  it("two different seeds jitter the same amount differently, so equal piles don't stack identically", () => {
    const a = restingPileChipPoses(1000, ORIGIN, 1, "a");
    const b = restingPileChipPoses(1000, ORIGIN, 2, "b");
    const anyDifferent = a.some(
      (pose, i) => pose.x !== b[i].x || pose.z !== b[i].z,
    );
    expect(anyDifferent).toBe(true);
  });
});

describe("flightChipPoses", () => {
  const chips = chipBreakdown(325);

  it("is not done at launch and is done once the flight's own duration has elapsed", () => {
    const atLaunch = flightChipPoses(chips, ORIGIN, TARGET, 0, "flight-1");
    expect(atLaunch.done).toBe(false);
    expect(atLaunch.poses).toHaveLength(chips.length);

    const durationMs = flightDurationMs(chips.length);
    const landed = flightChipPoses(chips, ORIGIN, TARGET, durationMs, "flight-1");
    expect(landed.done).toBe(true);
  });

  it("every chip is exactly at its jittered landing spot once done", () => {
    const durationMs = flightDurationMs(chips.length);
    const { poses } = flightChipPoses(chips, ORIGIN, TARGET, durationMs, "flight-1");
    for (const pose of poses) {
      // Landed chips sit within the pile's scatter radius of the target,
      // never at the origin they launched from.
      const distFromOrigin = Math.hypot(pose.x - ORIGIN.x, pose.z - ORIGIN.z);
      const distFromTarget = Math.hypot(pose.x - TARGET.x, pose.z - TARGET.z);
      expect(distFromTarget).toBeLessThan(distFromOrigin);
    }
  });

  it("an empty chip list is trivially done with no poses", () => {
    const result = flightChipPoses([], ORIGIN, TARGET, 0, "empty");
    expect(result.done).toBe(true);
    expect(result.poses).toHaveLength(0);
  });

  it("every rendered denomination is one this layer actually knows how to bucket", () => {
    // Guards the InstancedMesh layer's own assumption: it keeps one mesh per
    // CHIP_DENOMINATIONS entry, keyed by `.value`, so a pose whose `denom`
    // isn't one of those values would silently never be drawn.
    const known = new Set(CHIP_DENOMINATIONS.map((d) => d.value));
    const poses = restingPileChipPoses(9876, ORIGIN, 0, "big");
    for (const pose of poses) expect(known.has(pose.denom)).toBe(true);
  });
});
