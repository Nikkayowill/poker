import { describe, expect, it } from "vitest";
import { clampDelta, MAX_FRAME_DELTA_S } from "./clock-delta";

describe("clampDelta", () => {
  it("passes an ordinary frame delta through unchanged", () => {
    const result = clampDelta(1 / 60, MAX_FRAME_DELTA_S);
    expect(result.delta).toBeCloseTo(1 / 60, 10);
    expect(result.elapsedCorrection).toBe(0);
  });

  it("passes a delta exactly at the bound through unchanged", () => {
    const result = clampDelta(MAX_FRAME_DELTA_S, MAX_FRAME_DELTA_S);
    expect(result.delta).toBe(MAX_FRAME_DELTA_S);
    expect(result.elapsedCorrection).toBe(0);
  });

  it("clamps a stall spike to the bound and reports the excess", () => {
    const result = clampDelta(3.2, MAX_FRAME_DELTA_S);
    expect(result.delta).toBe(MAX_FRAME_DELTA_S);
    expect(result.elapsedCorrection).toBeCloseTo(3.2 - MAX_FRAME_DELTA_S, 10);
  });

  it("treats a non-finite delta as zero rather than propagating NaN", () => {
    expect(clampDelta(NaN, MAX_FRAME_DELTA_S)).toEqual({ delta: 0, elapsedCorrection: 0 });
    expect(clampDelta(Infinity, MAX_FRAME_DELTA_S)).toEqual({ delta: 0, elapsedCorrection: 0 });
  });

  it("treats a zero or negative delta (a just-reset clock) as zero", () => {
    expect(clampDelta(0, MAX_FRAME_DELTA_S)).toEqual({ delta: 0, elapsedCorrection: 0 });
    expect(clampDelta(-0.1, MAX_FRAME_DELTA_S)).toEqual({ delta: 0, elapsedCorrection: 0 });
  });
});
