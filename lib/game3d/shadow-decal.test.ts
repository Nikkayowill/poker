import { describe, expect, it } from "vitest";
import { holeCardGroupShadowPose, pileShadowPose } from "./shadow-decal";
import { CHIP } from "./dimensions";

describe("pileShadowPose", () => {
  it("is null for an empty or negative pile — nothing to ground", () => {
    expect(pileShadowPose(0, 1, 1)).toBeNull();
    expect(pileShadowPose(-3, 1, 1)).toBeNull();
  });

  it("sits at the pile's own x/z", () => {
    const pose = pileShadowPose(4, 1.2, -0.4);
    expect(pose?.x).toBe(1.2);
    expect(pose?.z).toBe(-0.4);
  });

  it("grows with chip count", () => {
    const small = pileShadowPose(1, 0, 0)!;
    const big = pileShadowPose(10, 0, 0)!;
    expect(big.radius).toBeGreaterThan(small.radius);
    expect(big.opacity).toBeGreaterThan(small.opacity);
  });

  it("never shrinks past a single chip's own radius", () => {
    const pose = pileShadowPose(1, 0, 0)!;
    expect(pose.radius).toBeGreaterThan(CHIP.radius);
  });

  it("stops growing past the display cap (MAX_CHIPS_PER_PILE, 14) — a huge pot's shadow doesn't keep inflating", () => {
    const atCap = pileShadowPose(14, 0, 0)!;
    const wayOver = pileShadowPose(500, 0, 0)!;
    expect(wayOver.radius).toBeCloseTo(atCap.radius, 10);
    expect(wayOver.opacity).toBeCloseTo(atCap.opacity, 10);
  });

  it("opacity never exceeds a sane maximum, even at the cap", () => {
    const pose = pileShadowPose(14, 0, 0)!;
    expect(pose.opacity).toBeLessThanOrEqual(0.5);
  });
});

describe("holeCardGroupShadowPose", () => {
  it("sits at the given anchor", () => {
    const pose = holeCardGroupShadowPose(0.5, -1.1, 0.1, 0.2);
    expect(pose.x).toBe(0.5);
    expect(pose.z).toBe(-1.1);
  });

  it("covers the larger of the two footprint dimensions, margined", () => {
    const fanHalfSpan = 0.1;
    const cardHeight = 0.4; // taller than the fan is wide
    const pose = holeCardGroupShadowPose(0, 0, fanHalfSpan, cardHeight);
    expect(pose.radius).toBeGreaterThan(cardHeight / 2);
    expect(pose.radius).toBeGreaterThan(fanHalfSpan);
  });

  it("stays generous when the fan is the larger dimension", () => {
    const fanHalfSpan = 0.5;
    const cardHeight = 0.1;
    const pose = holeCardGroupShadowPose(0, 0, fanHalfSpan, cardHeight);
    expect(pose.radius).toBeGreaterThan(fanHalfSpan);
  });
});
