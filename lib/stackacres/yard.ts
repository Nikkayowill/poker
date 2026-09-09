/**
 * Where the Farmstead's yard sits on the map, as one offset.
 *
 * WHY THIS EXISTS. The 2026-09-07 map re-lay moved the Farmstead from the
 * world origin out to Riverside Village on Kayo's map proposal. Its rect did
 * not change shape -- it is the same 420x470 it has always been -- so the move
 * is a pure translation, and roughly sixty hand-placed literals inside it move
 * with it: the barn, the windmill, the scarecrow, the well, Grandfather Ray,
 * the midnight merchant's spot, the monk's shrine and post, the greenhouse
 * plot, the wheat field, the three hidden zones, the farmhand's base, the
 * contract drop, the lamp posts, the mailbox, the signpost, the stone wall,
 * and the whole pond with its dock, lilies, reeds, ripples and duck orbit.
 *
 * Adding 416 to sixty numbers by hand is exactly the shape of change that
 * hides a typo in a place no test looks (this codebase has been bitten by
 * hand-copied constants before -- STAKES_TIERS, the wager ladders, PEN_BLOCKS
 * against GROW_AREA). So the literals keep the values they have always had and
 * are wrapped in `yardPoint`/`yardRect` instead. Three things fall out of that
 * which are worth the module:
 *
 *   1. Every doc comment in those files that cites a number ("the barn's feet
 *      are on y 34", "the plot square is x 64..384") stays TRUE, because the
 *      number it names is still the number written there.
 *   2. The yard's internal geometry is verifiably rigid: nothing inside it can
 *      move with respect to anything else inside it, because there is one
 *      offset and every literal goes through it.
 *   3. The next time the Farmstead moves it is one constant, not sixty edits.
 *
 * A STRICT LEAF, and it has to stay that way. This module imports NOTHING.
 * ./world.ts, ./zones.ts, ./paths.ts, ./water.ts and ./props.ts are tangled in
 * a deliberate import cycle (see any of their headers: world.ts value-imports
 * zones.ts and paths.ts, and they may only type-import it back). A leaf with
 * no imports of its own can be value-imported from every one of them without
 * joining that cycle, the same position ./roads.ts and ./soil-tiers.ts already
 * hold.
 *
 * The offset itself is in world units, on ./world.ts's true Cartesian plane.
 * Nothing here knows about ./iso.ts's shear.
 */

/** A point in world units. Restated rather than imported from ./world.ts,
 *  which is the whole reason this module is a leaf; the shapes are structural
 *  and the two are assignable to each other. */
export interface YardPoint {
  x: number;
  y: number;
}

export interface YardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far the Farmstead's yard moved in the 2026-09-08 map restructure
 * (Kayo's "Chore Efficiency" layout, imported from the StackAcres Map
 * Restructure design project).
 *
 * Derived, not chosen: the yard's new rect is `FARM_ZONE` at
 * x -700, y -235, and its old one was x 20, y -60, so the delta is
 * (-700 - 20, -235 - (-60)) = (-720, -175). world.test.ts holds it to
 * `FARM_ZONE` so the two cannot drift apart.
 *
 * WHY THE MAP MOVED AGAIN, TWICE. The 2026-09-07 re-lay spread nine districts
 * (farmstead plus eight) across a roughly 1,900x1,950-unit world with a full
 * ring road, straight off Kayo's hand-drawn plan-view map -- every district a
 * real place, but a full chore circuit was a long drag of the camera. A first
 * pass that day pulled everything onto a tighter ring (~1,490x1,630) and kept
 * the ring topology. Kayo's follow-up asked for closer still, Farmville-
 * close: districts sharing a fence line rather than a walk apart. This pass
 * abandons the ring outright for a hub-and-spoke network radiating from the
 * yard -- every district touches its neighbour with the same ~24-unit gap
 * `zones.test.ts` holds as the floor -- which is what actually shrinks the
 * footprint, not a shorter road. Same nine ids, same sizes throughout: only
 * positions and the road graph connecting them changed. `WORLD_BOUND_MARGIN`
 * and `STACKACRES_ZOOM_MIN` in ./world.ts were retuned alongside the first
 * pass and hold for this one too.
 *
 * Both components are multiples of 8, which keeps every yard literal that was
 * on an 8-unit boundary on one afterwards. It is deliberately NOT a multiple
 * of `SOIL_TILE` (64), and it does not need to be: no soil bed has ever been
 * placeable in the Farmstead, so nothing on that lattice moves with the yard.
 */
export const YARD_DELTA: YardPoint = { x: -720, y: -175 };

/** A yard literal, moved. Pass the number the yard was originally laid out
 *  with; the offset is applied here and nowhere else. */
export function yardPoint(x: number, y: number): YardPoint {
  return { x: x + YARD_DELTA.x, y: y + YARD_DELTA.y };
}

/** The rect form. Width and height are untouched: this is a translation, and
 *  a yard rect that changed size would not be one. */
export function yardRect(x: number, y: number, width: number, height: number): YardRect {
  return { x: x + YARD_DELTA.x, y: y + YARD_DELTA.y, width, height };
}

/** Moves a whole run of yard literals at once -- the lily pads, the reeds, the
 *  ripple spots, the seventeen props. Same offset, applied per entry. */
export function yardPoints<T extends YardPoint>(points: readonly T[]): T[] {
  return points.map((p) => ({ ...p, x: p.x + YARD_DELTA.x, y: p.y + YARD_DELTA.y }));
}

/**
 * The Crop Fields' own ground -- what "the Grand Farm" was before the
 * 2026-09-08 map restructure merged it into the Farmstead district outright
 * (one district, one id, no fence between them; see ./zones.ts and
 * ./world.ts's own headers). Kept exactly where the Grand Farm always sat
 * (512 square, at the map's centre): expressed as a yard literal, the same
 * as the barn or the pond, so it moves rigidly with the yard if the
 * Farmstead is ever relaid again, rather than staying pinned to an absolute
 * point the rest of the district has moved away from.
 *
 * A STRICT LEAF export, same as `YARD_DELTA` itself -- both world.ts and
 * zones.ts value-import this constant directly (each restates `FARM_ZONE`/
 * `STACKACRES_ZONES.farmstead.bounds` as the union of this rect and the
 * yard's own `yardRect(20, -60, 420, 470)`, for the identical cross-module
 * cycle reason `FARM_ZONE` was always restated as a literal in zones.ts --
 * see that pair's own comments; zones.test.ts holds the two rects equal).
 * Still gated: unlocking it costs Gold and requires units owned, exactly as
 * clearing the old `meadow` sector did -- see ./crop-fields.ts, which is
 * where that check now lives, decoupled from the district/sector system
 * entirely now that the Crop Fields are not a district of their own.
 */
export const CROP_FIELD: YardRect = yardRect(464, -81, 512, 512);
