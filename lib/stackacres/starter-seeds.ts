/**
 * The pouch of carrot seed Ray hands a new player, once, so the first loop needs no shop.
 * Wheat arrives as the reward for Ray's first quest; later crop seeds open
 * through buildings and the seed seller (./seed-seller.ts).
 */

import type { StackAcresCrop } from "./catalogue";

export const STARTER_SEED_CROP: StackAcresCrop = "carrot";
export const STARTER_SEED_COUNT = 3;

/** The secret-ledger key the grant is claimed under. One claim per farm, for good. */
export const STARTER_SEEDS_LEDGER_KEY = "starter_seeds_claimed";
