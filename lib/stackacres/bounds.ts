/**
 * The hard edge of the world: the rectangle the camera cannot scroll past.
 *
 * A separate module rather than living in ./world.ts or ./zones.ts: this
 * needs a VALUE import of ./zones's `ZONE_LIST` (every district's own
 * `bounds`), and both ./world.ts's and ./zones.ts's own doc comments are
 * explicit that a value import in that direction is exactly the cycle this
 * codebase has already been bitten by once -- ./zones.ts is imported BY
 * world.ts, so a runtime read of one of its consts from inside world.ts
 * would be read before zones.ts finished evaluating and throw. Sitting
 * above both avoids the question rather than tiptoeing around it: this
 * module imports zones.ts and iso.ts as values and world.ts only for types,
 * and nothing imports this module back.
 *
 * Two rects, not one: `worldBoundsRect` is the plain Cartesian rect (world
 * units, ./world.ts's own space) -- the one to test. `worldBoundsScreenRect`
 * is that same rect run through ./iso.ts's `projectedBounds`, which is what
 * `camera.setBounds()` actually wants, since every position the scene ever
 * hands the camera (`homeView`, `focusZone`, drag, glide) already lives in
 * projected screen space, never raw world units.
 */

import { WORLD_BOUND_MARGIN, type WorldRect } from "./world";
import { projectedBounds } from "./iso";
import { ZONE_LIST } from "./zones";

function unionRect(rects: readonly WorldRect[]): WorldRect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Every district's `bounds`, unioned and padded by `WORLD_BOUND_MARGIN` on
 * every side -- the world-unit rectangle the camera is allowed to look at.
 * Padded rather than the bare union so the boundary doesn't sit flush
 * against the outermost district's own edge: the margin is sized to leave a
 * ring or two of `chunkScenery`'s woodland standing between "the last thing
 * you own" and "the wall you can't cross".
 */
export function worldBoundsRect(): WorldRect {
  const union = unionRect(ZONE_LIST.map((zone) => zone.bounds));
  return {
    x: union.x - WORLD_BOUND_MARGIN,
    y: union.y - WORLD_BOUND_MARGIN,
    width: union.width + WORLD_BOUND_MARGIN * 2,
    height: union.height + WORLD_BOUND_MARGIN * 2,
  };
}

/** `worldBoundsRect()`, projected -- pass straight to
 *  `this.cameras.main.setBounds(x, y, width, height)`. */
export function worldBoundsScreenRect(): WorldRect {
  return projectedBounds(worldBoundsRect());
}
