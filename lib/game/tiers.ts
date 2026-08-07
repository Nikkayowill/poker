/**
 * The stakes ladder, low to high, and the single source of truth for it.
 *
 * Everything else here is derived: `StakesTier` is this tuple's member type,
 * and `TIER_CONFIG` is a `Record` over it, so adding a rung fails to compile
 * until it has a config. Request validation derives from it too --
 * `z.enum(STAKES_TIERS)` in the routes rather than a hand-written list, which
 * is why the tuple is `as const`. Four routes used to restate these eight
 * strings inline; a ninth tier would have been silently rejected by all of
 * them while the lobby happily offered it.
 *
 * Order is meaningful: the UI renders the ladder in this order.
 */
export const STAKES_TIERS = ["1k", "5k", "10k", "25k", "50k", "100k", "250k", "500k"] as const;

export type StakesTier = (typeof STAKES_TIERS)[number];

export interface TierConfig {
  label: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
}

/**
 * Every table is a fixed buy-in now, not a range: minBuyIn === maxBuyIn for
 * every tier, one stakes level per rung of the ladder. clampBuyIn still
 * takes a range so every existing call site keeps working unchanged -- it
 * just always clamps to that one number now.
 */
export const TIER_CONFIG: Record<StakesTier, TierConfig> = {
  "1k": { label: "1,000", smallBlind: 5, bigBlind: 10, minBuyIn: 1000, maxBuyIn: 1000 },
  "5k": { label: "5,000", smallBlind: 25, bigBlind: 50, minBuyIn: 5000, maxBuyIn: 5000 },
  "10k": { label: "10,000", smallBlind: 50, bigBlind: 100, minBuyIn: 10000, maxBuyIn: 10000 },
  "25k": { label: "25,000", smallBlind: 125, bigBlind: 250, minBuyIn: 25000, maxBuyIn: 25000 },
  "50k": { label: "50,000", smallBlind: 250, bigBlind: 500, minBuyIn: 50000, maxBuyIn: 50000 },
  "100k": { label: "100,000", smallBlind: 500, bigBlind: 1000, minBuyIn: 100000, maxBuyIn: 100000 },
  "250k": { label: "250,000", smallBlind: 1250, bigBlind: 2500, minBuyIn: 250000, maxBuyIn: 250000 },
  "500k": { label: "500,000", smallBlind: 2500, bigBlind: 5000, minBuyIn: 500000, maxBuyIn: 500000 },
};

/** The cheapest seat in the house -- the eligibility bar for the backstop grant and the default tier for a fresh session. */
export const CHEAPEST_TIER: StakesTier = "1k";

export function isStakesTier(value: unknown): value is StakesTier {
  return typeof value === "string" && value in TIER_CONFIG;
}

export function clampBuyIn(tier: StakesTier, amount: number): number {
  const config = TIER_CONFIG[tier];
  if (!Number.isFinite(amount)) return config.minBuyIn;
  return Math.min(config.maxBuyIn, Math.max(config.minBuyIn, Math.round(amount)));
}
