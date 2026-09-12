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
const FISH_WEIGHTS: Readonly<Record<FishSpecies, number>> = {
  bluegill: 60,
  trout: 30,
  catfish: 10,
};

/** Which fish a completed cast lands, weighted by `FISH_WEIGHTS`. Takes the
 *  RNG as a parameter so a test can hand it a fixed sequence instead of
 *  patching `Math.random`. */
export function pickCaughtFish(random: () => number = Math.random): FishSpecies {
  const roll = random() * 100;
  let acc = 0;
  for (const species of FISH_SPECIES) {
    acc += FISH_WEIGHTS[species];
    if (roll < acc) return species;
  }
  return FISH_SPECIES[FISH_SPECIES.length - 1];
}
