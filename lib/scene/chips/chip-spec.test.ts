import { describe, expect, it } from "vitest";
import {
  CHIP_DRAW_SCALE,
  chipMetrics,
  chipVariance,
  flightVariance,
  MAX_DRIFT_X_PX,
  MAX_DRIFT_Y_PX,
  MAX_RADIUS_PX,
  MAX_ROLL_DEG,
  MAX_SLIDE_PX,
  MAX_TILT_DEG,
  MAX_WALL_PX,
  MIN_RADIUS_PX,
  MIN_WALL_PX,
  shade,
  SIZE_VARIANCE,
  solveChipWorldRadius,
  WALL_RATIO,
} from "./chip-spec";
import { CHIP_RADIUS, TILT_SIN } from "../scene-config";

/**
 * The scales this scene actually renders at, measured off `fitView`: a rail
 * of `w` CSS pixels gives `(w / 2 / RAIL_SCALE) / FELT.radiusX` pixels per
 * world unit. A 900px desktop rail is ~44, a 340px phone rail is ~17, and a
 * cramped landscape strip is lower still.
 */
const REAL_SCALES = [12, 17, 24, 33, 44, 60, 90];

describe("the side wall, which is the whole redesign", () => {
  it("is never thinner than 3 pixels at any scale this table renders at", () => {
    // The failure this exists to prevent, with the old numbers: a 0.05-unit
    // chip at 17px/unit painted 0.65px of wall. Under a pixel there is no
    // cylinder, only a coloured ellipse -- "too flat, too much like a UI
    // element" is that number.
    for (const scale of REAL_SCALES) {
      const radius = solveChipWorldRadius(CHIP_RADIUS, scale);
      const { wallPx } = chipMetrics(scale, TILT_SIN, radius);
      expect(wallPx).toBeGreaterThanOrEqual(MIN_WALL_PX);
    }
  });

  it("is never thicker than 5 pixels either, or the chip is a hockey puck", () => {
    for (const scale of REAL_SCALES) {
      const radius = solveChipWorldRadius(CHIP_RADIUS, scale);
      expect(chipMetrics(scale, TILT_SIN, radius).wallPx).toBeLessThanOrEqual(MAX_WALL_PX);
    }
  });

  it("takes its radius floor from the wall floor rather than from taste", () => {
    // If these ever disagree the minimum chip cannot carry the minimum wall
    // without changing its proportions, and the clamp starts lying.
    expect(MIN_RADIUS_PX).toBe(MIN_WALL_PX / WALL_RATIO);
  });

  it("holds even for a degenerate pre-layout frame", () => {
    // A display:none ancestor hands back a zero-size box; the guard must not
    // produce NaN, which draws nothing and is the hardest blank to diagnose.
    const metrics = chipMetrics(0, TILT_SIN, solveChipWorldRadius(CHIP_RADIUS, 0));
    expect(Number.isFinite(metrics.radiusPx)).toBe(true);
    expect(metrics.wallPx).toBeGreaterThanOrEqual(MIN_WALL_PX);
  });
});

describe("the chip's proportions", () => {
  it("draws narrower than the system it replaces", () => {
    // The old painter multiplied the world radius by 1.35 to fight the wall
    // collapse above. Enlarging a flat thing does not make it less flat, so
    // the token got smaller and the wall got the pixels instead.
    expect(CHIP_DRAW_SCALE).toBeLessThan(1.35);
  });

  it("keeps the stack pitch equal to the wall, so a column is one cylinder", () => {
    // Not a tunable. If the pitch exceeds the wall, daylight opens between
    // chips and the column stops reading as a stack; if it is under, the
    // chips intersect.
    for (const scale of REAL_SCALES) {
      const metrics = chipMetrics(scale, TILT_SIN, solveChipWorldRadius(CHIP_RADIUS, scale));
      expect(metrics.pitchPx).toBe(metrics.wallPx);
    }
  });

  it("lands the stack separation in the 3-4 pixel band across real plates", () => {
    for (const scale of REAL_SCALES) {
      const metrics = chipMetrics(scale, TILT_SIN, solveChipWorldRadius(CHIP_RADIUS, scale));
      expect(metrics.pitchPx).toBeGreaterThanOrEqual(3);
      expect(metrics.pitchPx).toBeLessThanOrEqual(4);
    }
  });

  it("foreshortens the face by the camera's own squash, so a chip lies down", () => {
    const metrics = chipMetrics(44, TILT_SIN, solveChipWorldRadius(CHIP_RADIUS, 44));
    expect(metrics.faceRadiusPx / metrics.radiusPx).toBeCloseTo(TILT_SIN, 5);
  });

  it("never grows past the ceiling on a very large plate", () => {
    expect(chipMetrics(400, TILT_SIN, solveChipWorldRadius(CHIP_RADIUS, 400)).radiusPx)
      .toBeLessThanOrEqual(MAX_RADIUS_PX);
  });
});

describe("solveChipWorldRadius", () => {
  it("hands the layout the same size the painter will draw", () => {
    // The bug this prevents: the painter clamps a phone's chips larger while
    // the layout still spaces columns by the unclamped radius, so the mound is
    // laid out for one chip and drawn with another, and its columns overlap.
    for (const scale of REAL_SCALES) {
      const radius = solveChipWorldRadius(CHIP_RADIUS, scale);
      expect(radius * scale).toBeCloseTo(chipMetrics(scale, TILT_SIN, radius).radiusPx, 6);
    }
  });

  it("enlarges the chip on a small plate and leaves a large one honest", () => {
    const phone = solveChipWorldRadius(CHIP_RADIUS, 17);
    const desktop = solveChipWorldRadius(CHIP_RADIUS, 44);
    expect(phone).toBeGreaterThan(desktop);
    expect(desktop).toBeCloseTo(CHIP_RADIUS * CHIP_DRAW_SCALE, 6);
  });
});

describe("imperfection", () => {
  it("hands the same chip the same flaws every time", () => {
    // The pile is rebuilt from the pot on every snapshot. A chip that has
    // already settled must get its identical tilt and slide back, or the whole
    // mound shimmers each time anybody bets.
    for (let seed = 0; seed < 40; seed += 1) {
      expect(chipVariance(seed)).toEqual(chipVariance(seed));
      expect(flightVariance(seed)).toEqual(flightVariance(seed));
    }
  });

  it("stays inside the resting bounds: a hand-stacked column, not a slumped one", () => {
    const maxTilt = (MAX_TILT_DEG * Math.PI) / 180;
    for (let seed = 0; seed < 500; seed += 1) {
      const variance = chipVariance(seed);
      expect(Math.abs(variance.tiltRad)).toBeLessThanOrEqual(maxTilt + 1e-12);
      expect(Math.abs(variance.slidePx)).toBeLessThanOrEqual(MAX_SLIDE_PX + 1e-12);
      expect(variance.sizeScale).toBeGreaterThanOrEqual(1 - SIZE_VARIANCE - 1e-12);
      expect(variance.sizeScale).toBeLessThanOrEqual(1 + SIZE_VARIANCE + 1e-12);
      expect(variance.spinRad).toBeGreaterThanOrEqual(0);
      expect(variance.spinRad).toBeLessThanOrEqual(Math.PI * 2);
    }
  });

  it("stays inside the flight bounds", () => {
    const maxRoll = (MAX_ROLL_DEG * Math.PI) / 180;
    for (let seed = 0; seed < 500; seed += 1) {
      const variance = flightVariance(seed);
      expect(Math.abs(variance.rollRad)).toBeLessThanOrEqual(maxRoll + 1e-12);
      expect(Math.abs(variance.driftXPx)).toBeLessThanOrEqual(MAX_DRIFT_X_PX + 1e-12);
      expect(Math.abs(variance.driftYPx)).toBeLessThanOrEqual(MAX_DRIFT_Y_PX + 1e-12);
      expect(variance.driftPhase).toBeGreaterThan(0.3);
      expect(variance.driftPhase).toBeLessThan(0.7);
    }
  });

  it("actually varies — a constant would pass every bound above", () => {
    const spins = new Set<number>();
    const tilts = new Set<number>();
    for (let seed = 0; seed < 60; seed += 1) {
      spins.add(chipVariance(seed).spinRad);
      tilts.add(chipVariance(seed).tiltRad);
    }
    expect(spins.size).toBe(60);
    expect(tilts.size).toBe(60);
  });

  it("spins the face over the whole circle, which is what kills the clone look", () => {
    // The one field that is deliberately unbounded. Eight inserts lining up
    // perfectly down a column is the most synthetic thing on the felt.
    let low = 0;
    let high = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      if (chipVariance(seed).spinRad < Math.PI) low += 1; else high += 1;
    }
    expect(low).toBeGreaterThan(60);
    expect(high).toBeGreaterThan(60);
  });
});

describe("the material", () => {
  it("shades toward white and black without leaving the byte range", () => {
    for (const colour of [0x000000, 0xffffff, 0x9e2b2f, 0x1b1c1f]) {
      for (const amount of [-1, -0.5, 0, 0.5, 1, 4, -4]) {
        const result = shade(colour, amount);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it("leaves a colour alone at zero", () => {
    expect(shade(0x9e2b2f, 0)).toBe(0x9e2b2f);
  });
});
