import { describe, expect, it } from "vitest";
import { applyRun, loadoutFor, loadProgress, MAX_LEVEL, NEW_PROGRESS, rankFor, runXp, saveProgress, unlocksBetween, xpToReach } from "./progress";
import { createState } from "./sim";
import type { DifficultyId, SimState } from "./types";

function finished(over: Partial<SimState> & { difficulty?: DifficultyId } = {}): SimState {
  const state = createState(1, "vanguard", undefined, over.difficulty ?? "normal");
  return Object.assign(state, { status: "dead" as const, ...over });
}

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => void (data[key] = value), data };
}

describe("rank", () => {
  it("starts at level 1 and climbs with a growing cost", () => {
    expect(rankFor(0).level).toBe(1);
    expect(rankFor(xpToReach(2) - 1).level).toBe(1);
    expect(rankFor(xpToReach(2)).level).toBe(2);
    const gaps = [2, 3, 4, 5].map((n) => xpToReach(n + 1) - xpToReach(n));
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    expect(new Set(gaps).size).toBe(gaps.length);
  });

  it("stops at the cap with a full bar", () => {
    const rank = rankFor(1e9);
    expect(rank.level).toBe(MAX_LEVEL);
    expect(rank.fraction).toBe(1);
  });

  it("reports progress toward the next level", () => {
    const half = xpToReach(2) / 2;
    expect(rankFor(half).fraction).toBeCloseTo(0.5);
  });
});

describe("unlocks", () => {
  it("hands over guns as rank rises, pistol first", () => {
    expect(loadoutFor(1)).toEqual(["pistol"]);
    expect(loadoutFor(3)).toEqual(["pistol", "smg"]);
    expect(loadoutFor(5)).toEqual(["pistol", "smg", "shotgun"]);
  });

  it("names what a level-up unlocked", () => {
    expect(unlocksBetween(1, 2)).toEqual([]);
    expect(unlocksBetween(2, 3)).toEqual(["SMG"]);
    expect(unlocksBetween(4, 5)).toEqual(["Shotgun"]);
    expect(unlocksBetween(3, 3)).toEqual([]);
  });
});

describe("run XP", () => {
  const reached = (waves: number, score: number, difficulty: DifficultyId = "normal") => {
    const state = finished({ score, difficulty });
    state.wave.number = waves;
    return runXp(state);
  };

  it("pays more for a higher score and for lasting more waves", () => {
    expect(reached(1, 500)).toBeLessThan(reached(1, 3000));
    expect(reached(2, 1000)).toBeLessThan(reached(8, 1000));
  });

  it("pays more on harder difficulties", () => {
    expect(reached(5, 2000, "easy")).toBeLessThan(reached(5, 2000, "normal"));
    expect(reached(5, 2000, "normal")).toBeLessThan(reached(5, 2000, "hard"));
  });

  it("never pays nothing", () => {
    expect(reached(0, 0)).toBeGreaterThan(0);
  });
});

describe("applying a run", () => {
  it("adds XP, counts the run, and tracks the best score and wave", () => {
    const strong = finished({ score: 2000 });
    strong.wave.number = 6;
    const first = applyRun(NEW_PROGRESS, strong);
    expect(first.progress.runs).toBe(1);
    expect(first.progress.bestWave).toBe(6);
    expect(first.progress.bestScore).toBe(2000);
    const weak = finished({ score: 100 });
    weak.wave.number = 2;
    const second = applyRun(first.progress, weak);
    expect(second.progress.runs).toBe(2);
    expect(second.progress.bestWave).toBe(6);
    expect(second.progress.bestScore).toBe(2000);
  });

  it("reports a level-up and what it unlocked", () => {
    const result = applyRun({ ...NEW_PROGRESS, xp: xpToReach(3) - 5 }, finished({ score: 2000 }));
    expect(result.from).toBe(2);
    expect(result.to).toBeGreaterThanOrEqual(3);
    expect(result.unlocked).toContain("SMG");
  });
});

describe("saving", () => {
  it("round-trips", () => {
    const store = memory();
    saveProgress({ xp: 123, runs: 4, bestWave: 2, bestScore: 999 }, store);
    expect(loadProgress(store)).toEqual({ xp: 123, runs: 4, bestWave: 2, bestScore: 999 });
  });

  it("starts fresh from nothing, junk or blocked storage", () => {
    expect(loadProgress(memory())).toEqual(NEW_PROGRESS);
    expect(loadProgress(memory({ "stackstrike:progress": "{not json" }))).toEqual(NEW_PROGRESS);
    expect(loadProgress(memory({ "stackstrike:progress": JSON.stringify({ xp: -5, runs: "x", bestWave: NaN }) }))).toEqual(NEW_PROGRESS);
    expect(loadProgress({ getItem: () => { throw new Error("blocked"); } })).toEqual(NEW_PROGRESS);
    expect(() => saveProgress(NEW_PROGRESS, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
