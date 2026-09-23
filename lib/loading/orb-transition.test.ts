import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachOrbLayer,
  BURST_MS,
  burstProgress,
  burstVeilAlpha,
  COVER_MS,
  coverAlpha,
  GATHER_MS,
  gatherProgress,
  MIN_HOLD_MS,
  navigateWithOrb,
  releaseOrb,
  spherePoints,
  startOrb,
} from "./orb-transition";

describe("orb timeline", () => {
  it("stays short so it never reads as a wait", () => {
    expect(MIN_HOLD_MS + BURST_MS).toBeLessThanOrEqual(600);
    expect(COVER_MS).toBeLessThan(MIN_HOLD_MS);
  });

  it("covers from clear to opaque", () => {
    expect(coverAlpha(0)).toBe(0);
    expect(coverAlpha(COVER_MS)).toBe(1);
    expect(coverAlpha(COVER_MS / 2)).toBeGreaterThan(0.5);
  });

  it("lifts the veil from wherever the cover reached", () => {
    expect(burstVeilAlpha(0, 0.6)).toBeCloseTo(0.6);
    expect(burstVeilAlpha(BURST_MS, 1)).toBeCloseTo(0);
  });

  it("lands every dot in the orb by the end of the gather", () => {
    for (const seed of [0, 0.5, 0.999]) {
      expect(gatherProgress(0, seed)).toBe(0);
      expect(gatherProgress(GATHER_MS, seed)).toBe(1);
    }
    expect(gatherProgress(GATHER_MS / 3, 0)).toBeGreaterThan(gatherProgress(GATHER_MS / 3, 0.9));
  });

  it("sends every dot out by the end of the burst", () => {
    for (const seed of [0, 0.5, 1]) expect(burstProgress(BURST_MS, seed)).toBe(1);
  });

  it("spreads sphere points on the unit sphere", () => {
    const points = spherePoints(50);
    for (let i = 0; i < 50; i++) {
      expect(Math.hypot(points[i * 3], points[i * 3 + 1], points[i * 3 + 2])).toBeCloseTo(1);
    }
  });
});

describe("orb controller", () => {
  let detach: (() => void) | null = null;
  afterEach(() => detach?.());

  it("does nothing without a layer", () => {
    const go = vi.fn();
    navigateWithOrb(go);
    releaseOrb();
    expect(go).toHaveBeenCalledOnce();
  });

  it("starts the orb and navigates on the same tick", () => {
    const layer = vi.fn();
    detach = attachOrbLayer(layer);
    const go = vi.fn(() => expect(layer).toHaveBeenCalledWith("start"));
    navigateWithOrb(go);
    expect(go).toHaveBeenCalledOnce();
    startOrb();
    releaseOrb();
    expect(layer).toHaveBeenLastCalledWith("release");
  });
});
