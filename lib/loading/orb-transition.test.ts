import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachOrbLayer,
  COIN_COUNT,
  coinEnterProgress,
  coinExitProgress,
  COVER_MS,
  coverAlpha,
  ENTER_MS,
  EXIT_MS,
  exitVeilAlpha,
  MIN_HOLD_MS,
  navigateWithOrb,
  releaseOrb,
  startOrb,
} from "./orb-transition";

describe("orb timeline", () => {
  it("stays under a second on a cached page", () => {
    expect(MIN_HOLD_MS + EXIT_MS).toBeLessThanOrEqual(1_000);
  });

  it("lets the ring finish forming before it can leave", () => {
    expect(COVER_MS).toBeLessThan(MIN_HOLD_MS);
    expect(ENTER_MS).toBeLessThanOrEqual(MIN_HOLD_MS);
  });

  it("eases the ground in from clear to opaque", () => {
    expect(coverAlpha(0)).toBe(0);
    expect(coverAlpha(COVER_MS)).toBe(1);
    expect(coverAlpha(COVER_MS / 4)).toBeLessThan(0.25);
  });

  it("lifts the ground from wherever the cover reached, after the coins start gathering", () => {
    expect(exitVeilAlpha(0, 0.6)).toBeCloseTo(0.6);
    expect(exitVeilAlpha(EXIT_MS * 0.2, 1)).toBeCloseTo(1);
    expect(exitVeilAlpha(EXIT_MS, 1)).toBeCloseTo(0);
  });

  it("lands every coin in the ring by the end of the entrance, in order", () => {
    for (let i = 0; i < COIN_COUNT; i++) {
      expect(coinEnterProgress(0, i)).toBe(0);
      expect(coinEnterProgress(ENTER_MS, i)).toBeCloseTo(1);
    }
    expect(coinEnterProgress(ENTER_MS / 3, 0)).toBeGreaterThan(coinEnterProgress(ENTER_MS / 3, COIN_COUNT - 1));
  });

  it("gathers every coin by the end of the exit", () => {
    for (let i = 0; i < COIN_COUNT; i++) expect(coinExitProgress(EXIT_MS, i)).toBe(1);
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
