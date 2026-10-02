/**
 * The pouch of wheat seed Ray hands a new player, once, so the first loop needs no shop.
 * Every other seed is Cora's, in the city (./seed-seller.ts).
 */

import type { StackAcresCrop } from "./catalogue";

export const STARTER_SEED_CROP: StackAcresCrop = "wheat";
export const STARTER_SEED_COUNT = 12;

/** The secret-ledger key the grant is claimed under. One claim per farm, for good. */
export const STARTER_SEEDS_LEDGER_KEY = "starter_seeds_claimed";
