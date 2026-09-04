import { describe, expect, it } from "vitest";

import { FARMHAND_SPEED } from "./farmhand";
import {
  FARMHAND_BOOT,
  FARMHAND_HIP_Y,
  FARMHAND_LEG_REACH,
  FARMHAND_SHIN,
  FARMHAND_THIGH,
  legJoints,
  spawnWalk,
  stepWalk,
  type WalkPose,
} from "./farmhand-walk";

const FRAME = 16;

function walk(frames: number, from: WalkPose = spawnWalk(), walking = true): WalkPose {
  let pose = from;
  for (let i = 0; i < frames; i += 1) pose = stepWalk(pose, walking, FARMHAND_SPEED, FRAME);
  return pose;
}

/** One full stride, sampled. */
function cycle(samples = 48): WalkPose[] {
  const settled = walk(80);
  return Array.from({ length: samples }, (_, i) =>
    stepWalk({ ...settled, phase: (i / samples) * Math.PI * 2 }, true, 0, 0),
  );
}

describe("the body", () => {
  it("keeps enough slack in a straight leg to absorb the whole body rise", () => {
    // This is forward kinematics: the foot goes where the angles put it. If
    // the hip ever stands higher than a straight leg is long, the rise lifts
    // the stance foot clean off the ground and he walks on air.
    const slack = FARMHAND_LEG_REACH - FARMHAND_HIP_Y;
    expect(slack).toBeGreaterThan(0);
    const highest = Math.max(...cycle(180).map((p) => p.rise));
    expect(highest).toBeLessThanOrEqual(slack);
  });

  it("is built from three real segments", () => {
    expect(FARMHAND_THIGH).toBeGreaterThan(0);
    expect(FARMHAND_SHIN).toBeGreaterThan(0);
    expect(FARMHAND_BOOT).toBeGreaterThan(0);
    expect(FARMHAND_LEG_REACH).toBeCloseTo(
      FARMHAND_THIGH + FARMHAND_SHIN + FARMHAND_BOOT,
      10,
    );
  });
});

describe("stepWalk", () => {
  it("stands in a neutral stance with nothing moving", () => {
    expect(spawnWalk()).toEqual({ phase: 0, weight: 0, hips: [0, 0], knees: [0, 0], rise: 0 });
  });

  it("settles to exactly neutral when he stops", () => {
    // Not "close to". A standing farmhand holding a fraction of a stride
    // forever is the same class of defect the bounce was.
    const stopped = walk(300, walk(60), false);
    expect(stopped.weight).toBe(0);
    expect(stopped.hips).toEqual([0, 0]);
    expect(stopped.knees).toEqual([0, 0]);
    expect(stopped.rise).toBe(0);
  });

  it("freezes the phase when he stops and resumes from it", () => {
    const moving = walk(30);
    expect(stepWalk(moving, false, FARMHAND_SPEED, FRAME).phase).toBe(moving.phase);
  });

  it("cycles on distance, not time, so one constant fits any speed", () => {
    const slow = stepWalk(spawnWalk(), true, FARMHAND_SPEED / 2, 32);
    const fast = stepWalk(spawnWalk(), true, FARMHAND_SPEED, 16);
    expect(slow.phase).toBeCloseTo(fast.phase, 12);
  });

  it("clamps one enormous frame rather than spinning the cycle", () => {
    const jumped = stepWalk(spawnWalk(), true, FARMHAND_SPEED, 600_000);
    const capped = stepWalk(spawnWalk(), true, FARMHAND_SPEED, 250);
    expect(jumped.phase).toBeCloseTo(capped.phase, 12);
  });
});

describe("the cycle", () => {
  it("keeps the two legs half a stride apart, which is what makes it a walk", () => {
    // Both legs doing the same thing at the same time is a hop, and a hop is
    // exactly what this module replaced.
    for (const pose of cycle()) {
      expect(pose.hips[0]).toBeCloseTo(-pose.hips[1], 10);
    }
  });

  it("actually swings the legs once it is up to weight", () => {
    const swings = cycle().map((p) => p.hips[0]);
    expect(Math.max(...swings)).toBeGreaterThan(0.5);
    expect(Math.min(...swings)).toBeLessThan(-0.5);
  });

  it("never bends a knee backwards", () => {
    // A knee folding the wrong way is the single fastest way to make a walk
    // look wrong, and it is one sign error away at all times.
    for (const pose of cycle(180)) {
      expect(pose.knees[0]).toBeGreaterThanOrEqual(0);
      expect(pose.knees[1]).toBeGreaterThanOrEqual(0);
    }
  });

  it("bends the knee while the leg swings through, not while it carries weight", () => {
    const poses = cycle(180);
    // The leg is furthest BACK at phase 3pi/2 and furthest FORWARD at pi/2;
    // it passes under the body at 0. The knee should be folded there and
    // straight at the extremes, where it is holding him up.
    const at = (t: number) => poses[Math.round((t / (Math.PI * 2)) * poses.length) % poses.length];
    expect(at(0).knees[0]).toBeGreaterThan(0.5);
    expect(at(Math.PI / 2).knees[0]).toBeLessThan(0.05);
    expect(at((3 * Math.PI) / 2).knees[0]).toBeLessThan(0.05);
  });

  it("rides highest at mid-stance and lowest as the legs pass their widest", () => {
    // Half a cycle out here is the difference between a walk and a limp: a
    // body is tallest over a straight supporting leg (phase 0, pi) and
    // shortest when both legs are reaching (+-pi/2).
    const poses = cycle(180);
    const at = (t: number) => poses[Math.round((t / (Math.PI * 2)) * poses.length) % poses.length];
    expect(at(0).rise).toBeGreaterThan(at(Math.PI / 2).rise);
    expect(at(Math.PI).rise).toBeGreaterThan(at((3 * Math.PI) / 2).rise);
    expect(Math.min(...poses.map((p) => p.rise))).toBeGreaterThanOrEqual(0);
  });
});

describe("legJoints", () => {
  it("hangs a still leg straight down, its foot exactly on the ground", () => {
    const leg = legJoints(1.1, 0, 0);
    expect(leg.knee).toEqual({ x: 1.1, y: FARMHAND_THIGH });
    expect(leg.ankle.x).toBeCloseTo(1.1, 10);
    expect(leg.ankle.y).toBeCloseTo(FARMHAND_THIGH + FARMHAND_SHIN, 10);
    // Straight down in screen space, which is what the boot is drawn along.
    expect(leg.toe).toEqual({ x: 0, y: 1 });
  });

  it("puts the knee in front when the leg swings forward", () => {
    expect(legJoints(0, 0.5, 0).knee.x).toBeGreaterThan(0);
    expect(legJoints(0, -0.5, 0).knee.x).toBeLessThan(0);
  });

  it("folds the ankle BACKWARD of the knee when the knee bends", () => {
    // The whole reason the shin angle is `hip - knee`. If this flips, he
    // walks with his shins hinged forwards like a bird.
    const straight = legJoints(0, 0, 0);
    const bent = legJoints(0, 0, 0.8);
    expect(bent.ankle.x).toBeLessThan(straight.ankle.x);
    expect(bent.ankle.y).toBeLessThan(straight.ankle.y);
  });

  it("never lets a leg reach further than it is long", () => {
    for (const pose of cycle(180)) {
      for (const i of [0, 1] as const) {
        const leg = legJoints(0, pose.hips[i], pose.knees[i]);
        expect(Math.hypot(leg.ankle.x, leg.ankle.y)).toBeLessThanOrEqual(
          FARMHAND_THIGH + FARMHAND_SHIN + 1e-9,
        );
      }
    }
  });
});
