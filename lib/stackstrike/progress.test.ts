import { describe, expect, it } from "vitest";
import { CONTRACTS } from "./content";
import { applyRun, loadoutFor, loadProgress, MAX_LEVEL, NEW_PROGRESS, rankFor, runXp, saveProgress, unlocksBetween, xpToReach } from "./progress";
import { createState } from "./sim";
import type { DifficultyId, SimState } from "./types";

function finished(over: Partial<SimState> & { difficulty?: DifficultyId } = {}): SimState {
  const state = createState(1, "vanguard", undefined, over.difficulty ?? "normal");
  return Object.assign(state, { status: "escaped" as const, ...over });
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
    expect(unlocksBetween(1, 2)).toContain(`${CONTRACTS["rich-pickings"].name} job`);
    expect(unlocksBetween(2, 3)).toEqual(expect.arrayContaining(["SMG", `${CONTRACTS["night-shift"].name} job`]));
    expect(unlocksBetween(3, 3)).toEqual([]);
  });
});

describe("run XP", () => {
  it("pays more for escaping, and most for a clean run", () => {
    const dead = runXp(finished({ status: "dead", score: 300 }));
    const seen = runXp(finished({ score: 1500, timesSpotted: 2, kills: 2 }));
    const shadow = runXp(finished({ score: 1500, timesSpotted: 0, kills: 2 }));
    const ghost = runXp(finished({ score: 1500, timesSpotted: 0, kills: 0 }));
    expect(dead).toBeLessThan(seen);
    expect(seen).toBeLessThan(shadow);
    expect(shadow).toBeLessThan(ghost);
  });

  it("pays more on harder jobs", () => {
    const base = { score: 1500, timesSpotted: 0, kills: 0 };
    expect(runXp(finished({ ...base, difficulty: "easy" }))).toBeLessThan(runXp(finished({ ...base, difficulty: "normal" })));
    expect(runXp(finished({ ...base, difficulty: "normal" }))).toBeLessThan(runXp(finished({ ...base, difficulty: "hard" })));
  });

  it("never pays nothing", () => {
    expect(runXp(finished({ status: "dead", score: 0 }))).toBeGreaterThan(0);
  });
});

describe("applying a run", () => {
  it("adds XP, counts the run and the escape, and tracks the best score", () => {
    const first = applyRun(NEW_PROGRESS, finished({ score: 2000 }));
    expect(first.progress.runs).toBe(1);
    expect(first.progress.escapes).toBe(1);
    expect(first.progress.bestScore).toBe(2000);
    const second = applyRun(first.progress, finished({ status: "dead", score: 100 }));
    expect(second.progress.runs).toBe(2);
    expect(second.progress.escapes).toBe(1);
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
    saveProgress({ xp: 123, runs: 4, escapes: 2, bestScore: 999 }, store);
    expect(loadProgress(store)).toEqual({ xp: 123, runs: 4, escapes: 2, bestScore: 999 });
  });

  it("starts fresh from nothing, junk or blocked storage", () => {
    expect(loadProgress(memory())).toEqual(NEW_PROGRESS);
    expect(loadProgress(memory({ "stackstrike:progress": "{not json" }))).toEqual(NEW_PROGRESS);
    expect(loadProgress(memory({ "stackstrike:progress": JSON.stringify({ xp: -5, runs: "x", escapes: NaN }) }))).toEqual(NEW_PROGRESS);
    expect(loadProgress({ getItem: () => { throw new Error("blocked"); } })).toEqual(NEW_PROGRESS);
    expect(() => saveProgress(NEW_PROGRESS, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
