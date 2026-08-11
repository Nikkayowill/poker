import { describe, expect, it } from "vitest";
import {
  clampWristToFelt,
  dampingFactor,
  solveTwoBoneIk,
  WRIST_CLEARANCE,
} from "./arm-ik";
import type { Vec3 } from "./seat-layout";

const dist = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

describe("solveTwoBoneIk", () => {
  // A simple reference chain: shoulder at origin, elbow out along +x and
  // slightly down (a typical seated bend), wrist further along +x. Bone
  // lengths: 0.3 (upper arm) and 0.28 (forearm).
  const shoulder: Vec3 = { x: 0, y: 1, z: 0 };
  const elbow: Vec3 = { x: 0.3, y: 0.85, z: 0.1 };
  const wrist: Vec3 = { x: 0.58, y: 0.8, z: 0.15 };

  it("preserves both bone lengths exactly, for a reachable target", () => {
    const target: Vec3 = { x: 0.4, y: 0.86, z: 0.2 };
    const { elbow: e, wrist: w } = solveTwoBoneIk(shoulder, elbow, wrist, target);
    expect(dist(shoulder, e)).toBeCloseTo(dist(shoulder, elbow), 5);
    expect(dist(e, w)).toBeCloseTo(dist(elbow, wrist), 5);
  });

  it("lands the wrist exactly on a reachable target", () => {
    const target: Vec3 = { x: 0.4, y: 0.86, z: 0.2 };
    const { wrist: w, overreached } = solveTwoBoneIk(shoulder, elbow, wrist, target);
    expect(overreached).toBe(false);
    expect(dist(w, target)).toBeLessThan(1e-4);
  });

  it("clamps to full extension rather than stretching past reach, and flags it", () => {
    const farAway: Vec3 = { x: 5, y: 1, z: 0 };
    const { elbow: e, wrist: w, overreached } = solveTwoBoneIk(shoulder, elbow, wrist, farAway);
    const upperLen = dist(shoulder, elbow);
    const foreLen = dist(elbow, wrist);
    expect(overreached).toBe(true);
    // Fully extended: wrist sits within a hair of upperLen + foreLen from the shoulder.
    expect(dist(shoulder, w)).toBeLessThanOrEqual(upperLen + foreLen);
    expect(dist(shoulder, w)).toBeGreaterThan(upperLen + foreLen - 0.01);
    expect(dist(shoulder, e)).toBeCloseTo(upperLen, 5);
  });

  it("reproduces the original pose when the target is the current wrist", () => {
    // Solving for a target that already sits exactly at the reach distance
    // (the current wrist itself) should recover the current elbow, not an
    // arbitrary point on the reachable circle — this is the load-bearing
    // property that keeps a correction from flipping the bend to the wrong
    // side of the arm.
    const { elbow: e, wrist: w } = solveTwoBoneIk(shoulder, elbow, wrist, wrist);
    expect(dist(e, elbow)).toBeLessThan(1e-4);
    expect(dist(w, wrist)).toBeLessThan(1e-4);
  });

  it("bends continuously — a target near the wrist keeps the elbow near its original spot", () => {
    // A small nudge to the target should not flip the chain to bend the
    // other way around the shoulder->target axis (the failure mode a sign
    // error in the bend-plane derivation would produce).
    const nearbyTarget = add(wrist, { x: -0.01, y: 0.005, z: 0.01 });
    const { elbow: e } = solveTwoBoneIk(shoulder, elbow, wrist, nearbyTarget);
    expect(dist(e, elbow)).toBeLessThan(0.05);
  });

  it("does not throw or NaN on a degenerate (already-straight) pose", () => {
    const straightElbow: Vec3 = { x: 0.3, y: 1, z: 0 };
    const straightWrist: Vec3 = { x: 0.6, y: 1, z: 0 };
    const target: Vec3 = { x: 0.6, y: 1, z: 0 }; // dead ahead, no bend hint
    const { elbow: e, wrist: w } = solveTwoBoneIk(shoulder, straightElbow, straightWrist, target);
    expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z)).toBe(true);
    expect(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z)).toBe(true);
  });
});

describe("clampWristToFelt", () => {
  const feltTopY = 0.86;

  it("returns null when the wrist already clears the felt", () => {
    expect(clampWristToFelt({ x: 0, y: 0.9, z: 0 }, feltTopY)).toBeNull();
  });

  it("returns null exactly at the clearance floor (no correction needed)", () => {
    const atFloor = { x: 0, y: feltTopY + WRIST_CLEARANCE, z: 0 };
    expect(clampWristToFelt(atFloor, feltTopY)).toBeNull();
  });

  it("lifts a sunken wrist to the clearance floor, preserving x/z", () => {
    const sunken = { x: 0.12, y: 0.5, z: -0.2 };
    const corrected = clampWristToFelt(sunken, feltTopY);
    expect(corrected).not.toBeNull();
    expect(corrected?.y).toBeCloseTo(feltTopY + WRIST_CLEARANCE, 6);
    expect(corrected?.x).toBe(sunken.x);
    expect(corrected?.z).toBe(sunken.z);
  });
});

describe("dampingFactor", () => {
  it("is 0 at zero delta and approaches 1 for a large delta", () => {
    expect(dampingFactor(18, 0)).toBe(0);
    expect(dampingFactor(18, 10)).toBeGreaterThan(0.999);
  });

  it("is frame-rate independent: two half-steps compose to about one full step", () => {
    const rate = 18;
    const full = dampingFactor(rate, 1 / 60);
    const half = dampingFactor(rate, 1 / 120);
    // Composing two exponential decays of the same rate over half the time
    // each should land within a hair of the single full-delta factor.
    const composed = half + half * (1 - half);
    expect(composed).toBeCloseTo(full, 3);
  });
});
