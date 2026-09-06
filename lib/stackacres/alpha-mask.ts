/**
 * Alpha hit-masking: the pure half of "did that finger land on the plant, or
 * on the transparent air in the corner of its box".
 *
 * WHY THIS EXISTS. `stackacres-scene.ts`'s `unitAt` resolves a tap against a
 * sprite's `getBounds()`, which is an axis-aligned RECTANGLE around the whole
 * picture. That was fine when a crop was a few pixels of carrot top. It is not
 * fine now: `crop-visuals.ts` draws a mature frame at 4x, and the soil lattice
 * stands plants at a 14-unit column pitch, so a ripe plant's box overlaps most
 * of its neighbours' and a good half of that box is empty. A thumb landing in
 * the empty upper corner of one plant's box counted as touching its art, and an
 * art hit outranks a neighbour's ground hit -- so the plant the player was
 * squarely aiming at lost the tap to the transparent air above the one in
 * front. This module is what lets `unitAt` ask the texture instead of the box.
 *
 * PHASER-FREE ON PURPOSE, the same rule ./crop-visuals.ts and ./juice.ts state
 * at their own tops: vitest only reaches lib/ and app/. The canvas read itself
 * (one `getImageData` per texture, once) has to happen in the scene, because
 * only the scene has a texture manager; everything downstream of that read --
 * how the samples are reduced, how a screen point becomes a texture coordinate,
 * and what counts as opaque -- is arithmetic, and lives here where a test can
 * hold it to its values.
 *
 * A COARSE MASK, NOT A PER-PIXEL READ, and that is the whole "low overhead"
 * claim. Sampling the real texture at the exact pointer pixel would mean either
 * a `getImageData` per candidate per tap (a full canvas upload each time, on
 * the tap path, several times over) or keeping every crop texture's full RGBA
 * buffer alive. Instead each texture is reduced ONCE to an
 * `ALPHA_MASK_RESOLUTION`-square grid of bytes -- about a kilobyte per texture,
 * six textures for the whole crop roster -- and a tap is then an array index.
 *
 * Each cell holds the LARGEST alpha found under it, not the average. A max is
 * deliberately forgiving: a cell covering the thin edge of a leaf reads as
 * solid, so the mask never shrinks a target below what the player can see. It
 * only ever rejects a cell where the texture is empty EVERYWHERE under it,
 * which is exactly the transparent-corner case this exists for.
 */

/**
 * Below this fraction of full opacity a pixel is air, not art.
 *
 * 0.1 rather than 0: the crop sprites are baked through a canvas resampler at
 * high quality (see `bakeSpriteTexture`), and a resampler leaves a fringe of
 * 1-20/255 alpha well outside the drawn silhouette. Testing against zero would
 * treat that fringe as art and give back most of the empty corner this module
 * exists to reject.
 */
export const ALPHA_HIT_THRESHOLD = 0.1;

/**
 * Cells across the longest side of a mask.
 *
 * 32 is chosen against the thing being masked rather than as a round number: a
 * crop's painter box is 12 units wide, so a 32-cell grid is finer than one cell
 * per third of a world unit, which at every zoom this map allows is smaller
 * than the fingertip pad (`TAP_PAD`) the hit test already grows the target by.
 * Finer would refine a decision the pad has already blurred; coarser would
 * start clipping real leaf.
 */
export const ALPHA_MASK_RESOLUTION = 32;

export interface AlphaMask {
  readonly cols: number;
  readonly rows: number;
  /** `cols * rows`, row-major, each cell the largest alpha (0-255) found in
   *  the source pixels it covers. */
  readonly cells: Uint8Array;
}

/** A point inside a mask's own 0..1 texture space. */
export interface MaskPoint {
  readonly u: number;
  readonly v: number;
}

/** An axis-aligned screen-space box, matching the shape Phaser's own
 *  `GameObject.getBounds()` returns. Declared here rather than imported so
 *  this module stays free of a Phaser type. */
export interface MaskBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The grid one source texture reduces to: the longest side gets
 * `resolution` cells and the shorter side gets its proportional share, so a
 * tall crop frame's cells stay square rather than being stretched into
 * letterbox strips that would smear a leaf's edge sideways.
 */
export function alphaMaskGrid(
  width: number,
  height: number,
  resolution: number = ALPHA_MASK_RESOLUTION,
): { cols: number; rows: number } {
  if (width <= 0 || height <= 0) return { cols: 0, rows: 0 };
  const longest = Math.max(width, height);
  const cols = Math.max(1, Math.min(width, Math.round((width / longest) * resolution)));
  const rows = Math.max(1, Math.min(height, Math.round((height / longest) * resolution)));
  return { cols, rows };
}

/**
 * Reduces one texture's raw RGBA buffer to a mask.
 *
 * `rgba` is exactly what `CanvasRenderingContext2D.getImageData().data` hands
 * back -- four bytes per pixel, row-major, alpha last -- taken by the caller
 * once per texture and never held onto afterward. Every pixel is visited once;
 * at the crop textures' own sizes that is a few tens of thousands of reads, on
 * a path that runs once per texture for the life of the scene rather than once
 * per tap.
 *
 * A buffer too short for the stated size is treated as fully transparent from
 * the truncation onward rather than throwing: a mask is a hit-test refinement,
 * and the worst a wrong one does is fall back to the ground diamond, which is
 * the behaviour this whole module is an improvement on.
 */
export function buildAlphaMask(
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array,
  resolution: number = ALPHA_MASK_RESOLUTION,
): AlphaMask {
  const { cols, rows } = alphaMaskGrid(width, height, resolution);
  const cells = new Uint8Array(cols * rows);
  if (cols === 0 || rows === 0) return { cols, rows, cells };

  for (let py = 0; py < height; py += 1) {
    // Which cell row this pixel row falls in. Clamped rather than trusted:
    // `py / height` is < 1 for every real row, but the multiply is floating
    // point and the last row must not index one past the end.
    const cy = Math.min(rows - 1, Math.floor((py / height) * rows));
    const rowBase = cy * cols;
    const pixelBase = py * width * 4;
    for (let px = 0; px < width; px += 1) {
      const alphaIndex = pixelBase + px * 4 + 3;
      if (alphaIndex >= rgba.length) break;
      const alpha = rgba[alphaIndex];
      if (alpha === 0) continue;
      const cx = Math.min(cols - 1, Math.floor((px / width) * cols));
      const at = rowBase + cx;
      if (alpha > cells[at]) cells[at] = alpha;
    }
  }
  return { cols, rows, cells };
}

/**
 * Where a screen-space point sits inside a box, as 0..1 texture coordinates,
 * or null when it is outside the box entirely.
 *
 * `v` runs top-down to match an image buffer's own row order, which is also
 * the direction Phaser's bounds rectangle grows -- so a point's `v` indexes
 * straight into a mask row with no flip.
 */
export function boundsPoint(x: number, y: number, bounds: MaskBounds): MaskPoint | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const u = (x - bounds.x) / bounds.width;
  const v = (y - bounds.y) / bounds.height;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
  return { u, v };
}

/** The largest alpha under a texture-space point, 0..1. Zero outside the
 *  mask, so an out-of-range lookup reads as air rather than throwing. */
export function alphaMaskAt(mask: AlphaMask, u: number, v: number): number {
  if (mask.cols === 0 || mask.rows === 0) return 0;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const cx = Math.min(mask.cols - 1, Math.floor(u * mask.cols));
  const cy = Math.min(mask.rows - 1, Math.floor(v * mask.rows));
  return mask.cells[cy * mask.cols + cx] / 255;
}

/** Whether a texture-space point is on art rather than on air. The one
 *  question `unitAt` actually asks. */
export function alphaMaskCovers(
  mask: AlphaMask,
  u: number,
  v: number,
  threshold: number = ALPHA_HIT_THRESHOLD,
): boolean {
  return alphaMaskAt(mask, u, v) >= threshold;
}
