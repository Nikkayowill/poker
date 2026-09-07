/**
 * Town Favor: what cumulative Town Influence (./town.ts) is actually for.
 *
 * Influence itself stays exactly what town.ts already documents -- additive
 * only, never spent, never capped. This module does not change that; it is
 * a pure READ over the same running total, the same posture ./shop-locks.ts
 * already takes for `town_trusted`. What's new is that the read is no
 * longer a single ">0" boolean: the ladder below has several rungs, each
 * one a permanent discount at Ray's shop once cumulative Influence clears
 * its threshold.
 *
 * PERMANENT AND MONOTONE, same rule shop-locks.ts states for its own flags:
 * Influence never spends down, so a discount rung, once reached, can never
 * be lost. That is what makes it safe to build a price on -- a discount
 * that could regress mid-session would be a worse shop experience than no
 * discount at all.
 *
 * DISCOUNT IS BASIS POINTS, NOT A FLOAT PERCENTAGE, for the same reason
 * every Gold amount in this app is an integer: floating-point Gold is the
 * shape of bug ./contracts.ts's header exists to keep out. `applyDiscount`
 * floors the result and never lets a price reach 0 -- a free rung would
 * turn a Gold sink into a Gold-neutral loop, which is exactly what the
 * pricing rules elsewhere in this app (see contracts.ts, items.ts) exist to
 * prevent.
 */

export interface InfluenceTierDef {
  /** Cumulative Influence required to reach this rung. Rung 0 is always 0
   *  (every farm starts here) so the ladder has no gap a fresh profile could
   *  fall through. */
  readonly threshold: number;
  /** What the town calls a farm at this rung. Shown in the shop, not just a
   *  progress bar -- a rung is a status, not only a number. */
  readonly label: string;
  /** Discount off every Ray's-shop Gold price, in basis points (100 = 1%). */
  readonly discountBps: number;
}

/**
 * The ladder. Thresholds are sized off the Contract reward table
 * (./contracts.ts) -- a single low Flour contract clears rung 1 by itself,
 * but reaching the top rung wants a real run of higher contracts, so the
 * best discount stays a late-game thing rather than an early freebie.
 */
export const INFLUENCE_TIERS: readonly InfluenceTierDef[] = [
  { threshold: 0, label: "New Face", discountBps: 0 },
  { threshold: 25, label: "Familiar Face", discountBps: 300 },
  { threshold: 100, label: "Trusted Supplier", discountBps: 600 },
  { threshold: 300, label: "Town Favorite", discountBps: 1_000 },
  { threshold: 750, label: "Local Legend", discountBps: 1_500 },
] as const;

/** The highest rung `total` cumulative Influence has reached. Never null --
 *  rung 0 always qualifies, so a fresh profile (0 Influence) resolves to
 *  "New Face" rather than to nothing. */
export function influenceTier(total: number): InfluenceTierDef {
  let current = INFLUENCE_TIERS[0];
  for (const tier of INFLUENCE_TIERS) {
    if (total >= tier.threshold) current = tier;
  }
  return current;
}

/** The next rung this farm has not reached, or null while already at the
 *  top of the ladder. What a progress readout points at next. */
export function nextInfluenceTier(total: number): InfluenceTierDef | null {
  return INFLUENCE_TIERS.find((tier) => total < tier.threshold) ?? null;
}

/**
 * `price` after this farm's current discount, floored to a whole Gold and
 * never below 1 -- see the header on why a discount may shrink a price but
 * must never zero it out.
 */
export function applyInfluenceDiscount(price: number, total: number): number {
  const bps = influenceTier(total).discountBps;
  if (bps <= 0) return price;
  const discounted = Math.floor((price * (10_000 - bps)) / 10_000);
  return Math.max(1, discounted);
}
