import { describe, expect, it } from "vitest";
import { anteUpTimeLimitMs, ANTE_UP_MAX_MISTAKES } from "./ante-up";
import { anteUpMinesweeperTimeLimitMs } from "./ante-up-minesweeper";
import { anteUpNonogramAutoCrossAllowed, anteUpNonogramTimeLimitMs } from "./ante-up-nonogram";
import type { MinesweeperDifficulty } from "./puzzles/minesweeper";
import type { NonogramDifficulty } from "./puzzles/nonogram";
import type { SudokuDifficulty } from "./puzzles/sudoku";
import type { StakePressure } from "./stake-pressure";

/**
 * The skill model behind the Sudoku, Minesweeper and Nonogram clocks.
 *
 * There is no solve-rate data from real attempts yet, so the clocks are set
 * against a model and this file checks them against the targets. When real
 * data exists, replace the medians below with measured ones and retune.
 *
 * Skill is on the WAIS scale: z = 0 is the median player, z = 1 is top ~16%,
 * z = 2 top ~2%, z = 3 top ~0.13%. A player's time on one board is
 * log-normal around median / speedPerSd^z with spread `sigma` (the same
 * player has good and bad runs). Separately, a board can be lost to mistakes
 * or a careless click; that chance halves per standard deviation.
 *
 * Targets, on the easiest tier each stake band allows:
 *   <10k   median >= 80%
 *   10k+   +1SD >= 50%, median <= 25%
 *   100k+  +2SD >= 50%, +1SD <= 25%, median <= 5%
 *   1M+    +3SD >= 60%, +2SD <= 25%, median <= 1%
 *
 * Sources for the medians (all soft, and scaled to our boards in each
 * game's tier comment): minesweeper.now "What is a good Minesweeper time"
 * skill tiers; the Steam Minesweeper achievement split (61% of players under
 * 60s on beginner); sudokuchallenges.com and 247sudoku.com average times by
 * grade; puzzle-nonograms.com and nonogram blog times by grid size.
 */

interface SkillModel<T extends string> {
  /** A median player's time on each tier, ms. */
  medianMs: Record<T, number>;
  speedPerSd: number;
  sigma: number;
  /** Chance a median player loses the board to mistakes regardless of time. */
  bustAtMedian: Record<T, number>;
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function winRate<T extends string>(model: SkillModel<T>, tier: T, z: number, clockMs: number, slowdown = 1): number {
  const median = (model.medianMs[tier] * slowdown) / model.speedPerSd ** z;
  const inTime = phi(Math.log(clockMs / median) / model.sigma);
  return inTime * (1 - model.bustAtMedian[tier] * 0.5 ** z);
}

const MIN = 60_000;
/** A stake inside each band. */
const BAND_WAGER: Record<StakePressure, number> = { 0: 1_000, 1: 10_000, 2: 100_000, 3: 1_000_000 };

type Targets = readonly (readonly [z: number, atLeast: number | null, atMost: number | null])[];
const TARGETS: Record<StakePressure, Targets> = {
  0: [[0, 0.8, null]],
  1: [[1, 0.5, null], [0, null, 0.25]],
  2: [[2, 0.5, null], [1, null, 0.25], [0, null, 0.05]],
  3: [[3, 0.6, null], [2, null, 0.25], [0, null, 0.01]],
};

function checkBand(rate: (z: number) => number, band: StakePressure): void {
  for (const [z, atLeast, atMost] of TARGETS[band]) {
    const value = rate(z);
    if (atLeast !== null) expect(value, `band ${band}, z=${z}`).toBeGreaterThanOrEqual(atLeast);
    if (atMost !== null) expect(value, `band ${band}, z=${z}`).toBeLessThanOrEqual(atMost);
  }
}

/** Prints the table the tier comments carry, for when the numbers move. */
function table(rate: (band: StakePressure, z: number) => number): string {
  return ([0, 1, 2, 3] as const)
    .map((band) => [0, 1, 2, 3].map((z) => `${Math.round(rate(band, z) * 100)}%`).join("  "))
    .join("\n");
}

describe("Sudoku calibration", () => {
  const model: SkillModel<SudokuDifficulty> = {
    medianMs: { easy: 5 * MIN, medium: 9 * MIN, hard: 16 * MIN, expert: 30 * MIN },
    speedPerSd: 1.5,
    sigma: 0.3,
    // Three wrong digits end a grid; a median player rarely makes three on
    // easy and more often on grids they have to reason hard about.
    bustAtMedian: { easy: 0.03, medium: 0.05, hard: 0.08, expert: 0.12 },
  };
  const floors: Record<StakePressure, SudokuDifficulty> = { 0: "easy", 1: "medium", 2: "hard", 3: "expert" };
  const rate = (band: StakePressure, z: number) =>
    winRate(model, floors[band], z, anteUpTimeLimitMs(floors[band], BAND_WAGER[band]));

  it("uses the mistake limit the model assumes", () => {
    expect(ANTE_UP_MAX_MISTAKES).toBe(3);
  });

  it.each([0, 1, 2, 3] as const)("meets the targets on band %i's easiest grid", (band) => {
    checkBand((z) => rate(band, z), band);
  });

  it("matches the table in ante-up.ts", () => {
    expect(table(rate)).toMatchInlineSnapshot(`
      "91%  98%  99%  100%
      19%  68%  96%  99%
      1%  16%  64%  95%
      0%  1%  16%  64%"
    `);
  });
});

describe("Minesweeper calibration", () => {
  const model: SkillModel<MinesweeperDifficulty> = {
    medianMs: { beginner: 90_000, intermediate: 175_000, expert: 330_000, master: 410_000 },
    speedPerSd: 1.8,
    sigma: 0.3,
    bustAtMedian: { beginner: 0.15, intermediate: 0.25, expert: 0.35, master: 0.4 },
  };
  const floors: Record<StakePressure, MinesweeperDifficulty> = {
    0: "beginner",
    1: "intermediate",
    2: "expert",
    3: "master",
  };
  const rate = (band: StakePressure, z: number) =>
    winRate(model, floors[band], z, anteUpMinesweeperTimeLimitMs(floors[band], BAND_WAGER[band]));

  it.each([0, 1, 2, 3] as const)("meets the targets on band %i's easiest board", (band) => {
    checkBand((z) => rate(band, z), band);
  });

  it("matches the table in ante-up-minesweeper.ts", () => {
    expect(table(rate)).toMatchInlineSnapshot(`
      "84%  92%  96%  98%
      8%  66%  93%  97%
      0%  21%  82%  96%
      0%  0%  19%  84%"
    `);
  });
});

describe("Nonogram calibration", () => {
  const model: SkillModel<NonogramDifficulty> = {
    medianMs: { easy: 1.5 * MIN, medium: 7 * MIN, hard: 18 * MIN, expert: 35 * MIN, master: 55 * MIN },
    speedPerSd: 1.65,
    sigma: 0.3,
    bustAtMedian: { easy: 0.05, medium: 0.1, hard: 0.15, expert: 0.2, master: 0.25 },
  };
  const floors: Record<StakePressure, NonogramDifficulty> = { 0: "easy", 1: "medium", 2: "hard", 3: "expert" };
  // Crossing your own finished lines costs time.
  const slowdown = (wager: number) => (anteUpNonogramAutoCrossAllowed(wager) ? 1 : 1.1);
  const rateOn = (tier: NonogramDifficulty, band: StakePressure, z: number) => {
    const wager = BAND_WAGER[band];
    return winRate(model, tier, z, anteUpNonogramTimeLimitMs(tier, wager), slowdown(wager));
  };
  const rate = (band: StakePressure, z: number) => rateOn(floors[band], band, z);

  it.each([0, 1, 2, 3] as const)("meets the targets on band %i's smallest board", (band) => {
    checkBand((z) => rate(band, z), band);
  });

  it("holds master to the top band's targets too, since 1M may pick it", () => {
    checkBand((z) => rateOn("master", 3, z), 3);
  });

  it("matches the table in ante-up-nonogram.ts", () => {
    expect(table(rate)).toMatchInlineSnapshot(`
      "95%  97%  99%  99%
      12%  67%  96%  99%
      0%  16%  73%  97%
      0%  1%  19%  78%"
    `);
    expect([0, 1, 2, 3].map((z) => `${Math.round(rateOn("master", 3, z) * 100)}%`).join("  ")).toMatchInlineSnapshot(`"0%  0%  13%  69%"`);
  });
});
