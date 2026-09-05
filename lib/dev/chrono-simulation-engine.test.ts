import { describe, expect, it } from "vitest";
import {
  CHRONO_MAX_TIME_SCALE,
  CHRONO_MIN_TIME_SCALE,
  clampChronoTimeScale,
  getChronoSimulatableGame,
  isChronoSimulatableGame,
  resetChronoTimeScale,
  setChronoTimeScale,
  type ChronoSimulatableGame,
} from "./chrono-simulation-engine";

/** A plain object shaped like the slice of `Phaser.Game` this engine
 *  touches -- see the module's own header for why a real `Phaser.Game` is
 *  never booted in this file. Every field a real Phaser 3.90 instance
 *  carries at these paths (`game.loop.timeScale`,
 *  `game.scene.scenes[i].time.timeScale`,
 *  `game.scene.scenes[i].tweens.timeScale`) is represented here. */
function fakeGame(sceneCount: number): ChronoSimulatableGame {
  return {
    loop: { timeScale: 1 },
    scene: {
      scenes: Array.from({ length: sceneCount }, () => ({
        time: { timeScale: 1 },
        tweens: { timeScale: 1 },
      })),
    },
  };
}

describe("clampChronoTimeScale", () => {
  it("passes an in-range value through unchanged", () => {
    expect(clampChronoTimeScale(10)).toBe(10);
  });

  it("floors at CHRONO_MIN_TIME_SCALE", () => {
    expect(clampChronoTimeScale(0)).toBe(CHRONO_MIN_TIME_SCALE);
    expect(clampChronoTimeScale(-5)).toBe(CHRONO_MIN_TIME_SCALE);
  });

  it("ceilings at CHRONO_MAX_TIME_SCALE", () => {
    expect(clampChronoTimeScale(10_000)).toBe(CHRONO_MAX_TIME_SCALE);
  });

  it("falls back to 1x for a non-finite input rather than propagating NaN", () => {
    expect(clampChronoTimeScale(Number.NaN)).toBe(1);
    expect(clampChronoTimeScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("setChronoTimeScale", () => {
  it("sets the game loop's timeScale", () => {
    const game = fakeGame(1);
    setChronoTimeScale(game, 20);
    expect(game.loop.timeScale).toBe(20);
  });

  it("sets EVERY live scene's time and tweens timeScale, not just the loop's", () => {
    const game = fakeGame(3);
    setChronoTimeScale(game, 20);
    for (const scene of game.scene.scenes) {
      expect(scene.time.timeScale).toBe(20);
      expect(scene.tweens.timeScale).toBe(20);
    }
  });

  it("does nothing to per-scene clocks when there are no live scenes yet", () => {
    const game = fakeGame(0);
    expect(() => setChronoTimeScale(game, 20)).not.toThrow();
    expect(game.loop.timeScale).toBe(20);
  });

  it("clamps before applying and returns the clamped value actually used", () => {
    const game = fakeGame(1);
    const applied = setChronoTimeScale(game, 100_000);
    expect(applied).toBe(CHRONO_MAX_TIME_SCALE);
    expect(game.loop.timeScale).toBe(CHRONO_MAX_TIME_SCALE);
  });
});

describe("resetChronoTimeScale", () => {
  it("returns every clock this engine could have touched to exactly 1x", () => {
    const game = fakeGame(2);
    setChronoTimeScale(game, 50);
    resetChronoTimeScale(game);
    expect(game.loop.timeScale).toBe(1);
    for (const scene of game.scene.scenes) {
      expect(scene.time.timeScale).toBe(1);
      expect(scene.tweens.timeScale).toBe(1);
    }
  });
});

describe("isChronoSimulatableGame", () => {
  it("accepts a well-formed game shape", () => {
    expect(isChronoSimulatableGame(fakeGame(2))).toBe(true);
  });

  it("rejects null and non-objects", () => {
    expect(isChronoSimulatableGame(null)).toBe(false);
    expect(isChronoSimulatableGame(undefined)).toBe(false);
    expect(isChronoSimulatableGame("game")).toBe(false);
    expect(isChronoSimulatableGame(42)).toBe(false);
  });

  it("rejects a game missing loop.timeScale", () => {
    const broken = { scene: { scenes: [] } };
    expect(isChronoSimulatableGame(broken)).toBe(false);
  });

  it("rejects a game whose scene.scenes is not an array", () => {
    const broken = { loop: { timeScale: 1 }, scene: { scenes: "nope" } };
    expect(isChronoSimulatableGame(broken)).toBe(false);
  });

  it("rejects a game with one malformed scene among otherwise-valid ones", () => {
    const good = fakeGame(1);
    const broken = {
      loop: good.loop,
      scene: { scenes: [...good.scene.scenes, { time: { timeScale: 1 } /* no tweens */ }] },
    };
    expect(isChronoSimulatableGame(broken)).toBe(false);
  });
});

describe("getChronoSimulatableGame", () => {
  it("returns null when window is undefined (this test's own environment has no window global)", () => {
    // vitest's default environment is "node", which has no `window` at all --
    // this exercises the SSR guard directly rather than simulating a jsdom
    // environment this module never actually runs under before mount.
    expect(typeof window).toBe("undefined");
    expect(getChronoSimulatableGame()).toBeNull();
  });
});
