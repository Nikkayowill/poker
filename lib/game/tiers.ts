export type StakesTier = "micro" | "mid" | "high";

export interface TierConfig {
  label: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}

/**
 * A player needs at least a tier's minBuyIn in Gold to join it at all; once
 * in, they pick their own buy-in anywhere in [minBuyIn, maxBuyIn] regardless
 * of their total balance -- a Gold-rich player can still sit Micro for
 * cheap, matching how real cash-game table stakes work.
 */
export const TIER_CONFIG: Record<StakesTier, TierConfig> = {
  micro: { label: "Micro", smallBlind: 10, bigBlind: 20, minBuyIn: 500, maxBuyIn: 2000 },
  mid: { label: "Mid", smallBlind: 50, bigBlind: 100, minBuyIn: 2500, maxBuyIn: 10000 },
  high: { label: "High", smallBlind: 200, bigBlind: 400, minBuyIn: 10000, maxBuyIn: 40000 },
};

export const STAKES_TIERS = Object.keys(TIER_CONFIG) as StakesTier[];

export function isStakesTier(value: unknown): value is StakesTier {
  return typeof value === "string" && value in TIER_CONFIG;
}

export function clampBuyIn(tier: StakesTier, amount: number): number {
  const config = TIER_CONFIG[tier];
  if (!Number.isFinite(amount)) return config.minBuyIn;
  return Math.min(config.maxBuyIn, Math.max(config.minBuyIn, Math.round(amount)));
}
