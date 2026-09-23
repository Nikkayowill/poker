/**
 * Whether a bed reads wet, and the tint that says so.
 *
 * Stardew darkens a square the instant you water it, and that one change is
 * most of what makes watering feel like an act rather than a chore ticked
 * off a list: you can see, from across the farm, which rows you have already
 * done. StackAcres already knows which crops have water in them -- a thirsty
 * one is `dry` and flies the water cue -- so this needs no new column, no new
 * action and no new art. Soil is drawn per tile (`soil_<tier>_<mask>`) and
 * already takes a tint; that is how a bean-fed bed reads greener.
 *
 * It costs nothing at the server either, and it is optimistic for free:
 * `optimisticallyWateredUnit` moves the crop off `dry` the moment the can is
 * tipped, so the ground darkens under the farmer's feet before the write
 * lands, the same posture every other farm action takes.
 *
 * Pure, and here rather than in the scene, because the table below IS the
 * feature and a Phaser renderer is the one place it cannot be tested.
 */

import type { StackAcresUnitState } from "./units";

/** Phaser's "no tint": every channel full, so the art draws as painted. */
export const NO_TINT = 0xffffff;

/** A bean-fed bed reads a touch greener until the next crop spends it. */
export const ENRICHED_SOIL_TINT = 0xd6f0b4;

/**
 * Watered ground: the same dirt, a shade browner. A bed is the road's own
 * tan dirt now (art/stackacres-td/rich/lpc_ground.py's `bed_tile`), and the
 * old tint -- tuned for the dark beds that came before -- turned that grey,
 * which read as a shadow falling on it. This one keeps the warmth and only
 * pulls the green and blue down, so wet earth reads as damp soil. Slight on
 * purpose, and still plain from a few squares away.
 */
export const WET_SOIL_TINT = 0xc09b78;

/** As much of a bed's occupant as moisture cares about. */
export interface BedOccupant {
  state: StackAcresUnitState;
}

/**
 * Whether this bed's ground is wet right now.
 *
 * A bare bed is dry: nothing has been watered on it, and there is no watering
 * a bed with nothing in it (water is a unit action). `dry` is the thirsty
 * crop, which is also how sown-but-never-watered seed arrives here -- see
 * `isUnwateredSeedRow`, whose whole point is that such a crop starts thirsty,
 * so its square stays pale until the first can is tipped over it. `mucked` is
 * a crop that withered from drought, so its ground is dry by definition.
 *
 * Everything else -- growing, ripe, and livestock, which never goes dry --
 * reads wet. A ripe crop left standing keeps its watered square until it is
 * collected, which is Stardew's own behaviour and spares the player a patch
 * that pales for no reason they did anything about.
 */
export function bedIsWet(unit: BedOccupant | null): boolean {
  if (!unit) return false;
  return unit.state !== "dry" && unit.state !== "mucked";
}

/**
 * Two tints as one. Phaser multiplies a tint into the art channel by channel,
 * so stacking two of them is that same multiply done once, and blending here
 * rather than storing a fourth constant keeps the enriched green and the wet
 * darkening from drifting apart when either is retuned.
 */
export function blendTints(a: number, b: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const channel = Math.round((((a >> shift) & 0xff) * ((b >> shift) & 0xff)) / 0xff);
    out |= channel << shift;
  }
  return out;
}

/** What to tint a soil tile, given what is true of it. */
export function soilTint(bed: { enriched: boolean; wet: boolean }): number {
  const base = bed.enriched ? ENRICHED_SOIL_TINT : NO_TINT;
  return bed.wet ? blendTints(base, WET_SOIL_TINT) : base;
}

/** How far a crop has grown before its seeds give way to the first green. */
export const SEEDS_UNTIL_PROGRESS = 0.2;

/**
 * Whether a crop still reads as seed pressed into the ground.
 *
 * From the moment it is sown, through its first watering, until it is a fifth
 * of the way grown: long enough that watering a freshly planted square shows
 * the earth darken under seeds the player can still see, short enough that
 * the sprout arrives while they are still watching. A crop that goes thirsty
 * part-way through growing is a plant by then, not seed, so it stays a plant.
 */
export function showsSeeds(unit: { state: StackAcresUnitState; progress: number | null }): boolean {
  if (unit.state === "ready" || unit.state === "mucked") return false;
  return (unit.progress ?? 0) < SEEDS_UNTIL_PROGRESS;
}
