/**
 * The lake's moving film of light and its foam (components/arcade/stackacres-td/water-film.ts): the
 * timing, and the layout of the pictures the art pipeline draws for it.
 *
 * Both follow Stardew Valley's own water, measured 2026-09-23: a film of ten frames at 200 ms that drifts
 * slowly up (on its farm, one 16 px square every ~10.7 s), laid on at about 42%, and a dashed foam line
 * round the shore whose two sets of dashes take turns once a second.
 *
 * The sheet's numbers must match art/stackacres-td/rich/water_film.py, which draws it; water.test.ts
 * reads the exported picture to hold them together.
 */

/** Frames in the film's loop, and how long each shows. */
export const FILM_FRAMES = 10;
export const FILM_FRAME_MS = 200;
/** One frame's square, in ground-picture px (two per map unit). The pattern repeats at this size. */
export const FILM_SIZE = 128;
/** Frames across the sheet; the rest wrap onto the next row. */
export const FILM_COLUMNS = 5;
/** How strongly the film is laid over the water. */
export const FILM_OPACITY = 0.42;
/** How long the film takes to drift up one ground-picture px: Stardew's farm pace (16 art px in ~10.7 s,
 *  so 32 of ours). */
export const FILM_DRIFT_MS = 333;
/** How long each set of foam dashes shows before the other takes over. */
export const FOAM_SWAP_MS = 1000;

/** Where an area's water mask lies on the map, in map units. The mask picture is twice this in px. */
export interface WaterSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which of the film's frames shows at `ms`. */
export function filmFrame(ms: number): number {
  return Math.floor(ms / FILM_FRAME_MS) % FILM_FRAMES;
}

/** How far the film has drifted up at `ms`, in whole ground-picture px, wrapped to its repeat. */
export function filmDrift(ms: number): number {
  return Math.floor(ms / FILM_DRIFT_MS) % FILM_SIZE;
}

/** Which set of foam dashes shows at `ms`: 1 or 2, as the mask numbers them. */
export function foamSet(ms: number): 1 | 2 {
  return Math.floor(ms / FOAM_SWAP_MS) % 2 === 0 ? 1 : 2;
}

/** The film sheet's size in px: FILM_COLUMNS frames across, as many rows as the rest need. */
export function filmSheetSize(): { width: number; height: number } {
  return { width: FILM_COLUMNS * FILM_SIZE, height: Math.ceil(FILM_FRAMES / FILM_COLUMNS) * FILM_SIZE };
}
