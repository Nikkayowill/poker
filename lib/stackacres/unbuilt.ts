/**
 * Purchases the player cannot see the effect of yet.
 *
 * Each of these is priced, buyable and inert: the top-down world draws no
 * cutter swathe, no drone and no farmhand (see
 * components/arcade/stackacres-td/topdown-world.tsx, where those hooks are
 * named no-ops), and nothing anywhere reads a Midnight Merchant trinket. A
 * shop row that takes Gold for nothing is worse than a missing one, so they
 * come off the shelves until the thing they promise exists.
 *
 * A READ-SIDE FILTER ONLY, the same posture ./scope.ts takes: nothing is
 * deleted, no migration is needed, and a player who already owns one keeps it
 * and keeps whatever it does. Delete an entry here the day its effect lands.
 */

/** Cutters, all of them: the live world draws no mowing at all, and the
 *  scythe is not even on the tool belt, so the shop's whole "Cut the Grass"
 *  shelf promises something that cannot happen. The Scythe is still the
 *  starting cutter in the data, which is untouched. */
export const UNBUILT_CUTTERS: readonly string[] = ["scythe", "mower"];

/** Perks whose effect nothing reads. Automated Logistics speeds a farmhand,
 *  and the live world has no farmhand. */
export const UNBUILT_PERKS: readonly string[] = ["automated_logistics"];

/** Enchantments whose effect nothing reads. Quickened Haft lengthens a
 *  scythe's reach, and the scythe is not on the belt. */
export const UNBUILT_ENCHANTMENTS: readonly string[] = ["quickened_haft"];

/** Midnight Merchant trinkets with no consumer anywhere. */
export const UNBUILT_MERCHANT_ITEMS: readonly string[] = [
  "gilded_scarecrow",
  "lucky_horseshoe",
  "moonlit_lantern",
];

/** The Forage Drone: buyable at 1.2M, and its hangar and forage hooks are
 *  no-ops, so it can never bring anything back. */
export const DRONE_IS_UNBUILT = true;

export function isUnbuiltCutter(id: string): boolean {
  return UNBUILT_CUTTERS.includes(id);
}

export function isUnbuiltPerk(id: string): boolean {
  return UNBUILT_PERKS.includes(id);
}

export function isUnbuiltEnchantment(id: string): boolean {
  return UNBUILT_ENCHANTMENTS.includes(id);
}

export function isUnbuiltMerchantItem(id: string): boolean {
  return UNBUILT_MERCHANT_ITEMS.includes(id);
}
