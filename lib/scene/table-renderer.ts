/**
 * Which renderer draws the table: the Canvas-2D room or the WebGL one.
 *
 * The two are interchangeable at exactly one seam. Both mount inside
 * `.table-area` as the first child, both report through a single
 * `onReady(boolean)`, and `.scene-lit` — which stops the DOM felt and rail
 * painting — is applied from that one signal for either. Everything else at
 * the table (nameplates, hole cards, the board, the action bar, the feed, the
 * turn-clock fuse, every sound) is DOM above the canvas and does not know or
 * care which room is underneath it.
 *
 * That is what makes this a preference rather than a fork: nothing downstream
 * branches on it.
 *
 * WHY THE DEFAULT IS 2D, FOR NOW. Not because it is better — the 3D room is
 * the direction. It is that the 2D room is what every player is currently
 * looking at and what the whole Playwright suite asserts against, so shipping
 * the renderer and choosing it are two decisions, and making them one commit
 * means the first real device either of us learns about is a player's. Flip
 * this constant to make 3D the default; nothing else has to change.
 *
 * In `lib/` rather than beside either renderer because `vitest.config.ts`
 * collects only `lib/` and `app/` — the same reason `bet-style.ts`, whose
 * shape this follows exactly, lives there.
 */

export type TableRenderer = "canvas_2d" | "webgl_3d";

export const TABLE_RENDERERS: readonly TableRenderer[] = ["canvas_2d", "webgl_3d"];

/** See the header: continuity, not preference. */
export const DEFAULT_TABLE_RENDERER: TableRenderer = "canvas_2d";

/** Same `stackchips:` namespace as the sound, music and bet-style preferences. */
export const TABLE_RENDERER_STORAGE_KEY = "stackchips:table-renderer";

/** A stored or wire value, coerced to a real renderer. Anything else is the default. */
export function normalizeTableRenderer(value: unknown): TableRenderer {
  return TABLE_RENDERERS.includes(value as TableRenderer)
    ? (value as TableRenderer)
    : DEFAULT_TABLE_RENDERER;
}

/** The next renderer in the cycle, for a single menu entry that toggles through. */
export function nextTableRenderer(renderer: TableRenderer): TableRenderer {
  const index = TABLE_RENDERERS.indexOf(renderer);
  return TABLE_RENDERERS[(index + 1) % TABLE_RENDERERS.length];
}

/** What the table menu prints for each renderer. */
export function tableRendererLabel(renderer: TableRenderer): string {
  return renderer === "webgl_3d" ? "Table: 3D room" : "Table: Classic";
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
): TableRenderer {
  if (preference === "webgl_3d" && !webglAvailable) return "canvas_2d";
  return preference;
}
