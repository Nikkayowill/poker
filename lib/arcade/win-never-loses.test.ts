import { describe, expect, it } from "vitest";
import { ANTE_UP_TIERS } from "./ante-up";
import { ANTE_UP_BLOCKUDOKU_GRANDMASTER, ANTE_UP_BLOCKUDOKU_TIERS } from "./ante-up-blockudoku";
import {
  CONNECTIONS_LADDER_BY_PRESSURE,
  CONNECTIONS_LADDER_FLOOR,
  WAGER_MULTIPLIER_BY_MISTAKES,
} from "./ante-up-connections";
import { LEGACY_MEMORY_RUNGS, MEMORY_RULES_BY_PRESSURE } from "./ante-up-memory";
import { ANTE_UP_MINESWEEPER_TIERS } from "./ante-up-minesweeper";
import { ANTE_UP_NONOGRAM_TIERS } from "./ante-up-nonogram";
import { ANTE_UP_WORD_FILL_IN_TIERS } from "./ante-up-word-fill-in";
import {
  WAGER_MULTIPLIER_BY_GUESSES,
  WORD_STACK_LADDER_BY_PRESSURE,
  WORD_STACK_LADDER_FLOOR,
} from "./ante-up-word-stack";
import { LIGHTS_OUT_BANDS, lightsOutLadder } from "./brain-lights-out";
import { BRAIN_STREAK_RULES, brainStreakLadder } from "./brain-streak";
import { STAKE_PRESSURES } from "./stake-pressure";
import { WORD_GUESS_BANDS } from "./brain-word-guess";

/**
 * The platform rule: winning, or beating the clock, never costs the player
 * Gold. A loss forfeits the stake; a win always returns at least the stake.
 * Every payout table for a win is listed here so a new rung under 1x fails
 * loudly instead of shipping.
 */
function expectNeverBelowStake(name: string, multipliers: readonly number[]): void {
  expect(multipliers.length, `${name} has no rungs`).toBeGreaterThan(0);
  for (const multiplier of multipliers) {
    expect(multiplier, `${name} pays ${multiplier}x on a win`).toBeGreaterThanOrEqual(1);
  }
}

describe("a win never pays back less than the stake", () => {
  it("Word Stack", () => {
    expectNeverBelowStake("standard", Object.values(WAGER_MULTIPLIER_BY_GUESSES));
    for (const [band, ladder] of Object.entries(WORD_STACK_LADDER_BY_PRESSURE)) {
      expectNeverBelowStake(`band ${band}`, Object.values(ladder));
    }
    expect(WORD_STACK_LADDER_FLOOR).toBeGreaterThanOrEqual(1);
  });

  it("Connections", () => {
    expectNeverBelowStake("fallback", Object.values(WAGER_MULTIPLIER_BY_MISTAKES));
    for (const [band, ladder] of Object.entries(CONNECTIONS_LADDER_BY_PRESSURE)) {
      expectNeverBelowStake(`band ${band}`, Object.values(ladder));
    }
    expect(CONNECTIONS_LADDER_FLOOR).toBeGreaterThanOrEqual(1);
  });

  it("Memory Match", () => {
    expectNeverBelowStake("legacy", LEGACY_MEMORY_RUNGS.map((rung) => rung.multiplier));
    for (const [band, rules] of Object.entries(MEMORY_RULES_BY_PRESSURE)) {
      expectNeverBelowStake(`band ${band}`, rules.rungs.map((rung) => rung.multiplier));
    }
  });

  it("Lights Out", () => {
    expectNeverBelowStake("legacy", lightsOutLadder(LIGHTS_OUT_BANDS[0]).map((rung) => rung.multiplier));
    for (const band of STAKE_PRESSURES) {
      expectNeverBelowStake(`band ${band}`, lightsOutLadder(LIGHTS_OUT_BANDS[band], band).map((rung) => rung.multiplier));
    }
  });

  it("Word Guess", () => {
    for (const [band, config] of Object.entries(WORD_GUESS_BANDS)) {
      expectNeverBelowStake(`band ${band}`, config.ladder.map((rung) => rung.multiplier));
    }
  });

  it("the streak games", () => {
    for (const [game, rules] of Object.entries(BRAIN_STREAK_RULES)) {
      expectNeverBelowStake(game, rules.ladder.map((rung) => rung.multiplier));
      for (const band of STAKE_PRESSURES) {
        expectNeverBelowStake(`${game} band ${band}`, brainStreakLadder(rules, band).map((rung) => rung.multiplier));
      }
    }
  });

  it("the timed tiers", () => {
    expectNeverBelowStake("sudoku", Object.values(ANTE_UP_TIERS).map((tier) => tier.multiplier));
    expectNeverBelowStake("minesweeper", Object.values(ANTE_UP_MINESWEEPER_TIERS).map((tier) => tier.multiplier));
    expectNeverBelowStake("nonogram", Object.values(ANTE_UP_NONOGRAM_TIERS).map((tier) => tier.multiplier));
    expectNeverBelowStake("word fill-in", Object.values(ANTE_UP_WORD_FILL_IN_TIERS).map((tier) => tier.multiplier));
    expectNeverBelowStake("blockudoku", [
      ...Object.values(ANTE_UP_BLOCKUDOKU_TIERS).map((tier) => tier.multiplier),
      ANTE_UP_BLOCKUDOKU_GRANDMASTER.multiplier,
    ]);
  });
});
