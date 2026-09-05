import { describe, expect, it } from "vitest";
import {
  RAIN_STREAK_MAX,
  SOLAR_DUST_MAX,
  STACKACRES_WEATHER_DEFS,
  STACKACRES_WEATHER_STATES,
  StackAcresWeather,
  WEATHER_MIN_HOLD_MS,
  WEATHER_TINT_TRANSITION_MS,
  applyWeatherModifiers,
  initialWeatherState,
  interpolateWeatherTint,
  packWeatherTint,
  rainStreakField,
  solarDustAlpha,
  solarDustField,
  stepWeather,
  type WeatherSessionState,
} from "./weather";
import type { WorldRect } from "./world";

const AREA: WorldRect = { x: -100, y: -50, width: 400, height: 300 };

/** A deterministic stand-in for the scene's own seeded generator. */
function cycle(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("applyWeatherModifiers", () => {
  it("is a no-op under CLEAR", () => {
    const result = applyWeatherModifiers(1000, StackAcresWeather.CLEAR);
    expect(result.adjustedYield).toBe(1000);
    expect(result.critChanceBonus).toBe(0);
    expect(result.upkeepCeilingDelta).toBe(0);
    expect(result.autoCollect).toBe(false);
  });

  it("SOLAR_FLARE docks 5% off the yield and adds a crit bonus", () => {
    const result = applyWeatherModifiers(1000, StackAcresWeather.SOLAR_FLARE);
    expect(result.adjustedYield).toBeCloseTo(950, 6);
    expect(result.critChanceBonus).toBeCloseTo(0.1, 6);
  });

  it("GOLD_RUSH_RAIN signals auto-collect and leaves yield/crit untouched", () => {
    const result = applyWeatherModifiers(1000, StackAcresWeather.GOLD_RUSH_RAIN);
    expect(result.autoCollect).toBe(true);
    expect(result.adjustedYield).toBe(1000);
    expect(result.critChanceBonus).toBe(0);
  });

  it("DRY_SPELL computes a ceiling delta but never applies it to the yield", () => {
    const result = applyWeatherModifiers(1000, StackAcresWeather.DRY_SPELL);
    // The whole point: this number is reported, not spent. Nothing in this
    // module (or its caller, by construction -- there is no ceiling constant
    // imported here) can feed it into a real settlement.
    expect(result.upkeepCeilingDelta).toBe(-2_000);
    expect(result.adjustedYield).toBe(1000);
  });

  it("never returns a negative yield, even from a negative or NaN input", () => {
    expect(applyWeatherModifiers(-50, StackAcresWeather.SOLAR_FLARE).adjustedYield).toBe(0);
    expect(applyWeatherModifiers(NaN, StackAcresWeather.SOLAR_FLARE).adjustedYield).toBe(0);
  });

  it("falls back to CLEAR for an unrecognized state rather than throwing", () => {
    const bogus = "storm" as StackAcresWeather;
    expect(() => applyWeatherModifiers(500, bogus)).not.toThrow();
    expect(applyWeatherModifiers(500, bogus).adjustedYield).toBe(500);
  });

  it("every registered state has a def", () => {
    for (const state of STACKACRES_WEATHER_STATES) {
      expect(STACKACRES_WEATHER_DEFS[state]).toBeDefined();
    }
  });
});

describe("stepWeather", () => {
  it("stays CLEAR before the minimum hold, no matter what the roll says", () => {
    let state: WeatherSessionState = initialWeatherState();
    const alwaysShifts = () => 0; // below any shift chance -- would always win a roll
    for (let i = 0; i < 50; i += 1) {
      state = stepWeather(state, 100, alwaysShifts);
    }
    expect(state.heldMs).toBeLessThan(WEATHER_MIN_HOLD_MS);
    expect(state.active).toBe(StackAcresWeather.CLEAR);
  });

  it("shifts to a different state once past the hold, on a winning roll", () => {
    const state: WeatherSessionState = { active: StackAcresWeather.CLEAR, heldMs: WEATHER_MIN_HOLD_MS };
    const winThenPick = cycle([0, 0.9]); // wins the shift chance, then picks late in the pool
    const next = stepWeather(state, 16, winThenPick);
    expect(next.active).not.toBe(StackAcresWeather.CLEAR);
    expect(next.heldMs).toBe(0);
  });

  it("never re-selects the state it just held", () => {
    const random = cycle([0, 0.999999]);
    let state: WeatherSessionState = { active: StackAcresWeather.SOLAR_FLARE, heldMs: WEATHER_MIN_HOLD_MS };
    state = stepWeather(state, 16, random);
    expect(state.active).not.toBe(StackAcresWeather.SOLAR_FLARE);
  });

  it("clamps a huge delta (e.g. a backgrounded tab) to one step, not an instant multi-cross", () => {
    // A single call with a multi-minute delta must not itself both cross the
    // hold window and win a roll off one uninterrupted jump.
    let state: WeatherSessionState = initialWeatherState();
    state = stepWeather(state, 10 * 60 * 1000, () => 0);
    expect(state.heldMs).toBeLessThan(WEATHER_MIN_HOLD_MS);
  });
});

describe("interpolateWeatherTint / packWeatherTint", () => {
  it("starts at the 'from' state and ends at the 'to' state", () => {
    const start = interpolateWeatherTint(StackAcresWeather.CLEAR, StackAcresWeather.DRY_SPELL, 0);
    const end = interpolateWeatherTint(StackAcresWeather.CLEAR, StackAcresWeather.DRY_SPELL, WEATHER_TINT_TRANSITION_MS);
    expect(start.intensity).toBe(0);
    expect(end.intensity).toBeGreaterThan(0);
  });

  it("clamps past the end of the transition rather than overshooting", () => {
    const end = interpolateWeatherTint(StackAcresWeather.CLEAR, StackAcresWeather.SOLAR_FLARE, WEATHER_TINT_TRANSITION_MS);
    const past = interpolateWeatherTint(StackAcresWeather.CLEAR, StackAcresWeather.SOLAR_FLARE, WEATHER_TINT_TRANSITION_MS * 5);
    expect(past).toEqual(end);
  });

  it("packs into a valid 24-bit color for every state pair", () => {
    for (const from of STACKACRES_WEATHER_STATES) {
      for (const to of STACKACRES_WEATHER_STATES) {
        const packed = packWeatherTint(interpolateWeatherTint(from, to, WEATHER_TINT_TRANSITION_MS / 2));
        expect(packed).toBeGreaterThanOrEqual(0);
        expect(packed).toBeLessThanOrEqual(0xffffff);
      }
    }
  });
});

describe("solarDustField", () => {
  it("never grows past SOLAR_DUST_MAX", () => {
    let live: ReturnType<typeof solarDustField> = [];
    const random = cycle([0.1, 0.4, 0.7, 0.9]);
    for (let i = 0; i < 200; i += 1) {
      live = solarDustField(live, AREA, 33, random);
      expect(live.length).toBeLessThanOrEqual(SOLAR_DUST_MAX);
    }
    expect(live.length).toBe(SOLAR_DUST_MAX);
  });

  it("alpha rises then falls back toward zero over a mote's life", () => {
    const mote = { x: 0, y: 0, ageMs: 0, lifeMs: 2000 };
    const start = solarDustAlpha(mote);
    const mid = solarDustAlpha({ ...mote, ageMs: 1000 });
    const end = solarDustAlpha({ ...mote, ageMs: 1999 });
    expect(mid).toBeGreaterThan(start);
    expect(end).toBeLessThan(mid);
  });
});

describe("rainStreakField", () => {
  it("never grows past RAIN_STREAK_MAX and stays in screen-fraction space", () => {
    let live: ReturnType<typeof rainStreakField> = [];
    const random = cycle([0.2, 0.5, 0.8]);
    for (let i = 0; i < 300; i += 1) {
      live = rainStreakField(live, 33, random);
      expect(live.length).toBeLessThanOrEqual(RAIN_STREAK_MAX);
      for (const streak of live) {
        expect(streak.x).toBeGreaterThanOrEqual(0);
        expect(streak.x).toBeLessThanOrEqual(1);
      }
    }
    expect(live.length).toBe(RAIN_STREAK_MAX);
  });

  it("wraps a streak back above the frame once it falls past the bottom", () => {
    const random = () => 0.5;
    const live = [{ x: 0.5, y: 1.05 }];
    const next = rainStreakField(live, 100, random);
    // At this speed a 100ms step pushes y past 1.1, so it must have wrapped
    // rather than continuing to fall unbounded.
    expect(next[0]!.y).toBeLessThan(0);
  });
});
