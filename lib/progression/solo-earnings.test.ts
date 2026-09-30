import { describe, expect, it } from "vitest";
import { rankProgress } from "./rank";
import {
  GOLD_PER_RANK_POINT,
  bandRankWeight,
  rankPointsFrom,
  stakeBandIndexes,
  summarizeSoloEarnings,
  weightedNet,
  withoutResult,
  type EarningsByBand,
} from "./solo-earnings";

const totals = (staked: number, paidOut: number, wins = 1, losses = 0) => ({ wins, losses, staked, paidOut });

describe("bandRankWeight", () => {
  it("runs from 1x on the bottom band to 10x on the top, growing each step", () => {
    const weights = [0, 1, 2, 3].map(bandRankWeight);
    expect(weights[0]).toBe(1);
    expect(weights[3]).toBeCloseTo(10);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });

  it("lets a hard-band player out-rank an easy grinder who earned more Gold", () => {
    const grinder: EarningsByBand = { 0: totals(100_000, 400_000) };
    const expert: EarningsByBand = { 3: totals(10_000, 60_000) };
    expect(rankPointsFrom(0, expert)).toBeGreaterThan(rankPointsFrom(0, grinder));
  });
});

describe("rank points", () => {
  it("rise on a win by the Gold made over the stake, weighted by band", () => {
    const easy: EarningsByBand = { 0: totals(1000, 1500) };
    const hard: EarningsByBand = { 2: totals(1000, 1500) };
    expect(rankPointsFrom(0, easy)).toBe(Math.floor(500 / GOLD_PER_RANK_POINT));
    expect(rankPointsFrom(0, hard)).toBe(Math.floor((500 * bandRankWeight(2)) / GOLD_PER_RANK_POINT));
  });

  it("fall on a loss, and a loss on a harder band costs more", () => {
    const easyLoss: EarningsByBand = { 0: totals(1000, 0, 0, 1) };
    const hardLoss: EarningsByBand = { 2: totals(1000, 0, 0, 1) };
    expect(rankPointsFrom(1000, easyLoss)).toBe(1000 - 1000 / GOLD_PER_RANK_POINT);
    expect(rankPointsFrom(1000, hardLoss)).toBeLessThan(rankPointsFrom(1000, easyLoss));
  });

  it("net a win against a loss in the same band", () => {
    const byBand: EarningsByBand = { 1: totals(2000, 1500, 1, 1) };
    expect(weightedNet(byBand)).toBeCloseTo(-500 * bandRankWeight(1));
  });

  it("never go below zero, however deep the player is down", () => {
    expect(rankPointsFrom(0, { 3: totals(5_000_000, 0, 0, 5) })).toBe(0);
    expect(rankProgress(rankPointsFrom(0, { 3: totals(5_000_000, 0, 0, 5) })).tier.id).toBe("bronze");
  });

  it("start a carried-over player from the base they were given", () => {
    expect(rankPointsFrom(3_000, {})).toBe(3_000);
    expect(rankProgress(rankPointsFrom(3_000, {})).tier.id).toBe("silver");
  });
});

describe("summarizeSoloEarnings", () => {
  it("reports nothing yet for a player with no play", () => {
    const summary = summarizeSoloEarnings({});
    expect(summary).toMatchObject({ wins: 0, losses: 0, totalStaked: 0, totalPaidOut: 0, net: 0 });
    expect(summary.difficulty).toEqual({ average: null, needle: null, label: null });
    expect(summary.bands).toHaveLength(stakeBandIndexes().length);
  });

  it("splits earned Gold into shares that sum to one", () => {
    const summary = summarizeSoloEarnings({ 0: totals(1000, 1000), 2: totals(1000, 3000) });
    expect(summary.totalPaidOut).toBe(4000);
    expect(summary.bands.reduce((sum, band) => sum + band.share, 0)).toBeCloseTo(1);
    expect(summary.bands[0].share).toBeCloseTo(0.25);
    expect(summary.bands[2].share).toBeCloseTo(0.75);
  });

  it("puts the needle at the paid-out-weighted average band", () => {
    const top = stakeBandIndexes().length - 1;
    const allTop = summarizeSoloEarnings({ [top]: totals(1000, 2000) });
    expect(allTop.difficulty.needle).toBe(1);
    const allEasy = summarizeSoloEarnings({ 0: totals(1000, 1200) });
    expect(allEasy.difficulty.needle).toBe(0);
    expect(allEasy.difficulty.label).toBe(allEasy.bands[0].label);
  });

  it("counts a loss in staked and net, but not in earned Gold", () => {
    const summary = summarizeSoloEarnings({ 1: totals(3000, 1000, 1, 2) });
    expect(summary.totalStaked).toBe(3000);
    expect(summary.totalPaidOut).toBe(1000);
    expect(summary.net).toBe(-2000);
    expect(summary.losses).toBe(2);
  });
});

describe("withoutResult", () => {
  it("undoes a win, so a settle can be priced from the after-state alone", () => {
    const before: EarningsByBand = { 1: totals(2_000, 3_000, 1, 1) };
    const after: EarningsByBand = { 1: totals(3_000, 7_000, 2, 1) };
    expect(withoutResult(after, 1, 1_000, 4_000)).toEqual(before);
  });

  it("undoes a loss", () => {
    const after: EarningsByBand = { 0: totals(1_500, 500, 1, 1) };
    expect(withoutResult(after, 0, 1_000, 0)).toEqual({ 0: totals(500, 500, 1, 0) });
  });

  it("leaves other bands alone", () => {
    const after: EarningsByBand = { 0: totals(100, 200), 2: totals(300, 0, 0, 1) };
    expect(withoutResult(after, 2, 300, 0)[0]).toEqual(after[0]);
  });
});
