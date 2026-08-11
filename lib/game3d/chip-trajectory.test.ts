import { describe, expect, it } from "vitest";
import type { Vec3 } from "./seat-layout";
import { CHIP } from "./dimensions";
import {
  PILE_JITTER_FRACTION,
  chipStackY,
  easeOutCubic,
  pileChipJitter,
  pushDurationMs,
  sampleChipPush,
  type PushStyle,
} from "./chip-trajectory";

const FROM: Vec3 = { x: -2, y: 1.05, z: 1.5 };
const TO: Vec3 = { x: 0, y: 0.86, z: -0.5 };

const STYLE: PushStyle = {
  travelMs: 300,
  staggerMs: 80,
  arcHeight: 0.07,
  settleMs: 220,
  tiltRad: 0.09,
};

describe("chipStackY", () => {
  it("puts the first chip half a thickness up and every chip after it flush", () => {
    expect(chipStackY(0.86, 0)).toBeCloseTo(0.86 + CHIP.thickness / 2, 12);
    for (let i = 1; i < 14; i += 1) {
      expect(chipStackY(0.86, i) - chipStackY(0.86, i - 1)).toBeCloseTo(CHIP.thickness, 12);
    }
  });
});

describe("pileChipJitter", () => {
  it("is bounded to a fraction of a chip radius, at every index and seed", () => {
    // The bug this replaced grew with sqrt(index + seed), so a pile seeded
    // 101 strewed its discs three radii wide. A bound that holds for every
    // index is the whole point; a spot check on index 0 is not.
    const limit = CHIP.radius * PILE_JITTER_FRACTION;
    for (const seed of [0, 7, 35, 101]) {
      for (let i = 0; i < 20; i += 1) {
        const { dx, dz } = pileChipJitter(i, seed);
        expect(Math.abs(dx)).toBeLessThanOrEqual(limit + 1e-12);
        expect(Math.abs(dz)).toBeLessThanOrEqual(limit * 0.6 + 1e-12);
      }
    }
  });

  it("keeps consecutive chips of a column well inside a chip's own radius of each other", () => {
    // Anything approaching a radius perches each disc off the edge of the
    // one below it — the "chips inside each other" read.
    for (let i = 1; i < 20; i += 1) {
      const a = pileChipJitter(i - 1, 101);
      const b = pileChipJitter(i, 101);
      expect(Math.hypot(a.dx - b.dx, a.dz - b.dz)).toBeLessThan(CHIP.radius * 0.5);
    }
  });

  it("is deterministic and differs between seeds", () => {
    expect(pileChipJitter(3, 7)).toEqual(pileChipJitter(3, 7));
    expect(pileChipJitter(3, 7)).not.toEqual(pileChipJitter(3, 8));
  });
});

describe("sampleChipPush", () => {
  it("starts exactly at the source and ends exactly at the target, flat", () => {
    const start = sampleChipPush(FROM, TO, 0, 0, STYLE);
    expect(start.position).toEqual(FROM);
    expect(start.done).toBe(false);

    const end = sampleChipPush(FROM, TO, STYLE.travelMs + STYLE.settleMs, 0, STYLE);
    expect(end.position).toEqual(TO);
    expect(end.tiltX).toBe(0);
    expect(end.tiltZ).toBe(0);
    expect(end.done).toBe(true);
  });

  it("terminates exactly — done one ms past the total, never before touchdown", () => {
    const justBefore = sampleChipPush(FROM, TO, STYLE.travelMs - 1, 0, STYLE);
    expect(justBefore.landed).toBe(false);
    expect(justBefore.done).toBe(false);
    expect(sampleChipPush(FROM, TO, STYLE.travelMs + STYLE.settleMs + 1, 0, STYLE).done).toBe(true);
  });

  it("rides a low arc above its own path and never higher than arcHeight", () => {
    // A chip pushed across cloth, not lobbed: the lift is measured against
    // the eased straight line the chip is travelling along, so the bound
    // holds regardless of how far apart the endpoints are.
    for (let t = 0.05; t < 1; t += 0.05) {
      const sample = sampleChipPush(FROM, TO, STYLE.travelMs * t, 0, STYLE);
      const lineY = FROM.y + (TO.y - FROM.y) * easeOutCubic(t);
      expect(sample.position.y).toBeGreaterThan(lineY);
      expect(sample.position.y - lineY).toBeLessThanOrEqual(STYLE.arcHeight + 1e-9);
    }
  });

  it("rocks over its landing spot and is provably flat by the end of the settle", () => {
    const rocking = sampleChipPush(FROM, TO, STYLE.travelMs + STYLE.settleMs * 0.1, 0, STYLE);
    expect(rocking.landed).toBe(true);
    expect(rocking.done).toBe(false);
    expect(rocking.position.x).toBe(TO.x);
    expect(rocking.position.z).toBe(TO.z);
    expect(Math.hypot(rocking.tiltX, rocking.tiltZ)).toBeGreaterThan(0);
    // A tilted disc rests on its rim, so it rides fractionally high.
    expect(rocking.position.y).toBeGreaterThan(TO.y);

    for (const t of [0.5, 0.8, 0.95, 0.999]) {
      const sample = sampleChipPush(FROM, TO, STYLE.travelMs + STYLE.settleMs * t, 0, STYLE);
      expect(Math.hypot(sample.tiltX, sample.tiltZ)).toBeLessThanOrEqual(STYLE.tiltRad);
    }
  });

  it("holds a staggered chip at its source until its own launch", () => {
    const held = sampleChipPush(FROM, TO, STYLE.staggerMs * 3 - 1, 3, STYLE);
    expect(held.position).toEqual(FROM);
    expect(held.done).toBe(false);
  });

  it("is a pure function of elapsed time — identical samples for identical inputs", () => {
    expect(sampleChipPush(FROM, TO, 137, 2, STYLE)).toEqual(
      sampleChipPush(FROM, TO, 137, 2, STYLE),
    );
  });

  it("under reduced motion lands the identical position, at once", () => {
    const reduced = sampleChipPush(FROM, TO, 0, 5, STYLE, true);
    const animated = sampleChipPush(FROM, TO, pushDurationMs(6, STYLE), 5, STYLE);
    expect(reduced.position).toEqual(animated.position);
    expect(reduced.position).toEqual(TO);
    expect(reduced.done).toBe(true);
    expect(reduced.tiltX).toBe(0);
    expect(reduced.tiltZ).toBe(0);
  });

  it("budgets total duration by chip count and cadence", () => {
    expect(pushDurationMs(0, STYLE)).toBe(0);
    expect(pushDurationMs(1, STYLE)).toBe(STYLE.travelMs + STYLE.settleMs);
    expect(pushDurationMs(5, STYLE)).toBe(
      STYLE.travelMs + STYLE.settleMs + 4 * STYLE.staggerMs,
    );
  });
});
