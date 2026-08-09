import { describe, expect, it } from "vitest";
import {
  CHIP_AIRTIME_MS,
  CHIP_FLIGHT_SCALE,
  CHIP_STAGGER_MS,
  MAX_SPRING_STEP_MS,
  SPRING_BET,
  SPRING_DROP,
  SPRING_SWEEP,
  arcLift,
  dampingRatio,
  flightScale,
  sampleArc,
  springAt,
  sprayAirtimeMs,
  stepSpring,
  type SpringConfig,
  type SpringState,
} from "./chip-spring";
import { lerp, lerpFactorForDelta } from "./chip-physics";
import { MAX_FRAME_DELTA_MS } from "./render-scheduler";
import type { Vec3 } from "./scene-config";

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Run a spring to rest, returning every position it passed through. */
function settle(
  from: Vec3,
  target: Vec3,
  config: SpringConfig,
  frameMs = 1000 / 60,
  maxFrames = 2_000,
): { path: Vec3[]; frames: number; arrived: boolean } {
  let state: SpringState = springAt(from);
  const path: Vec3[] = [];
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const step = stepSpring(state, target, frameMs, config);
    state = { position: step.position, velocity: step.velocity };
    path.push(step.position);
    if (step.arrived) return { path, frames: frame + 1, arrived: true };
  }
  return { path, frames: maxFrames, arrived: false };
}

/** How far past the target a path travelled, as a fraction of the journey. */
function overshootFraction(path: Vec3[], from: Vec3, target: Vec3): number {
  const journey = Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z);
  if (journey <= 0) return 0;
  const dirX = (target.x - from.x) / journey;
  const dirY = (target.y - from.y) / journey;
  const dirZ = (target.z - from.z) / journey;
  let furthest = 0;
  for (const point of path) {
    const along = (point.x - from.x) * dirX + (point.y - from.y) * dirY + (point.z - from.z) * dirZ;
    furthest = Math.max(furthest, along);
  }
  return (furthest - journey) / journey;
}

describe("the spring", () => {
  it("accelerates out of rest, where the lerp it replaces leaves at full speed", () => {
    // The whole difference in one assertion. The exponential decay's first
    // frame is its fastest and every frame after is slower -- nothing is ever
    // pushed. A spring's first frame is its slowest.
    //
    // Only the opening frames are compared: this spring reaches peak speed
    // around a quarter period in (~117ms at tension 180), and asserting
    // monotonic acceleration past that would be asserting it never arrives.
    const from = at(0, 0.9, 0);
    const target = at(6, 0.9, 0);

    let state = springAt(from);
    const spring: number[] = [];
    let previous = from.x;
    for (let frame = 0; frame < 4; frame += 1) {
      const step = stepSpring(state, target, 1000 / 60, SPRING_BET);
      state = { position: step.position, velocity: step.velocity };
      spring.push(step.position.x - previous);
      previous = step.position.x;
    }

    const decay: number[] = [];
    let lerped = from.x;
    for (let frame = 0; frame < 4; frame += 1) {
      const next = lerp(lerped, target.x, lerpFactorForDelta(1000 / 60));
      decay.push(next - lerped);
      lerped = next;
    }

    for (let i = 1; i < spring.length; i += 1) {
      expect(spring[i]).toBeGreaterThan(spring[i - 1]);
      expect(decay[i]).toBeLessThan(decay[i - 1]);
    }
  });

  it("arrives exactly, so a pile lines up with the pile beside it", () => {
    const target = at(2, 0.934, -1);
    const { path, arrived } = settle(at(-6, 0.934, 3), target, SPRING_BET);
    expect(arrived).toBe(true);
    expect(path.at(-1)).toEqual(target);
  });

  it("terminates, so the render loop always gets to sleep", () => {
    // The invariant the whole scheduler rests on. An asymptote that never
    // reports arrival holds the canvas awake forever.
    for (const config of [SPRING_BET, SPRING_SWEEP, SPRING_DROP]) {
      const { arrived, frames } = settle(at(-9, 0.9, 5), at(0, 0.9, -3), config);
      expect(arrived).toBe(true);
      // Comfortably inside the payout budget, at 60fps.
      expect(frames * (1000 / 60)).toBeLessThan(1_500);
    }
  });

  it("carries the requested character on a bet: stiff, with a real settle", () => {
    expect(SPRING_BET.tension).toBe(180);
    expect(dampingRatio(SPRING_BET)).toBeLessThan(1);
    const from = at(0, 0.934, 6);
    const target = at(0, 0.934, 1.8);
    const overshoot = overshootFraction(settle(from, target, SPRING_BET).path, from, target);
    // It must overshoot -- that recovery is the event that says "landed" --
    // but a chip diameter past the spot reads as elastic, not heavy.
    expect(overshoot).toBeGreaterThan(0.02);
    expect(overshoot).toBeLessThan(0.12);
  });

  it("never overshoots the two journeys where past-the-target is off the felt", () => {
    const from = at(-5.8, 0.934, 1.9);
    const target = at(0, 0.934, -2.86);
    // Tolerance is one part in a billion of the journey: the final frame is
    // snapped exactly onto the target, and "exactly" in floating point lands
    // a few ulps either side of it.
    expect(overshootFraction(settle(from, target, SPRING_SWEEP).path, from, target))
      .toBeLessThan(1e-9);
    expect(dampingRatio(SPRING_SWEEP)).toBeGreaterThanOrEqual(1);
  });

  it("stays stable at the worst frame the scheduler can deliver", () => {
    // A stiff spring integrated at a 64ms frame without sub-stepping does not
    // look wrong, it diverges. This is why MAX_SPRING_STEP_MS exists.
    for (const config of [SPRING_BET, SPRING_SWEEP, SPRING_DROP]) {
      const { path, arrived } = settle(at(-9, 0.9, 5), at(0, 0.9, -3), config, MAX_FRAME_DELTA_MS);
      expect(arrived).toBe(true);
      for (const point of path) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Math.abs(point.x)).toBeLessThan(30);
        expect(Math.abs(point.z)).toBeLessThan(30);
      }
    }
    expect(MAX_SPRING_STEP_MS).toBeLessThan(MAX_FRAME_DELTA_MS);
  });

  it("reaches the same place at 30fps as at 144fps", () => {
    // Frame-rate independence, which the sub-stepping is what buys.
    const from = at(-6, 0.9, 3);
    const target = at(1, 0.9, -2);
    const slow = settle(from, target, SPRING_BET, 1000 / 30);
    const fast = settle(from, target, SPRING_BET, 1000 / 144);
    expect(slow.arrived && fast.arrived).toBe(true);
    const slowMs = slow.frames * (1000 / 30);
    const fastMs = fast.frames * (1000 / 144);
    expect(Math.abs(slowMs - fastMs)).toBeLessThan(60);
  });

  it("is interruptible: retargeting keeps the momentum it already had", () => {
    // What makes a sweep curve through the bet spot rather than stopping
    // dead and starting a second journey.
    let state = springAt(at(0, 0.9, 6));
    for (let frame = 0; frame < 10; frame += 1) {
      const step = stepSpring(state, at(0, 0.9, 1.8), 1000 / 60, SPRING_BET);
      state = { position: step.position, velocity: step.velocity };
    }
    const carried = state.velocity.z;
    expect(carried).toBeLessThan(0);
    const next = stepSpring(state, at(0, 0.9, -2.86), 1000 / 60, SPRING_SWEEP);
    // Still travelling the same way on the frame the target changed.
    expect(next.velocity.z).toBeLessThan(0);
    expect(next.position.z).toBeLessThan(state.position.z);
  });

  it("does nothing for a frame that did not happen", () => {
    const state = springAt(at(1, 2, 3));
    for (const delta of [0, -8, Number.NaN]) {
      const step = stepSpring(state, at(9, 9, 9), delta, SPRING_BET);
      expect(step.position).toEqual({ x: 1, y: 2, z: 3 });
      expect(step.arrived).toBe(false);
    }
  });

  it("survives a zero or negative mass rather than dividing by it", () => {
    const step = stepSpring(springAt(at(0, 0, 0)), at(1, 0, 0), 16, {
      tension: 180, friction: 17, mass: 0,
    });
    expect(Number.isFinite(step.position.x)).toBe(true);
  });

  it("declares arrival only when both settled and stopped", () => {
    // Passing through the target at speed is not an arrival. If it were, a
    // chip would be parked mid-flight -- the "nothing ever lands" bug one
    // layer down from the one this module fixes.
    //
    // Constructed rather than searched for: at a 60Hz frame the spring steps
    // clean over the 12-thousandth-of-a-unit rest band while it is still
    // moving, so a natural flight never samples the state this guards. That
    // is luck, not a guarantee -- a slower preset or a 240Hz frame would land
    // in it -- so the state is built directly.
    const target = at(0, 0.9, 1.8);
    const movingThroughTarget: SpringState = {
      position: { ...target },
      velocity: { x: 0, y: 0, z: -4 },
    };
    const step = stepSpring(movingThroughTarget, target, 1000 / 240, SPRING_BET);
    expect(step.arrived).toBe(false);
    expect(step.position.z).toBeLessThan(target.z);

    // And the mirror case: stopped, but not yet there.
    const stoppedShort = stepSpring(springAt(at(0, 0.9, 6)), target, 1000 / 240, SPRING_BET);
    expect(stoppedShort.arrived).toBe(false);
  });
});

describe("damping ratio", () => {
  it("names the one number that predicts an overshoot", () => {
    expect(dampingRatio({ tension: 180, friction: 12, mass: 1 })).toBeCloseTo(0.447, 3);
    expect(dampingRatio({ tension: 100, friction: 20, mass: 1 })).toBe(1);
  });

  it("does not divide by zero on a degenerate spring", () => {
    expect(dampingRatio({ tension: 0, friction: 10, mass: 1 })).toBe(Infinity);
  });
});

describe("the arc", () => {
  it("is zero on the felt at both ends and peaks in the middle", () => {
    expect(arcLift(0)).toBe(0);
    expect(arcLift(1)).toBeCloseTo(0, 10);
    expect(arcLift(0.5)).toBeCloseTo(1, 10);
  });

  it("clamps rather than diving through the table", () => {
    expect(arcLift(-3)).toBe(0);
    expect(arcLift(9)).toBeCloseTo(0, 10);
  });

  it("holds a chip flat on the rail until its stagger turn comes", () => {
    // Without the delay inside the sample, a queued chip hovers at its launch
    // point instead of resting on the rail.
    const waiting = sampleArc(20, 2.2, 90);
    expect(waiting).toEqual({ lift: 0, height: 0, landed: false });
    expect(sampleArc(90 + CHIP_AIRTIME_MS / 2, 2.2, 90).lift).toBeCloseTo(1, 6);
  });

  it("lands exactly, on a clock the spring cannot disturb", () => {
    // The reason the arc is not driven off distance-to-target: a spring that
    // overshoots would make the chip climb back into the air on its return.
    const landed = sampleArc(CHIP_AIRTIME_MS, 2.2);
    expect(landed).toEqual({ lift: 0, height: 0, landed: true });
    expect(sampleArc(CHIP_AIRTIME_MS * 4, 2.2).landed).toBe(true);
  });

  it("lifts by the peak it was given", () => {
    expect(sampleArc(CHIP_AIRTIME_MS / 2, 2.2).height).toBeCloseTo(2.2, 6);
  });

  it("treats a zero-length arc as already landed", () => {
    expect(sampleArc(1, 2.2, 0, 0).landed).toBe(true);
  });
});

describe("mid-flight scale", () => {
  it("is exactly 1 on the cloth, so a resting pile is never resized", () => {
    expect(flightScale(0)).toBe(1);
  });

  it("grows at the apex by the stated amount and no more", () => {
    expect(flightScale(1)).toBeCloseTo(1 + CHIP_FLIGHT_SCALE, 10);
    expect(flightScale(4)).toBeCloseTo(1 + CHIP_FLIGHT_SCALE, 10);
    expect(flightScale(-2)).toBe(1);
  });

  it("stays subtle enough to read as depth rather than as a pop", () => {
    expect(CHIP_FLIGHT_SCALE).toBeGreaterThan(0.05);
    expect(CHIP_FLIGHT_SCALE).toBeLessThan(0.2);
  });
});

describe("spray timing", () => {
  it("staggers at the rate the eye resolves as separate chips", () => {
    expect(CHIP_STAGGER_MS).toBe(30);
  });

  it("has a ten-chip shove fully down well inside the flight window", () => {
    // poker-table.tsx holds a bet flight in its queue for 900ms.
    expect(sprayAirtimeMs(10)).toBeLessThan(900);
  });

  it("has a twelve-chip payout down before the next hand is dealt", () => {
    // NEXT_HAND_DELAY_MS is 2800.
    expect(sprayAirtimeMs(12)).toBeLessThan(2_800);
  });

  it("is zero for a spray with nothing in it", () => {
    expect(sprayAirtimeMs(0)).toBe(0);
    expect(sprayAirtimeMs(-3)).toBe(0);
  });

  it("costs one airtime for a single chip, not one airtime plus a stagger", () => {
    expect(sprayAirtimeMs(1)).toBe(CHIP_AIRTIME_MS);
  });
});
