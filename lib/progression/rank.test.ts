import { describe, expect, it } from "vitest";
import {
  GOLD_PER_XP,
  MAX_LEVEL,
  MILESTONE_EVERY,
  RANK_BANDS,
  goldForLevelUps,
  levelForXp,
  levelReward,
  rankProgress,
  rankTitle,
  rewardsBetween,
  xpForWager,
  xpToReachLevel,
  XP_STEP,
} from "./rank";

describe("earning XP", () => {
  it("converts a wager at the documented rate and never pays for nothing", () => {
    expect(xpForWager(250)).toBe(25);
    expect(xpForWager(5_000)).toBe(500);
    expect(xpForWager(GOLD_PER_XP - 1)).toBe(0);
    // A refund, a bad number or a zero stake must not move the bar backwards.
    expect(xpForWager(0)).toBe(0);
    expect(xpForWager(-1_000)).toBe(0);
    expect(xpForWager(Number.NaN)).toBe(0);
  });
});

describe("the level curve", () => {
  it("starts everyone at level 1 for free", () => {
    expect(xpToReachLevel(1)).toBe(0);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-5)).toBe(1);
  });

  it("widens each level by exactly one step", () => {
    for (let level = 1; level < 12; level += 1) {
      expect(xpToReachLevel(level + 1) - xpToReachLevel(level)).toBe(XP_STEP * level);
    }
  });

  it("inverts its own curve exactly at every boundary", () => {
    // The reason levelForXp does not trust its square root: one XP short of a
    // level must never round up to it, and landing exactly on it must never
    // round down. Walking every boundary is what catches a float that drifts.
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      const needed = xpToReachLevel(level);
      expect(levelForXp(needed)).toBe(level);
      if (level > 1) expect(levelForXp(needed - 1)).toBe(level - 1);
    }
  });

  it("stops at the cap rather than running off the end", () => {
    const beyond = xpToReachLevel(MAX_LEVEL) * 10;
    expect(levelForXp(beyond)).toBe(MAX_LEVEL);

    const capped = rankProgress(beyond);
    expect(capped.level).toBe(MAX_LEVEL);
    // A full bar rather than a division by a zero-width level.
    expect(capped.ratio).toBe(1);
    expect(capped.levelSpan).toBe(0);
    expect(Number.isFinite(capped.ratio)).toBe(true);
  });
});

describe("the rank readout", () => {
  it("reports where in the level the player is", () => {
    const start = xpToReachLevel(4);
    const span = xpToReachLevel(5) - start;
    const progress = rankProgress(start + Math.floor(span / 2));

    expect(progress.level).toBe(4);
    expect(progress.intoLevel).toBe(Math.floor(span / 2));
    expect(progress.levelSpan).toBe(span);
    expect(progress.ratio).toBeGreaterThan(0.49);
    expect(progress.ratio).toBeLessThan(0.51);
  });

  it("names every band from the table, and points at the next one", () => {
    for (const band of RANK_BANDS) {
      expect(rankTitle(band.from)).toBe(band.title);
      // The band has to hold until the next one starts, not just at its floor.
      const next = RANK_BANDS.find((entry) => entry.from > band.from);
      if (next) expect(rankTitle(next.from - 1)).toBe(band.title);
    }

    const early = rankProgress(0);
    expect(early.title).toBe(RANK_BANDS[0].title);
    expect(early.nextTitle).toBe(RANK_BANDS[1].title);
    expect(early.nextTitleLevel).toBe(RANK_BANDS[1].from);

    // Nothing left to promise at the top.
    expect(rankProgress(xpToReachLevel(MAX_LEVEL)).nextTitle).toBeNull();
  });
});

describe("level rewards", () => {
  it("pays Gold only at milestones, and pays more at higher ones", () => {
    expect(levelReward(2).gold).toBe(0);
    expect(levelReward(4).gold).toBe(0);
    expect(levelReward(MILESTONE_EVERY).gold).toBeGreaterThan(0);
    expect(levelReward(MILESTONE_EVERY * 2).gold)
      .toBeGreaterThan(levelReward(MILESTONE_EVERY).gold);
    // Level 1 is where everyone starts; arriving there is not an achievement.
    expect(levelReward(1).gold).toBe(0);
  });

  it("marks the levels that change what a player is called", () => {
    expect(levelReward(RANK_BANDS[1].from).newTitle).toBe(RANK_BANDS[1].title);
    expect(levelReward(RANK_BANDS[1].from + 1).newTitle).toBeNull();
  });

  it("pays every level crossed, not just the one landed on", () => {
    // The failure this guards: one big wager jumping several levels and
    // silently swallowing the milestones in between.
    const crossed = rewardsBetween(3, 11);
    expect(crossed.map((reward) => reward.level)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(goldForLevelUps(3, 11))
      .toBe(levelReward(5).gold + levelReward(10).gold);
  });

  it("owes nothing when no level was crossed", () => {
    expect(rewardsBetween(7, 7)).toEqual([]);
    expect(goldForLevelUps(7, 7)).toBe(0);
    // A level cannot go backwards, and a caller that thinks it did owes nothing.
    expect(goldForLevelUps(9, 4)).toBe(0);
  });

  it("keeps the whole ladder inside the house's edge on the turnover it takes", () => {
    // The economic guard, not a style point: level rewards are a Gold faucet,
    // and Gold is sold for money. Reaching MAX_LEVEL costs a known amount of
    // wagering, and the arcade's edge on that turnover has to more than cover
    // everything the ladder pays out along the way -- otherwise grinding the
    // ladder is a way to print Gold.
    const turnover = xpToReachLevel(MAX_LEVEL) * GOLD_PER_XP;
    const paid = goldForLevelUps(1, MAX_LEVEL);
    // Hi-Lo prices a 3% edge; staying under 1% of turnover leaves the margin
    // intact with room for the daily grant and streak on top.
    expect(paid / turnover).toBeLessThan(0.01);
  });
});
