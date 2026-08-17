/**
 * Which renderer draws the table.
 *
 * The table room mounts inside
 * `.table-area` as the first child, both report through a single
 * `onReady(boolean)`, and `.scene-lit` — which stops the DOM felt and rail
 * painting — is applied from that one signal for either. Everything else at
 * the table (nameplates, hole cards, the board, the action bar, the feed, the
 * turn-clock fuse, every sound) is DOM above the canvas and does not know or
 * care which room is underneath it.
 *
 * The 2.5D racetrack is the only shipped table. The legacy renderer values are
 * still accepted as wire/storage values so an older browser preference cannot
 * bring the removed Classic or 3D rooms back.
 *
 * In `lib/` rather than beside either renderer because `vitest.config.ts`
 * collects only `lib/` and `app/` — the same reason `bet-style.ts`, whose
 * shape this follows exactly, lives there.
 */

export type TableRenderer = "canvas_2d" | "webgl_3d" | "racetrack_2d5";

export const TABLE_RENDERERS: readonly TableRenderer[] = ["racetrack_2d5"];

/**
 * Temporary kill switch for the 3D room while it's being reworked. Flip back
 * to `true` to bring it back -- everything downstream (resolveTableRenderer,
 * nextTableRenderer, the default preference, the buy-in picker) reads this
 * one flag rather than needing to be individually re-enabled.
 */
export const TABLE_RENDERER_3D_ENABLED = false;

/**
 * The 2.5D racetrack room -- a third Canvas-2D table, drawn from a real
 * perspective camera instead of the classic room's orthographic tilt.
 *
 * A third entry rather than a replacement for `canvas_2d`, deliberately and
 * for now. `canvas_2d` is not just a preference: it is what
 * `resolveTableRenderer` falls back to when a browser cannot give us a WebGL
 * context, so it is the table that has to work when nothing else does.
 * Replacing it with a room whose composition has not yet been judged in a
 * live hand would mean a bug at some untested breakpoint leaves those players
 * with no working table at all. Promote it once it has been seen in real
 * hands -- at which point this becomes what `canvas_2d` draws and the entry
 * goes away again.
 */
export const RACETRACK_RENDERER: TableRenderer = "racetrack_2d5";

/** See the header: use the animated room whenever the browser supports it
 * and the 3D room isn't disabled (see TABLE_RENDERER_3D_ENABLED above). */
export const DEFAULT_TABLE_RENDERER: TableRenderer = RACETRACK_RENDERER;

/** Same `stackchips:` namespace as the sound, music and bet-style preferences. */
export const TABLE_RENDERER_STORAGE_KEY = "stackchips:table-renderer";

/** A stored or wire value, coerced to a real renderer. Anything else is the default. */
export function normalizeTableRenderer(value: unknown): TableRenderer {
  return value === RACETRACK_RENDERER ? RACETRACK_RENDERER : DEFAULT_TABLE_RENDERER;
}

/**
 * The next renderer in the cycle, for a single menu entry that toggles through.
 *
 * Skips the 3D room where the browser cannot render it. Without that, a
 * device with no WebGL context has a menu entry that appears to do nothing
 * every third tap: the preference genuinely changes, and
 * `resolveTableRenderer` genuinely sends it straight back to the classic
 * table, so the label reads "Table: Classic" twice in a row. That used to be
 * unreachable because the entry was hidden outright without WebGL -- which it
 * no longer is, since the racetrack room needs only a 2D context and there
 * are now two usable tables on such a device.
 *
 * The preference itself is never coerced here, only the step: a player who
 * chose the 3D room on one device still gets it on another that can render it.
 */
export function nextTableRenderer(
  renderer: TableRenderer,
  webglAvailable = true,
  landscape = true,
): TableRenderer {
  void renderer;
  void webglAvailable;
  void landscape;
  return RACETRACK_RENDERER;
}

/** What the table menu prints for each renderer. */
export function tableRendererLabel(renderer: TableRenderer): string {
  if (renderer === "webgl_3d") return "Table: 3D room";
  if (renderer === "racetrack_2d5") return "Table: 2.5D";
  return "Table: Classic";
}

/** True for the rooms that paint their own table rather than layering over
 * the DOM's CSS artwork. Both suppress the flat felt, rail and shadow; only
 * the 3D room also seats its own figures. */
export function rendererPaintsTable(renderer: TableRenderer): boolean {
  return renderer === "webgl_3d" || renderer === "racetrack_2d5";
}

/**
 * Can this browser actually give us a WebGL context?
 *
 * Asked before mounting the 3D room rather than discovered inside it. A
 * `<Canvas>` that cannot acquire a context throws from a React render, and
 * the nearest boundary is the app shell — so the failure mode without this
 * check is a blank page, not a fallback. Checking first turns "no WebGL" into
 * "the classic table", which is what the DOM felt already is.
 *
 * Takes a factory rather than reaching for `document` so it is testable, and
 * returns false on any throw: some privacy modes make `getContext` itself
 * raise rather than return null.
 *
 * Note this can only answer whether a context can be CREATED. A context lost
 * later — the common low-end-mobile failure — is a separate signal, handled
 * by the renderer reporting `onReady(false)` when it happens.
 */
export function canRenderWebGL(
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): boolean {
  try {
    const canvas = createCanvas();
    const context =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    return Boolean(context);
  } catch {
    return false;
  }
}

/**
 * The renderer to actually mount, given the player's preference and what the
 * browser can do. Pure, so the fallback is a tested rule rather than a
 * condition buried in a component.
 */
export function resolveTableRenderer(
  preference: TableRenderer,
  webglAvailable: boolean,
  landscape = true,
): TableRenderer {
  void preference;
  void webglAvailable;
  void landscape;
  return RACETRACK_RENDERER;
}
