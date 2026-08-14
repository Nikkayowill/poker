import { describe, expect, it } from "vitest";
import {
  ARC_FRACTION,
  arcLift,
  deformation,
  FEEL_PUSH,
  FEEL_SETTLE,
  FEEL_THROW,
  flightDrift,
  flightRoll,
  hasLanded,
  MOTION,
  SQUASH_AMOUNT,
  springCurve,
  squashWindowMs,
  sprayDurationMs,
  type ChipMoveKind,
} from "./chip-motion";
import { flightVariance } from "./chip-spec";

const FEELS = [FEEL_SETTLE, FEEL_THROW, FEEL_PUSH];

/** The longest journey on the table, in CSS pixels. Sets the error budget. */
const LONGEST_FLIGHT_PX = 500;

describe("the spring curve", () => {
  it("starts from rest and accelerates — which is the whole reason it exists", () => {
    // The two curves this replaces both leave at their fastest: an exponential
    // friction slide and a cubic ease-out. Nothing that leaves at full speed
    // has a wrist behind it, so nothing has weight.
    const cubicEaseOut = (t: number) => 1 - Math.pow(1 - t, 3);
    for (const feel of FEELS) {
      expect(springCurve(0, feel)).toBe(0);
      // Genuinely from rest: the opening displacement is an order of
      // magnitude under the ease-out's, which leaves at full speed.
      expect(springCurve(0.001, feel)).toBeLessThan(cubicEaseOut(0.001) / 10);
      // And genuinely accelerating: the second interval covers more ground
      // than the first, which no decaying curve can do.
      const first = springCurve(0.05, feel) - springCurve(0, feel);
      const second = springCurve(0.1, feel) - springCurve(0.05, feel);
      expect(second).toBeGreaterThan(first);
    }
  });

  it("overshoots by exactly the amount the preset asks for", () => {
    // Not approximately: omega is solved from the requested overshoot, so a
    // designer asking for 8% past the mark gets 8% past the mark.
    for (const feel of FEELS) {
      let peak = 0;
      for (let step = 0; step <= 2000; step += 1) peak = Math.max(peak, springCurve(step / 2000, feel));
      expect(peak - 1).toBeCloseTo(feel.overshoot, 3);
    }
  });

  it("settles back onto the target after the overshoot", () => {
    // The settle is the event that says an object with mass came to rest
    // against cloth. Without it the overshoot is just a miss.
    for (const feel of FEELS) {
      let peakAt = 0;
      let peak = 0;
      for (let step = 0; step <= 2000; step += 1) {
        const value = springCurve(step / 2000, feel);
        if (value > peak) { peak = value; peakAt = step / 2000; }
      }
      expect(peakAt).toBeGreaterThan(0.2);
      expect(peakAt).toBeLessThan(0.7);
      // Recovered well before the clock runs out.
      expect(Math.abs(springCurve(0.9, feel) - 1)).toBeLessThan(0.02);
    }
  });

  it("terminates exactly, so the render loop can go back to sleep", () => {
    // A numerically integrated spring is asymptotic: it can only be *declared*
    // arrived by an epsilon, which is both the "nothing ever lands" failure
    // one layer down and a tail of sub-pixel frames the demand loop cannot
    // sleep through. The snap here has to be invisible for that to be free.
    for (const feel of FEELS) {
      expect(springCurve(1, feel)).toBe(1);
      expect(springCurve(1.5, feel)).toBe(1);
      const residual = Math.abs(1 - springCurve(0.9999, feel));
      expect(residual * LONGEST_FLIGHT_PX).toBeLessThan(0.5);
    }
  });

  it("keeps the long hauls from sailing off the back of the felt", () => {
    // Six per cent past the pot is a large absolute distance on the two
    // longest journeys at the table; three is a few pixels.
    expect(FEEL_PUSH.overshoot).toBeLessThan(FEEL_SETTLE.overshoot);
    expect(FEEL_THROW.overshoot).toBeGreaterThan(FEEL_SETTLE.overshoot);
  });

  it("is safe against a nonsense clock", () => {
    for (const feel of FEELS) {
      expect(springCurve(Number.NaN, feel)).toBe(0);
      expect(springCurve(-1, feel)).toBe(0);
    }
  });
});

describe("the throw arc", () => {
  it("is zero on the cloth at both ends, so a landed chip needs no parking", () => {
    expect(arcLift(0)).toBe(0);
    expect(arcLift(ARC_FRACTION)).toBe(0);
    expect(arcLift(1)).toBe(0);
  });

  it("peaks before the midpoint — thrown by a hand, not fired from a cannon", () => {
    let peakAt = 0;
    let peak = 0;
    for (let step = 0; step <= 1000; step += 1) {
      const t = step / 1000;
      const lift = arcLift(t);
      if (lift > peak) { peak = lift; peakAt = t; }
    }
    expect(peak).toBeCloseTo(1, 2);
    expect(peakAt / ARC_FRACTION).toBeGreaterThan(0.35);
    expect(peakAt / ARC_FRACTION).toBeLessThan(0.5);
  });

  it("lands the chip before the trip is over, so it skids into place", () => {
    expect(ARC_FRACTION).toBeLessThan(1);
    expect(hasLanded(ARC_FRACTION - 0.01)).toBe(false);
    expect(hasLanded(ARC_FRACTION)).toBe(true);
  });
});

describe("squash and stretch", () => {
  it("leaves a chip alone at rest", () => {
    expect(deformation(0)).toEqual({ scaleX: 1, scaleY: 1 });
    expect(deformation(1)).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it("stretches on release and squashes on impact", () => {
    const launch = deformation(0.06);
    expect(launch.scaleX).toBeLessThan(1);
    expect(launch.scaleY).toBeGreaterThan(1);

    const impact = deformation(ARC_FRACTION + 0.03);
    expect(impact.scaleX).toBeGreaterThan(1);
    expect(impact.scaleY).toBeLessThan(1);
  });

  it("conserves the chip's apparent area, which is what makes it read as elastic", () => {
    for (let step = 0; step <= 100; step += 1) {
      const { scaleX, scaleY } = deformation(step / 100);
      expect(scaleX * scaleY).toBeCloseTo(1, 2);
    }
  });

  it("never deforms past the amount it declares", () => {
    for (let step = 0; step <= 400; step += 1) {
      const { scaleX, scaleY } = deformation(step / 400);
      expect(Math.abs(scaleX - 1)).toBeLessThanOrEqual(SQUASH_AMOUNT + 1e-9);
      expect(Math.abs(scaleY - 1)).toBeLessThanOrEqual(SQUASH_AMOUNT + 1e-9);
    }
  });

  it("finishes recovering exactly as the chip parks", () => {
    // A fixed-millisecond squash was longer than the post-landing window of
    // every flight in the table, so the terminal snap chopped the recovery off
    // and chips arrived still visibly squashed. Tying it to the window is what
    // fixed that -- and the window has to be real time, not zero.
    for (const kind of ["call", "raise", "all_in"] as const) {
      expect(squashWindowMs(MOTION[kind].durationMs)).toBeGreaterThan(40);
    }
    expect(deformation(0.999).scaleX).toBeCloseTo(1, 3);
  });
});

describe("per-chip trajectory variation", () => {
  const variance = flightVariance(7);

  it("deviates in the middle and lands exactly where the layout said", () => {
    // A scattered trajectory is the goal; a scattered landing is a bug. The
    // layout has already decided where this chip goes.
    expect(flightDrift(0, variance).x).toBeCloseTo(0, 12);
    expect(flightDrift(0, variance).y).toBeCloseTo(0, 12);
    expect(flightDrift(1, variance).x).toBeCloseTo(0, 12);
    expect(flightDrift(1, variance).y).toBeCloseTo(0, 12);
    const middle = flightDrift(variance.driftPhase, variance);
    expect(Math.abs(middle.x)).toBeGreaterThan(0);
  });

  it("never drifts further than the chip's own budget", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const chip = flightVariance(seed);
      for (let step = 0; step <= 100; step += 1) {
        const drift = flightDrift(step / 100, chip);
        expect(Math.abs(drift.x)).toBeLessThanOrEqual(Math.abs(chip.driftXPx) + 1e-9);
        expect(Math.abs(drift.y)).toBeLessThanOrEqual(Math.abs(chip.driftYPx) + 1e-9);
      }
    }
  });

  it("tumbles through the air and hands over flat", () => {
    // A chip that landed still rotated would have to be un-rotated by
    // something, and there is nothing left to do it.
    expect(flightRoll(0, variance)).toBeCloseTo(0, 9);
    expect(flightRoll(1, variance)).toBeCloseTo(0, 9);
    expect(Math.abs(flightRoll(0.5, variance))).toBeCloseTo(Math.abs(variance.rollRad), 9);
  });

  it("gives no two chips the same trajectory", () => {
    const paths = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const chip = flightVariance(seed);
      paths.add([0.2, 0.5, 0.8].map((t) => {
        const drift = flightDrift(t, chip);
        return `${drift.x.toFixed(4)},${drift.y.toFixed(4)},${flightRoll(t, chip).toFixed(4)}`;
      }).join("|"));
    }
    expect(paths.size).toBe(20);
  });
});

describe("the timing table", () => {
  it("keeps every flight inside its band", () => {
    // Poker animations are fast or they are in the way.
    const bands: Record<ChipMoveKind, [number, number]> = {
      call: [180, 220],
      bet: [220, 280],
      raise: [280, 320],
      sweep: [300, 400],
      all_in: [550, 700],
      // Not in the brief's list; the pot going home is the sweep's sibling and
      // shares its ceiling.
      payout: [300, 400],
      // The contact of a chip settling onto the pile it is joining.
      drop: [120, 220],
    };
    for (const [kind, [low, high]] of Object.entries(bands) as Array<[ChipMoveKind, [number, number]]>) {
      expect(MOTION[kind].durationMs).toBeGreaterThanOrEqual(low);
      expect(MOTION[kind].durationMs).toBeLessThanOrEqual(high);
    }
  });

  it("orders the actions by how big a decision they are", () => {
    // The ordering carries the meaning. A call is the quickest thing at the
    // table; a shove is allowed to be a moment.
    expect(MOTION.call.durationMs).toBeLessThan(MOTION.bet.durationMs);
    expect(MOTION.bet.durationMs).toBeLessThan(MOTION.raise.durationMs);
    expect(MOTION.raise.durationMs).toBeLessThan(MOTION.all_in.durationMs);
    expect(MOTION.call.arcPeakRadii).toBeLessThan(MOTION.all_in.arcPeakRadii);
  });

  it("keeps the payout inside the next hand's delay", () => {
    // NEXT_HAND_DELAY_MS is 2,800. The celebration has to be finished before
    // the deal lands on top of it.
    expect(sprayDurationMs(12, MOTION.payout)).toBeLessThan(2800);
  });

  it("keeps the biggest spray inside the parent's 900ms flight-event window", () => {
    // poker-table.tsx recycles a bet-flight event after 900ms.
    expect(sprayDurationMs(10, MOTION.all_in)).toBeLessThan(900);
  });

  it("never arcs a drop, which is already a vertical move", () => {
    expect(MOTION.drop.arcPeakRadii).toBe(0);
  });

  it("costs nothing for an empty spray", () => {
    expect(sprayDurationMs(0, MOTION.bet)).toBe(0);
  });
});
