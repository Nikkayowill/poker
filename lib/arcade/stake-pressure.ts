/**
 * Stake pressure: the bigger the wager, the harder the game it buys.
 *
 * There is no wager ceiling. Instead a stake falls into a band, and each game
 * reads the band to decide how hard the run is: which tiers may be picked,
 * how long a sequence gets, whether Word Stack plays in hard mode. The top
 * band is meant for experts. A strong player can still win it quickly and
 * often, and an average player usually won't.
 *
 * Shared by server and client, so it holds rules only, no answers.
 */

export type StakePressure = 0 | 1 | 2 | 3;

/** The smallest wager in each band above 0. */
export const STAKE_PRESSURE_STEPS = [10_000, 100_000, 1_000_000] as const;

export function stakePressure(wager: number): StakePressure {
  if (wager >= STAKE_PRESSURE_STEPS[2]) return 3;
  if (wager >= STAKE_PRESSURE_STEPS[1]) return 2;
  if (wager >= STAKE_PRESSURE_STEPS[0]) return 1;
  return 0;
}

export const STAKE_PRESSURE_LABELS: Record<StakePressure, string> = {
  0: "Standard rules",
  1: "High stakes",
  2: "Big stakes",
  3: "Top stakes",
};

/** "10k+" style name for the band a wager falls in, for the lobby note. */
export function stakePressureThreshold(pressure: StakePressure): string {
  if (pressure === 0) return "";
  const step = STAKE_PRESSURE_STEPS[pressure - 1];
  return step >= 1_000_000 ? `${step / 1_000_000}M+` : `${step / 1000}k+`;
}

/**
 * A tiered game's tiers, easiest first, and the easiest tier each band may
 * still pick (as an index into `tiers`).
 */
export interface TierLadder<T extends string> {
  tiers: readonly T[];
  minTierByPressure: readonly [number, number, number, number];
}

export function lowestTierFor<T extends string>(ladder: TierLadder<T>, wager: number): T {
  return ladder.tiers[ladder.minTierByPressure[stakePressure(wager)]];
}

export function tierAllowedFor<T extends string>(ladder: TierLadder<T>, tier: T, wager: number): boolean {
  const index = ladder.tiers.indexOf(tier);
  return index >= ladder.minTierByPressure[stakePressure(wager)];
}
