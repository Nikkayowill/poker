import { describe, expect, it } from "vitest";

import {
  FRENZY_COMBO_BREAK_MS,
  FRENZY_EMBER_MIN_HEAT,
  FRENZY_OVERLAY_MAX_ALPHA,
  FRENZY_PULSE_MIN_HEAT,
  FRENZY_TIERS,
  FarmFrenzyManager,
  frenzyBonusYield,
  frenzyEmberCount,
  frenzyOverlayAlpha,
  frenzyOverlayColor,
  frenzyPulseScale,
  tierForHeat,
} from "./frenzy";

describe("tierForHeat", () => {
  it("is cold at zero heat", () => {
    expect(tierForHeat(0).tier).toBe("cold");
  });

  it("picks the last rung whose threshold is met, boundary inclusive", () => {
    for (const def of FRENZY_TIERS) {
      expect(tierForHeat(def.minHeat).tier).toBe(def.tier);
    }
  });

  it("never returns past overdrive at heat 1", () => {
    expect(tierForHeat(1).tier).toBe("overdrive");
  });
});

describe("FarmFrenzyManager", () => {
  it("starts fully cold with no combo", () => {
    const frenzy = new FarmFrenzyManager();
    const snapshot = frenzy.sample(0);
    expect(snapshot.heat).toBe(0);
    expect(snapshot.streak).toBe(0);
    expect(snapshot.tier.tier).toBe("cold");
  });

  it("a single hit raises heat but does not reach warm on its own", () => {
    const frenzy = new FarmFrenzyManager();
    const snapshot = frenzy.registerHit(0);
    expect(snapshot.heat).toBeGreaterThan(0);
    expect(snapshot.heat).toBeLessThan(FRENZY_TIERS[1].minHeat);
    expect(snapshot.streak).toBe(1);
  });

  it("rapid hits climb the tier ladder as the streak grows", () => {
    const frenzy = new FarmFrenzyManager();
    let snapshot = frenzy.registerHit(0);
    for (let i = 1; i < 12; i += 1) {
      // Well inside the combo window every time.
      snapshot = frenzy.registerHit(i * 100);
    }
    expect(snapshot.streak).toBe(12);
    expect(snapshot.heat).toBeGreaterThanOrEqual(FRENZY_TIERS[3].minHeat);
  });

  it("heat never exceeds 1 no matter how long the streak runs", () => {
    const frenzy = new FarmFrenzyManager();
    let snapshot = frenzy.registerHit(0);
    for (let i = 1; i < 60; i += 1) {
      snapshot = frenzy.registerHit(i * 50);
    }
    expect(snapshot.heat).toBe(1);
  });

  it("a gap longer than the combo window resets the streak to 1", () => {
    const frenzy = new FarmFrenzyManager();
    frenzy.registerHit(0);
    const snapshot = frenzy.registerHit(FRENZY_COMBO_BREAK_MS + 1);
    expect(snapshot.streak).toBe(1);
  });

  it("holds heat steady through the decay grace window", () => {
    const frenzy = new FarmFrenzyManager();
    const hit = frenzy.registerHit(0);
    const held = frenzy.sample(100);
    expect(held.heat).toBe(hit.heat);
  });

  it("decays heat to zero, and clears the streak once it fully cools", () => {
    const frenzy = new FarmFrenzyManager();
    frenzy.registerHit(0);
    frenzy.registerHit(50);
    const cooled = frenzy.sample(100_000);
    expect(cooled.heat).toBe(0);
    expect(cooled.streak).toBe(0);
    expect(cooled.tier.tier).toBe("cold");
  });

  it("does not mutate its own state on a read-only sample", () => {
    const frenzy = new FarmFrenzyManager();
    frenzy.registerHit(0);
    const before = frenzy.sample(50);
    const again = frenzy.sample(50);
    expect(again).toEqual(before);
  });

  it("treats a clock that moved backwards as a fresh, cold combo", () => {
    const frenzy = new FarmFrenzyManager();
    frenzy.registerHit(10_000);
    // A hard scene restart resets Phaser's own time.now to something small.
    const snapshot = frenzy.registerHit(0);
    expect(snapshot.streak).toBe(1);
    expect(snapshot.heat).toBeCloseTo(0.11, 5);
  });

  it("reset clears heat and streak outright", () => {
    const frenzy = new FarmFrenzyManager();
    frenzy.registerHit(0);
    frenzy.registerHit(50);
    frenzy.reset();
    const snapshot = frenzy.sample(50);
    expect(snapshot.heat).toBe(0);
    expect(snapshot.streak).toBe(0);
  });
});

describe("frenzyBonusYield", () => {
  it("is zero at the cold tier, whatever the base yield", () => {
    expect(frenzyBonusYield(1000, FRENZY_TIERS[0])).toBe(0);
  });

  it("is zero for a non-positive base yield at any tier", () => {
    expect(frenzyBonusYield(0, FRENZY_TIERS[4])).toBe(0);
    expect(frenzyBonusYield(-5, FRENZY_TIERS[4])).toBe(0);
  });

  it("scales by the tier's own yieldMultiplier, rounded to whole Gold", () => {
    const hot = FRENZY_TIERS.find((tier) => tier.tier === "hot")!;
    expect(frenzyBonusYield(100, hot)).toBe(Math.round(100 * (hot.yieldMultiplier - 1)));
  });
});

describe("frenzyOverlayAlpha", () => {
  it("is zero at zero heat and capped at FRENZY_OVERLAY_MAX_ALPHA at heat 1", () => {
    expect(frenzyOverlayAlpha(0)).toBe(0);
    expect(frenzyOverlayAlpha(1)).toBeCloseTo(FRENZY_OVERLAY_MAX_ALPHA, 10);
  });

  it("is quadratic: half heat is a quarter of the ceiling alpha", () => {
    expect(frenzyOverlayAlpha(0.5)).toBeCloseTo(FRENZY_OVERLAY_MAX_ALPHA * 0.25, 10);
  });

  it("clamps out-of-range heat rather than producing a negative or >ceiling alpha", () => {
    expect(frenzyOverlayAlpha(-1)).toBe(0);
    expect(frenzyOverlayAlpha(2)).toBeCloseTo(FRENZY_OVERLAY_MAX_ALPHA, 10);
  });
});

describe("frenzyOverlayColor", () => {
  it("is pure white at zero heat", () => {
    expect(frenzyOverlayColor(0)).toBe(0xffffff);
  });

  it("lands on the hot orange ceiling at heat 1", () => {
    expect(frenzyOverlayColor(1)).toBe(0xff3f17);
  });
});

describe("frenzyPulseScale", () => {
  it("never pulses below FRENZY_PULSE_MIN_HEAT", () => {
    expect(frenzyPulseScale(FRENZY_PULSE_MIN_HEAT - 0.01, 12345)).toBe(1);
  });

  it("oscillates around 1 once past the pulse floor", () => {
    const values = [0, 50, 100, 150, 200, 300, 450].map((t) => frenzyPulseScale(1, t));
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.min(...values)).toBeLessThan(1);
  });

  it("is exactly 1 at elapsed 0, since sine(0) is 0", () => {
    expect(frenzyPulseScale(1, 0)).toBe(1);
  });
});

describe("frenzyEmberCount", () => {
  it("is zero below the ember floor", () => {
    expect(frenzyEmberCount(FRENZY_EMBER_MIN_HEAT - 0.01)).toBe(0);
  });

  it("grows from a handful at the floor to a shower at heat 1", () => {
    const atFloor = frenzyEmberCount(FRENZY_EMBER_MIN_HEAT);
    const atMax = frenzyEmberCount(1);
    expect(atFloor).toBeGreaterThan(0);
    expect(atMax).toBeGreaterThan(atFloor);
  });

  it("clamps heat above 1 to the same count as heat 1", () => {
    expect(frenzyEmberCount(2)).toBe(frenzyEmberCount(1));
  });
});
