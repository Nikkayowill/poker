/**
 * Purchases the player cannot see the effect of yet.
 *
 * Each of these is priced, buyable and inert: the top-down world draws no
 * cutter swathe, no drone and no farmhand (see
 * components/arcade/stackacres-td/topdown-world.tsx, where those hooks are
 * named no-ops). A shop row that takes Gold for nothing is worse than a
 * missing one, so they come off the shelves until the thing they promise
 * exists.
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

export function isUnbuiltCutter(id: string): boolean {
  return UNBUILT_CUTTERS.includes(id);
}
