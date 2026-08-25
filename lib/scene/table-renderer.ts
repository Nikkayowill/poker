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
 * The 2.5D racetrack is the only selectable table. `webgl_3d` remains in the
 * type and implementation so the 3D room can be restored later, but the
 * client does not expose it or mount it for gameplay. The classic canvas_2d
 * room -- the one that supported a vertical/portrait layout -- is gone
 * outright, not just disabled: the app is landscape-only now (see the
 * orientation gate in poker-table.tsx), so there was no fallback left for it
 * to serve. If it's ever wanted again, recover it from git history rather
 * than re-deriving it.
 *
 * In `lib/` rather than beside either renderer because `vitest.config.ts`
 * collects only `lib/` and `app/` — the same reason `bet-style.ts`, whose
 * shape this follows exactly, lives there.
 */

export type TableRenderer = "webgl_3d" | "racetrack_2d5";

export const TABLE_RENDERERS: readonly TableRenderer[] = ["racetrack_2d5"];

/**
 * Temporary kill switch for the 3D room while it's being reworked. Flip back
 * to `true` to bring it back -- everything downstream (resolveTableRenderer,
 * nextTableRenderer, the default preference, the buy-in picker) reads this
 * one flag rather than needing to be individually re-enabled.
 */
export const TABLE_RENDERER_3D_ENABLED = false;

/**
 * The 2.5D racetrack room -- a Canvas-2D table drawn from a real perspective
 * camera. The sole active renderer now that the classic orthographic room is
 * gone.
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
 * Skips the 3D room where the browser cannot render it, so a device with no
 * WebGL context never lands on a menu entry that appears to do nothing.
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
  return "Table: 2.5D";
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
 * check is a blank page, not a fallback.
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
  // Portrait is blocked outright by PokerTable's orientation gate -- there is
  // no fallback room left for a portrait viewport to resolve to.
  void landscape;
  return RACETRACK_RENDERER;
}
