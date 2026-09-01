import { HOMESTEAD_GRID_PLOTS } from "@/lib/homestead/catalogue";

/**
 * The one source of truth for where a plot sits on the diorama, shared by
 * the Phaser scene (which draws there) and the DOM overlay (which puts a
 * real, focusable button there). The stage has a fixed logical size and the
 * shell gives its container the same aspect ratio, so Phaser's FIT scaling
 * and CSS percentage positioning land on identical spots without either
 * side asking the other where anything is.
 *
 * Deliberately free of any Phaser import: homestead-farm.tsx reads this for
 * the overlay, and Phaser must only ever enter the browser through
 * homestead-canvas.tsx's dynamic import.
 */

export const HOMESTEAD_STAGE_W = 720;
/**
 * Cropped tight to the art: the grid spans y ~30 (a ripe tower's glow above
 * row 0) to ~441 (row 3's extruded south edge), so 470 leaves balanced
 * margins where 540 wasted ~30% of every viewport's height on empty stage
 * (found by the mobile review). 50-mint.css's aspect-ratio must match.
 */
export const HOMESTEAD_STAGE_H = 470;

/** Half-extents of a tile diamond, in stage pixels. */
export const HOMESTEAD_TILE_HALF_W = 66;
export const HOMESTEAD_TILE_HALF_H = 41;

/** Stage-pixel step between grid neighbours, slightly over the tile size so seams show. */
const STEP_X = 74;
const STEP_Y = 47;

/**
 * Half-extents of a tile's TAP diamond. Full grid-step sized, so the
 * overlay's diamonds tessellate with no dead seams between tiles and each
 * target is ~12% larger than the painted tile -- on a portrait phone the
 * painted diamond alone dips under the 44px touch guideline.
 */
export const HOMESTEAD_TAP_HALF_W = STEP_X;
export const HOMESTEAD_TAP_HALF_H = STEP_Y;

/** Where the diamond grid's row-0/col-0 corner tile centers. */
const ORIGIN_X = HOMESTEAD_STAGE_W / 2;
const ORIGIN_Y = 108;

/** Center of plot `plotIndex` (1-based, row-major 4x4) in stage pixels. */
export function plotCenter(plotIndex: number): { x: number; y: number } {
  const col = (plotIndex - 1) % 4;
  const row = Math.floor((plotIndex - 1) / 4);
  return {
    x: ORIGIN_X + (col - row) * STEP_X,
    y: ORIGIN_Y + (col + row) * STEP_Y,
  };
}

/** Every plot index in paint order (back row first, so nearer tiles draw over). */
export function plotPaintOrder(): number[] {
  return Array.from({ length: HOMESTEAD_GRID_PLOTS }, (_, i) => i + 1).sort(
    (a, b) => plotCenter(a).y - plotCenter(b).y,
  );
}
