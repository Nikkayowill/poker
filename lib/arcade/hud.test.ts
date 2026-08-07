import { describe, expect, it } from "vitest";
import {
  BIG_WIN_MULTIPLE,
  JACKPOT_MULTIPLE,
  METER_ROLL_MS,
  celebrationTier,
  formatSigned,
  isCelebration,
  meterValue,
  sessionTone,
} from "./hud";

describe("meterValue", () => {
  it("starts at the old balance and ends exactly on the new one", () => {
    expect(meterValue(1000, 2000, 0)).toBe(1000);
    expect(meterValue(1000, 2000, METER_ROLL_MS)).toBe(2000);
  });

  it("terminates rather than asymptoting -- past the duration is the target itself", () => {
    // The whole point of the exact landing: a player must never be left
    // reading 1,999 because a frame arrived a millisecond late.
    expect(meterValue(1000, 2000, METER_ROLL_MS + 1)).toBe(2000);
    expect(meterValue(1000, 2000, 10_000)).toBe(2000);
  });

  it("eases out -- it is more than half way at the half-way point", () => {
    const half = meterValue(0, 1000, METER_ROLL_MS / 2);
    expect(half).toBeGreaterThan(500);
    expect(half).toBeLessThan(1000);
  });

  it("rolls downward too", () => {
    expect(meterValue(2000, 1000, 0)).toBe(2000);
    expect(meterValue(2000, 1000, METER_ROLL_MS)).toBe(1000);
    const mid = meterValue(2000, 1000, METER_ROLL_MS / 2);
    expect(mid).toBeLessThan(2000);
    expect(mid).toBeGreaterThan(1000);
  });

  it("never leaves the interval", () => {
    for (let elapsed = 0; elapsed <= METER_ROLL_MS; elapsed += 37) {
      const value = meterValue(400, 900, elapsed);
      expect(value).toBeGreaterThanOrEqual(400);
      expect(value).toBeLessThanOrEqual(900);
    }
  });

  it("is inert on a zero duration and on non-finite ends", () => {
    expect(meterValue(10, 20, 0, 0)).toBe(20);
    expect(meterValue(Number.NaN, 20, 10)).toBe(20);
  });
});

describe("sessionTone", () => {
  it("calls zero flat, not a loss", () => {
    expect(sessionTone(0)).toBe("flat");
    expect(sessionTone(1)).toBe("up");
    expect(sessionTone(-1)).toBe("down");
  });
});

describe("formatSigned", () => {
  it("signs a gain and groups thousands", () => {
    expect(formatSigned(1200)).toBe("+1,200");
    expect(formatSigned(-500)).toBe("-500");
    expect(formatSigned(0)).toBe("0");
  });
});

describe("celebrationTier", () => {
  it("separates a push from both a loss and a win", () => {
    expect(celebrationTier(-1000, 1000)).toBe("loss");
    expect(celebrationTier(0, 1000)).toBe("push");
    expect(celebrationTier(1000, 1000)).toBe("win");
  });

  it("scales against the stake, not the absolute Gold", () => {
    // The same 5,000 is routine at one stake and a jackpot at another.
    expect(celebrationTier(5000, 5000)).toBe("win");
    expect(celebrationTier(5000, 250)).toBe("jackpot");
  });

  it("fires each tier exactly at its multiple", () => {
    const stake = 1000;
    expect(celebrationTier(stake * BIG_WIN_MULTIPLE, stake)).toBe("big-win");
    expect(celebrationTier(stake * BIG_WIN_MULTIPLE - 1, stake)).toBe("win");
    expect(celebrationTier(stake * JACKPOT_MULTIPLE, stake)).toBe("jackpot");
    expect(celebrationTier(stake * JACKPOT_MULTIPLE - 1, stake)).toBe("big-win");
  });

  it("does not divide by a zero stake into a false jackpot", () => {
    expect(celebrationTier(500, 0)).toBe("win");
    expect(celebrationTier(500, Number.NaN)).toBe("win");
  });

  it("never celebrates a push or a loss", () => {
    expect(isCelebration(celebrationTier(0, 1000))).toBe(false);
    expect(isCelebration(celebrationTier(-1000, 1000))).toBe(false);
    expect(isCelebration(celebrationTier(1000, 1000))).toBe(false);
    expect(isCelebration(celebrationTier(80_000, 1000))).toBe(true);
  });
});
