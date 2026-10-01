/**
 * Stake pressure: the bigger the wager, the harder the game it buys.
 *
 * There is no wager ceiling. Instead a stake falls into a band, and each game
 * reads the band to decide how hard the run is: which tiers may be picked,
 * how long a sequence gets, whether Word Stack plays in hard mode. The bands
 * are Easy (under 25k), Medium (25k), Hard (100k), Elite (500k) and Expert
 * (1M and up). A win never pays back less than the stake in any band, but
 * the payouts climb with the band: Easy barely pays, Expert pays the most.
 *
 * Shared by server and client, so it holds rules only, no answers.
 */

export type StakePressure = 0 | 1 | 2 | 3 | 4;

/** Every band, easiest first. */
export const STAKE_PRESSURES: readonly StakePressure[] = [0, 1, 2, 3, 4];

/** The smallest wager in each band above Easy. */
export const STAKE_PRESSURE_STEPS = [25_000, 100_000, 500_000, 1_000_000] as const;

export function stakePressure(wager: number): StakePressure {
  if (wager >= STAKE_PRESSURE_STEPS[3]) return 4;
  if (wager >= STAKE_PRESSURE_STEPS[2]) return 3;
  if (wager >= STAKE_PRESSURE_STEPS[1]) return 2;
  if (wager >= STAKE_PRESSURE_STEPS[0]) return 1;
  return 0;
}

export const STAKE_PRESSURE_LABELS: Record<StakePressure, string> = {
  0: "Easy",
  1: "Medium",
  2: "Hard",
  3: "Elite",
  4: "Expert",
};

/** "25k+" style name for the band a wager falls in, for the lobby note. */
export function stakePressureThreshold(pressure: StakePressure): string {
  if (pressure === 0) return "";
  const step = STAKE_PRESSURE_STEPS[pressure - 1];
  return step >= 1_000_000 ? `${step / 1_000_000}M+` : `${step / 1000}k+`;
}

/**
 * How much of a rung's gain over the stake each band pays. A rung of 3x is a
 * gain of 2x; Easy pays 40% of that gain, Medium the whole of it (Medium's
 * tables are the reference), and each band above pays more. Everything the
 * ladder games pay goes through scaleForBand, so Easy barely pays and Expert
 * pays the most without every game keeping five hand-tuned tables.
 */
export const PAYOUT_GAIN_BY_PRESSURE: Readonly<Record<StakePressure, number>> = {
  0: 0.4,
  1: 1,
  2: 1.25,
  3: 1.4,
  4: 1.55,
};

/** The least a win ever pays, as a multiple of the stake, in any band. */
export const MIN_WIN_MULTIPLIER = 1.05;

/** A Medium-reference multiplier as this band pays it. Never below MIN_WIN_MULTIPLIER. */
export function scaleForBand(multiplier: number, pressure: StakePressure): number {
  const scaled = 1 + (multiplier - 1) * PAYOUT_GAIN_BY_PRESSURE[pressure];
  return Math.max(MIN_WIN_MULTIPLIER, Math.round(scaled * 100) / 100);
}

/**
 * A tiered game's tiers, easiest first, and the easiest tier each band may
 * still pick (as an index into `tiers`).
 */
export interface TierLadder<T extends string> {
  tiers: readonly T[];
  minTierByPressure: readonly [number, number, number, number, number];
}

export function lowestTierFor<T extends string>(ladder: TierLadder<T>, wager: number): T {
  return ladder.tiers[ladder.minTierByPressure[stakePressure(wager)]];
}

export function tierAllowedFor<T extends string>(ladder: TierLadder<T>, tier: T, wager: number): boolean {
  const index = ladder.tiers.indexOf(tier);
  return index >= ladder.minTierByPressure[stakePressure(wager)];
}
