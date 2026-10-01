import { describe, expect, it } from "vitest";
import {
  createSwingGaugeState,
  resolveSwingTap,
  stepSwingGauge,
  swingGaugeProfile,
} from "./swing-gauge";

describe("createSwingGaugeState", () => {
  it("starts at the bottom of the track, heading up, unresolved", () => {
    const state = createSwingGaugeState("mine");
    expect(state.position).toBe(0);
    expect(state.direction).toBe(1);
    expect(state.resolved).toBeNull();
  });
});

describe("stepSwingGauge", () => {
  it("advances the marker toward the top of the track", () => {
    const state = stepSwingGauge(createSwingGaugeState("mine"), 100);
    expect(state.position).toBeGreaterThan(0);
    expect(state.position).toBeLessThanOrEqual(1);
  });

  it("bounces back down after reaching the top", () => {
    let state = createSwingGaugeState("mine");
    // Enough frames to cross the whole track and bounce at least once.
    for (let i = 0; i < 40; i += 1) state = stepSwingGauge(state, 100);
    expect(state.position).toBeGreaterThanOrEqual(0);
    expect(state.position).toBeLessThanOrEqual(1);
  });

  it("is inert once resolved", () => {
    const resolved = resolveSwingTap(createSwingGaugeState("mine"));
    const stepped = stepSwingGauge(resolved, 500);
    expect(stepped).toEqual(resolved);
  });
});

describe("resolveSwingTap", () => {
  it("grades a tap inside the sweet zone as sweet", () => {
    const profile = swingGaugeProfile("mine");
    const midSweet = (profile.sweetZone[0] + profile.sweetZone[1]) / 2;
    const state = { kind: "mine" as const, position: midSweet, direction: 1 as const, resolved: null };
    expect(resolveSwingTap(state).resolved).toBe("sweet");
  });

  it("grades a tap outside the sweet zone as a plain hit, never a miss", () => {
    const state = { kind: "mine" as const, position: 0, direction: 1 as const, resolved: null };
    expect(resolveSwingTap(state).resolved).toBe("hit");
  });

  it("is idempotent: a second tap keeps the first grade", () => {
    const first = resolveSwingTap({ kind: "mine" as const, position: 0.5, direction: 1 as const, resolved: null });
    const second = resolveSwingTap({ ...first, position: 0.99 });
    expect(second.resolved).toBe(first.resolved);
  });
});
