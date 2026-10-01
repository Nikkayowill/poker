import { describe, expect, it } from "vitest";
import { COMBO_CAP, COMBO_WINDOW_MS, comboHz, comboLabel, nextCombo } from "./combo";

describe("nextCombo", () => {
  it("starts at one", () => {
    expect(nextCombo(null, 1000)).toEqual({ count: 1, at: 1000 });
  });

  it("builds while picks land inside the window", () => {
    let state = nextCombo(null, 0);
    state = nextCombo(state, 1000);
    state = nextCombo(state, 1000 + COMBO_WINDOW_MS);
    expect(state.count).toBe(3);
  });

  it("starts over once the window has passed", () => {
    const state = nextCombo({ count: 5, at: 0 }, COMBO_WINDOW_MS + 1);
    expect(state).toEqual({ count: 1, at: COMBO_WINDOW_MS + 1 });
  });

  it("starts over if the clock goes backwards", () => {
    expect(nextCombo({ count: 4, at: 5000 }, 4000).count).toBe(1);
  });

  it("stops climbing at the cap", () => {
    let state = nextCombo(null, 0);
    for (let i = 1; i < 40; i += 1) state = nextCombo(state, i * 100);
    expect(state.count).toBe(COMBO_CAP);
  });
});

describe("comboLabel", () => {
  it("says nothing for a lone pick", () => {
    expect(comboLabel(1)).toBeNull();
    expect(comboLabel(0)).toBeNull();
    expect(comboLabel(Number.NaN)).toBeNull();
  });

  it("names the streak from two up, capped", () => {
    expect(comboLabel(2)).toBe("x2");
    expect(comboLabel(7)).toBe("x7");
    expect(comboLabel(99)).toBe(`x${COMBO_CAP}`);
  });
});

describe("comboHz", () => {
  it("rises with every pick", () => {
    for (let count = 2; count <= COMBO_CAP; count += 1) {
      expect(comboHz(count), `${count}`).toBeGreaterThan(comboHz(count - 1));
    }
  });

  it("starts at A4 and climbs an octave every five picks", () => {
    expect(comboHz(1)).toBe(440);
    expect(comboHz(6)).toBeCloseTo(880, 5);
  });

  it("never gets shrill, even at the cap", () => {
    expect(comboHz(COMBO_CAP)).toBeLessThan(2200);
  });

  it("stays sane on nonsense", () => {
    expect(comboHz(Number.NaN)).toBe(440);
    expect(comboHz(-4)).toBe(440);
  });
});
