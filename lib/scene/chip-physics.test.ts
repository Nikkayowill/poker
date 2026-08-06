import { describe, expect, it } from "vitest";
import { NEXT_HAND_DELAY_MS } from "@/lib/game/engine";
import { POT_CHIP_DENOMINATIONS_BB } from "@/lib/game/pot-chips";
import {
  arcHeight,
  BET_SPRAY_MAX_CHIPS,
  cubicEaseOut,
  shadeHex,
  stepGlideChip,
  betSprayDenominations,
  CHIP_ARC_PEAK,
  CHIP_LERP_PER_FRAME,
  CHIP_PALETTE,
  CHIP_SETTLE_EPSILON,
  chipPalette,
  chipSettleJitter,
  decorativeDenomination,
  distance,
  flightDurationMs,
  flightProgress,
  FUNNEL_CHIP_COUNT,
  FUNNEL_CHIP_STAGGER_MS,
  funnelSprayDenominations,
  lerp,
  lerpFactorForDelta,
  REFERENCE_FRAME_MS,
  sprayDenominations,
  stepChip,
} from "./chip-physics";
import type { Vec3 } from "./scene-config";

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

describe("chip friction slide", () => {
  it("closes exactly the spec's fraction on a 60fps frame", () => {
    expect(lerpFactorForDelta(REFERENCE_FRAME_MS)).toBeCloseTo(CHIP_LERP_PER_FRAME, 12);
  });

  /**
   * The reason this function exists at all. Written the way the spec states
   * it -- a flat 0.075 per frame -- a chip takes twice as long to arrive on a
   * 30fps phone as on a 60fps desktop, which is precisely backwards for a
   * scene built for low-end mobile.
   */
  it("takes the same wall-clock time at any frame rate", () => {
    const travel = (frameMs: number) => {
      let position = at(10, 0, 0);
      let elapsed = 0;
      while (distance(position, at(0, 0, 0)) > CHIP_SETTLE_EPSILON && elapsed < 10_000) {
        position = stepChip(position, at(0, 0, 0), 10, frameMs).base;
        elapsed += frameMs;
      }
      return elapsed;
    };
    const sixty = travel(1000 / 60);
    const thirty = travel(1000 / 30);
    // Within one frame of the slower device, which is all quantisation allows.
    expect(Math.abs(sixty - thirty)).toBeLessThan(1000 / 30);
  });

  it("never overshoots or reverses", () => {
    let position = at(6, 0, -4);
    const target = at(0, 0.9, 0);
    let previous = distance(position, target);
    for (let frame = 0; frame < 200; frame += 1) {
      position = stepChip(position, target, 8, REFERENCE_FRAME_MS).base;
      const remaining = distance(position, target);
      expect(remaining).toBeLessThanOrEqual(previous + 1e-9);
      previous = remaining;
    }
  });

  it("reports arrival and parks the chip exactly on target", () => {
    const target = at(0, 0.9, 0);
    let position = at(0.005, 0.9, 0);
    const step = stepChip(position, target, 4, REFERENCE_FRAME_MS);
    expect(step.arrived).toBe(true);
    // Exactly, not nearly: a landed chip with a residual arc sits above the
    // felt, and the pile it joins would have one chip floating in it.
    expect(step.position).toEqual(target);
    position = step.position;
    expect(distance(position, target)).toBe(0);
  });

  it("lifts the chip off the felt mid-flight and sets it back down", () => {
    expect(arcHeight(0)).toBeCloseTo(0, 12);
    expect(arcHeight(1)).toBeCloseTo(0, 12);
    expect(arcHeight(0.5)).toBeCloseTo(CHIP_ARC_PEAK, 12);
    // Monotonic up then down, so a chip never bobs. Stepped over integer
    // tenths rather than accumulating 0.05 in a float, which lands a hair
    // under 0.5 and straddles the peak.
    for (let step = 0; step < 5; step += 1) {
      expect(arcHeight((step + 1) / 10)).toBeGreaterThan(arcHeight(step / 10));
    }
    for (let step = 5; step < 10; step += 1) {
      expect(arcHeight((step + 1) / 10)).toBeLessThan(arcHeight(step / 10));
    }
  });

  it("clamps the arc rather than inverting it on out-of-range progress", () => {
    expect(arcHeight(-2)).toBeCloseTo(0, 12);
    expect(arcHeight(4)).toBeCloseTo(0, 12);
  });

  it("reads progress off the geometry, so it needs no clock", () => {
    expect(flightProgress(at(10, 0, 0), at(0, 0, 0), 10)).toBeCloseTo(0, 9);
    expect(flightProgress(at(5, 0, 0), at(0, 0, 0), 10)).toBeCloseTo(0.5, 9);
    expect(flightProgress(at(0, 0, 0), at(0, 0, 0), 10)).toBeCloseTo(1, 9);
    // A zero-length flight is finished, not a division by zero.
    expect(flightProgress(at(0, 0, 0), at(0, 0, 0), 0)).toBe(1);
  });

  it("does nothing on a zero or negative delta", () => {
    expect(lerpFactorForDelta(0)).toBe(0);
    expect(lerpFactorForDelta(-16)).toBe(0);
    expect(lerp(3, 9, 0)).toBe(3);
  });
});

/**
 * The keyframe-less counterpart of the CSS celebration budget in
 * `app/styles/stylesheets.test.ts`. A friction slide has no declared
 * duration, so the only way to hold it to `NEXT_HAND_DELAY_MS` is to solve
 * for one -- otherwise the pot could quietly still be in the air when the
 * next hand is dealt, and the symptom would just be that the felt looked
 * busy.
 */
describe("the pot reaches its winner before the next hand is dealt", () => {
  /**
   * The longest journey on the table: the pot at the centre out to the far
   * rail's seat, which is where the chips have furthest to go.
   */
  const LONGEST_FLIGHT = 12;

  it("solves a real duration for an asymptotic slide", () => {
    const duration = flightDurationMs(LONGEST_FLIGHT);
    expect(duration).toBeGreaterThan(0);
    expect(Number.isFinite(duration)).toBe(true);
    // Sanity-check the closed form against actually running the loop.
    let position = at(LONGEST_FLIGHT, 0, 0);
    let frames = 0;
    while (distance(position, at(0, 0, 0)) > CHIP_SETTLE_EPSILON && frames < 5_000) {
      position = stepChip(position, at(0, 0, 0), LONGEST_FLIGHT, REFERENCE_FRAME_MS).base;
      frames += 1;
    }
    expect(Math.abs(frames * REFERENCE_FRAME_MS - duration)).toBeLessThan(2 * REFERENCE_FRAME_MS);
  });

  it("fits inside the wait, with a visible beat left over", () => {
    const lastChipLeaves = (FUNNEL_CHIP_COUNT - 1) * FUNNEL_CHIP_STAGGER_MS;
    const endsAtMs = lastChipLeaves + flightDurationMs(LONGEST_FLIGHT);
    expect(endsAtMs).toBeLessThanOrEqual(NEXT_HAND_DELAY_MS);
    // The same 300ms breathing room the CSS budget insists on, so the two
    // halves of the celebration are held to one standard.
    expect(NEXT_HAND_DELAY_MS - endsAtMs).toBeGreaterThanOrEqual(300);
  });

  it("returns zero for a chip that is already there", () => {
    expect(flightDurationMs(0)).toBe(0);
    expect(flightDurationMs(CHIP_SETTLE_EPSILON / 2)).toBe(0);
  });

  /**
   * The budget above is solved from FUNNEL_CHIP_COUNT chips at
   * FUNNEL_CHIP_STAGGER_MS apart. That arithmetic only holds if no payout,
   * for any amount at any blind level, ever flies more chips than that --
   * which is exactly what the value-based spray's cap promises.
   */
  it("never sprays more chips than the budget was solved for", () => {
    for (const [amount, bigBlind] of [[1, 100], [1_000, 10], [250_000, 10], [999_999_999, 1]]) {
      expect(funnelSprayDenominations(amount, bigBlind).length).toBeLessThanOrEqual(FUNNEL_CHIP_COUNT);
    }
  });
});

/**
 * The spray *is* the number now: a bet or payout flies the same greedy
 * denomination breakdown the pile is built from, so both ends of every
 * flight agree about what the money looks like.
 */
describe("value-based sprays", () => {
  it("breaks an amount down exactly as the pile does", () => {
    // 131 big blinds: one 100, one 25, one 5, one 1 -- returned
    // smallest-first, which is the order the chips leave in.
    expect(sprayDenominations(1310, 10, 24)).toEqual([1, 5, 25, 100]);
  });

  it("flies one white chip for a minimum call, not a decorative three", () => {
    expect(betSprayDenominations(10, 10)).toEqual([1]);
  });

  it("keeps the largest chips when the cap truncates", () => {
    // 6x100 + 6x25 + 6x5 + 6x1 wanted; a cap of 3 must keep the hundreds
    // and drop from the small end -- the cut a dealer would make.
    const spray = sprayDenominations(7_560, 10, 3);
    expect(spray).toEqual([100, 100, 100]);
  });

  it("caps a bet spray at its own maximum", () => {
    const spray = betSprayDenominations(999_999_999, 1);
    expect(spray.length).toBe(BET_SPRAY_MAX_CHIPS);
  });

  it("lands the big denominations last, on top", () => {
    const spray = sprayDenominations(1_310, 10, 24);
    for (let index = 1; index < spray.length; index += 1) {
      expect(spray[index]).toBeGreaterThanOrEqual(spray[index - 1]);
    }
  });

  it("shows at least one chip for any positive amount, like the pile", () => {
    expect(funnelSprayDenominations(3, 10)).toEqual([1]);
  });

  it("is empty only for inputs the pile would also show nothing for", () => {
    expect(betSprayDenominations(0, 10)).toEqual([]);
    expect(betSprayDenominations(-50, 10)).toEqual([]);
    expect(betSprayDenominations(100, 0)).toEqual([]);
    expect(funnelSprayDenominations(Number.NaN, 10)).toEqual([]);
  });

  it("only ever wears the four real denominations", () => {
    const spray = sprayDenominations(123_456, 7, 24);
    for (const denomination of spray) {
      expect(POT_CHIP_DENOMINATIONS_BB).toContain(denomination);
    }
  });
});

describe("chip colours", () => {
  it("has a palette for every denomination a pot breaks into", () => {
    for (const denomination of POT_CHIP_DENOMINATIONS_BB) {
      expect(CHIP_PALETTE[denomination]).toBeDefined();
    }
    expect(Object.keys(CHIP_PALETTE).map(Number).sort((a, b) => b - a))
      .toEqual([...POT_CHIP_DENOMINATIONS_BB]);
  });

  it("falls back rather than rendering an untextured chip", () => {
    expect(chipPalette(7)).toEqual(CHIP_PALETTE[1]);
  });

  it("draws decorative sprays from the same four real denominations", () => {
    const used = new Set(Array.from({ length: 12 }, (_, i) => decorativeDenomination(i)));
    expect([...used].sort((a, b) => b - a)).toEqual([...POT_CHIP_DENOMINATIONS_BB]);
  });
});

describe("settle jitter", () => {
  it("is stable for the same chip, because the pile is rebuilt constantly", () => {
    // The pile re-renders on every snapshot a bet arrives. A chip that has
    // already settled must be handed the identical offset or it visibly
    // twitches on refetches that had nothing to do with it.
    for (let index = 0; index < 6; index += 1) {
      expect(chipSettleJitter(25, index)).toEqual(chipSettleJitter(25, index));
    }
  });

  it("actually scatters, and stays small enough to still read as a stack", () => {
    const offsets = Array.from({ length: 6 }, (_, i) => chipSettleJitter(5, i));
    expect(new Set(offsets.map((o) => `${o.x},${o.z}`)).size).toBeGreaterThan(1);
    for (const offset of offsets) {
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(offset.z)).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("the clocked glide (neat slide)", () => {
  const from = at(-6, 0.94, 3);
  const target = at(2, 0.94, -1);

  it("is the cubic ease-out it claims: fast off the line, a heavy stop", () => {
    expect(cubicEaseOut(0)).toBe(0);
    expect(cubicEaseOut(1)).toBe(1);
    expect(cubicEaseOut(0.5)).toBeCloseTo(1 - Math.pow(0.5, 3), 12);
    // First half covers far more ground than the second: the heavy stop.
    expect(cubicEaseOut(0.5)).toBeGreaterThan(0.8);
    // Clamped: a glide asked about before its start or past its end never
    // extrapolates.
    expect(cubicEaseOut(-1)).toBe(0);
    expect(cubicEaseOut(2)).toBe(1);
  });

  it("parks exactly on target at the duration — the loop always sleeps", () => {
    const done = stepGlideChip(from, target, 520, 520);
    expect(done.arrived).toBe(true);
    expect(done.position).toEqual(target);
    const overshoot = stepGlideChip(from, target, 9_999, 520);
    expect(overshoot.position).toEqual(target);
  });

  it("moves every axis on one eased clock, so a pillar cannot shear", () => {
    const mid = stepGlideChip(from, target, 260, 520);
    const eased = cubicEaseOut(0.5);
    expect(mid.arrived).toBe(false);
    expect(mid.position.x).toBeCloseTo(from.x + (target.x - from.x) * eased, 12);
    expect(mid.position.z).toBeCloseTo(from.z + (target.z - from.z) * eased, 12);
    // No arc: a neat slide stays on the cloth the whole way.
    expect(mid.position.y).toBeCloseTo(from.y, 12);
  });

  it("treats a degenerate duration as already arrived", () => {
    expect(stepGlideChip(from, target, 0, 0).arrived).toBe(true);
  });
});

describe("the splash arc override", () => {
  it("flies a taller parabola when asked, without touching the default", () => {
    const start = at(-6, 0.94, 3);
    const target = at(2, 0.94, -1);
    const gap = distance(start, target);
    const tall = stepChip(start, target, gap, 400, CHIP_LERP_PER_FRAME, 3);
    const stock = stepChip(start, target, gap, 400);
    expect(tall.base).toEqual(stock.base);
    expect(tall.position.y).toBeGreaterThan(stock.position.y);
  });
});

describe("palette shading", () => {
  it("derives lighter and darker steps from one base colour, clamped", () => {
    expect(shadeHex(0x808080, 0)).toBe(0x808080);
    expect(shadeHex(0x808080, 1)).toBe(0xffffff);
    expect(shadeHex(0x808080, -1)).toBe(0x000000);
    expect(shadeHex(0xffffff, 5)).toBe(0xffffff);
    expect(shadeHex(0x000000, -5)).toBe(0x000000);
    // Direction, per channel: positive lightens, negative darkens.
    const lighter = shadeHex(0xbe3538, 0.2);
    const darker = shadeHex(0xbe3538, -0.2);
    expect(lighter).toBeGreaterThan(0xbe3538);
    expect(darker).toBeLessThan(0xbe3538);
  });
});
