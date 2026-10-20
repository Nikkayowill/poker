/**
 * Cora sells seed at the market in the city. The barn no longer does.
 *
 * She is one of the city's standing townsfolk (art/stackacres-td/areas/rig/city.py), picked because she
 * already stands at the market stalls. Seeds stay bought through the `buy-seed` action and the
 * ./seed-unlocks.ts gates; only where the player buys them has moved.
 */

export const SEED_SELLER = "cora";
export const SEED_SELLER_NAME = "Cora";

/** Where the Next panel and Ray's welcome send a player who needs seed. */
export const SEED_SELLER_WHERE = "the market in town, over the west bridge";
