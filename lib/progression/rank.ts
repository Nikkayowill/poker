/**
 * Player rank: a ladder of named tiers, from Bronze to GOAT.
 *
 * There are no levels. A player's rank points (see lib/progression/
 * solo-earnings.ts) place them on one of eight tiers, and the tier is the whole
 * readout. Pure and closed-form: nothing here reads a clock, a database or a
 * random number. It lives in lib/ because vitest.config.ts collects only lib/
 * and app/.
 *
 * Reaching a tier for the first time pays its Gold, once ever. The Gold is a
 * faucet against what a real-money Gold purchase is worth, so the table below
 * adds up to about what the old every-fifth-level milestones paid over the same
 * climb. Rank names and jewels cost the economy nothing.
 */

/**
 * Gold wagered per point of XP.
 *
 * XP is lifetime staking volume and does not move rank. It is still counted,
 * so the conversion stays.
 */
export const GOLD_PER_XP = 10;

/** XP earned by staking `gold`. Fractions are dropped; a stake never costs XP. */
export function xpForWager(gold: number): number {
  if (!Number.isFinite(gold) || gold <= 0) return 0;
  return Math.floor(gold / GOLD_PER_XP);
}

/**
 * The ladder, low to high. `from` is the rank points at which a tier starts and
 * `rewardGold` is paid the first time a player reaches it. GOAT is the top.
 *
 * Gold the currency is not a tier, on purpose: "Gold tier, Gold reward" reads
 * as a typo.
 *
 * A readonly tuple, like STAKES_TIERS in lib/game/tiers.ts, so the ids and the
 * `RankTierId` union come from this one table.
 */
export const RANK_TIERS = [
  { id: "bronze", name: "Bronze", from: 0, rewardGold: 0 },
  { id: "silver", name: "Silver", from: 2_500, rewardGold: 1_500 },
  { id: "platinum", name: "Platinum", from: 15_000, rewardGold: 3_000 },
  { id: "emerald", name: "Emerald", from: 50_000, rewardGold: 10_000 },
  { id: "diamond", name: "Diamond", from: 125_000, rewardGold: 25_000 },
  { id: "master", name: "Master", from: 300_000, rewardGold: 40_000 },
  { id: "grandmaster", name: "Grandmaster", from: 600_000, rewardGold: 75_000 },
  { id: "goat", name: "GOAT", from: 1_000_000, rewardGold: 100_000 },
] as const;

export type RankTierId = (typeof RANK_TIERS)[number]["id"];

export interface RankTier {
  /** 1 for Bronze up to RANK_TIERS.length for GOAT. Stored as the "rewarded up to" mark. */
  number: number;
  id: RankTierId;
  name: string;
  from: number;
  rewardGold: number;
}

/** Tier numbers run 1..TOP_TIER; 1 is where everyone starts. */
export const TOP_TIER = RANK_TIERS.length;

/** The tier with this 1-based number, clamped onto the ladder. */
export function tierByNumber(number: number): RankTier {
  const at = Math.min(TOP_TIER, Math.max(1, Math.floor(Number.isFinite(number) ? number : 1)));
  const entry = RANK_TIERS[at - 1];
  return { number: at, id: entry.id, name: entry.name, from: entry.from, rewardGold: entry.rewardGold };
}

/** The tier a rank-points total sits on. */
export function tierForPoints(points: number): RankTier {
  let number = 1;
  if (Number.isFinite(points)) {
    RANK_TIERS.forEach((tier, index) => {
      if (points >= tier.from) number = index + 1;
    });
  }
  return tierByNumber(number);
}

export interface RankProgress {
  /** Rank points: solo wager wins, weighted by stake band. */
  points: number;
  tier: RankTier;
  /** The tier above, or null at GOAT. */
  nextTier: RankTier | null;
  /** Points earned since this tier began. Always 0 at GOAT. */
  intoTier: number;
  /** Points this tier spans. 0 at GOAT, so a bar can render full rather than divide by it. */
  tierSpan: number;
  /** Points still needed for the next tier, or null at GOAT. */
  toNext: number | null;
  /** 0..1 through the current tier. Exactly 1 at GOAT. */
  ratio: number;
}

/** Everything a rank readout needs, derived from one number. */
export function rankProgress(points: number): RankProgress {
  const safe = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  const tier = tierForPoints(safe);
  const nextTier = tier.number < TOP_TIER ? tierByNumber(tier.number + 1) : null;
  const tierSpan = nextTier ? nextTier.from - tier.from : 0;
  const intoTier = nextTier ? safe - tier.from : 0;

  return {
    points: safe,
    tier,
    nextTier,
    intoTier,
    tierSpan,
    toNext: nextTier ? nextTier.from - safe : null,
    ratio: nextTier ? Math.min(1, intoTier / tierSpan) : 1,
  };
}

export interface TierReward {
  tier: RankTier;
  gold: number;
}

/**
 * Every tier crossed going from `fromTier` up to `toTier`, each with its Gold.
 *
 * Plural because one big win can jump several tiers, and each has to pay. Empty
 * when nothing was crossed. Rank only climbs now, but a lower `toTier` still
 * pays nothing and takes nothing back.
 */
export function rewardsBetween(fromTier: number, toTier: number): TierReward[] {
  const rewards: TierReward[] = [];
  for (let number = Math.floor(fromTier) + 1; number <= Math.min(TOP_TIER, Math.floor(toTier)); number += 1) {
    const tier = tierByNumber(number);
    rewards.push({ tier, gold: tier.rewardGold });
  }
  return rewards;
}

/** Total Gold owed for climbing from one tier to another. */
export function goldForTierUps(fromTier: number, toTier: number): number {
  return rewardsBetween(fromTier, toTier).reduce((sum, reward) => sum + reward.gold, 0);
}
