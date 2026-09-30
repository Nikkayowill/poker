/**
 * The pond's three catchable fish, and which one a cast lands.
 *
 * Pure: which fish you get is the server's call (`catchStackAcresFish` in
 * lib/server/stackacres-service.ts calls `pickCaughtFish`), never the
 * client's -- the drag-in/drag-out gesture in
 * components/arcade/stackacres/stackacres-fishing-affordance.tsx decides
 * WHEN a cast lands, not WHAT it lands. Naming, icon and sell price live
 * with every other inventory item in ./machine-items.ts, the one place that
 * catalogue is kept.
 */

export const FISH_SPECIES = ["bluegill", "trout", "catfish"] as const;

export type FishSpecies = (typeof FISH_SPECIES)[number];

export function isFishSpecies(value: string): value is FishSpecies {
  return (FISH_SPECIES as readonly string[]).includes(value);
}

/** Out of 100: bluegill common, trout a fair catch, catfish the rare one --
 *  the same three-tier common/uncommon/rare feel the Vat's aging tiers
 *  already use elsewhere in StackAcres. */
export const FISH_WEIGHTS: Readonly<Record<FishSpecies, number>> = {
  bluegill: 60,
  trout: 30,
  catfish: 10,
};

/** Out of 100, with a radish on the hook: the rarer fish come up more often. */
export const BAIT_FISH_WEIGHTS: Readonly<Record<FishSpecies, number>> = {
  bluegill: 30,
  trout: 45,
  catfish: 25,
};

/**
 * How well the cast was thrown, from its power bar (0 to 1): how far out the
 * float landed. Stardew's rule, farther from the bank is better water
 * (FishingRod.cs `clearWaterDistance` feeds its fish and quality rolls).
 */
export type CastTier = "short" | "mid" | "long" | "perfect";

/** Power at or above this is a perfect cast: the very top of the bar, a window of about 60ms. */
export const PERFECT_CAST = 0.97;

export function castTier(power: number): CastTier {
  if (power >= PERFECT_CAST) return "perfect";
  if (power >= 0.75) return "long";
  if (power >= 0.35) return "mid";
  return "short";
}

/**
 * Out of 100, per cast tier, without and with a radish on the hook. A mid cast
 * keeps the odds fishing always had (`FISH_WEIGHTS`, `BAIT_FISH_WEIGHTS`); a
 * short one lands near the bank with the small fry, and a long or perfect one
 * reaches the deeper water the rarer fish keep to.
 */
export const CAST_FISH_WEIGHTS: Readonly<Record<CastTier, { readonly plain: Readonly<Record<FishSpecies, number>>; readonly bait: Readonly<Record<FishSpecies, number>> }>> = {
  short: { plain: { bluegill: 75, trout: 22, catfish: 3 }, bait: { bluegill: 45, trout: 40, catfish: 15 } },
  mid: { plain: FISH_WEIGHTS, bait: BAIT_FISH_WEIGHTS },
  long: { plain: { bluegill: 50, trout: 35, catfish: 15 }, bait: { bluegill: 22, trout: 48, catfish: 30 } },
  perfect: { plain: { bluegill: 40, trout: 40, catfish: 20 }, bait: { bluegill: 15, trout: 45, catfish: 40 } },
};

/** What a cast can put on the hook. One is spent per baited cast. */
export const FISHING_BAIT_ITEM = "radish";

/** Which fish a completed cast lands, weighted by how far out it was thrown
 *  (`CAST_FISH_WEIGHTS`) and whether it was baited. Takes the RNG as a
 *  parameter so a test can hand it a fixed sequence instead of patching
 *  `Math.random`. */
export function pickCaughtFish(random: () => number, bait: boolean, cast: CastTier): FishSpecies {
  const weights = CAST_FISH_WEIGHTS[cast][bait ? "bait" : "plain"];
  const roll = random() * 100;
  let acc = 0;
  for (const species of FISH_SPECIES) {
    acc += weights[species];
    if (roll < acc) return species;
  }
  return FISH_SPECIES[FISH_SPECIES.length - 1];
}
