/**
 * Which renderer draws the table.
 *
 * The table room mounts inside `.table-area` as the first child, both report
 * through a single `onReady(boolean)`, and `.scene-lit` (which stops the DOM
 * felt and rail painting) is applied from that one signal for either.
 * Everything else at the table (nameplates, hole cards, the board, the
 * action bar, the feed, the turn-clock fuse, every sound) is DOM above the
 * canvas and does not know or care which room is underneath it.
 *
 * The 2.5D racetrack is the only renderer left, and the only one this type
 * names. Two others used to live here and are both gone outright, not just
 * disabled: the classic `canvas_2d` room -- the one that supported a
 * vertical/portrait layout -- went first, once the app settled on
 * landscape-only (see the orientation gate in poker-table.tsx); the WebGL
 * `webgl_3d` room followed once Kayo decided to scrap it rather than keep
 * carrying it disabled. If either is ever wanted again, recover it from the
 * `archive/webgl-3d-table` git tag rather than re-deriving it -- this file
 * does not carry a re-enable switch for either any more.
 *
 * In `lib/` rather than beside the renderer because `vitest.config.ts`
 * collects only `lib/` and `app/` — the same reason `bet-style.ts`, whose
 * shape this follows exactly, lives there.
 */

export type TableRenderer = "racetrack_2d5";

export const TABLE_RENDERERS: readonly TableRenderer[] = ["racetrack_2d5"];

/**
 * The 2.5D racetrack room -- a Canvas-2D table drawn from a real perspective
 * camera. The sole renderer this app ships.
 */
export const RACETRACK_RENDERER: TableRenderer = "racetrack_2d5";

export const DEFAULT_TABLE_RENDERER: TableRenderer = RACETRACK_RENDERER;

/** Same `stackchips:` namespace as the sound, music and bet-style preferences. */
export const TABLE_RENDERER_STORAGE_KEY = "stackchips:table-renderer";

/** A stored or wire value, coerced to a real renderer. Anything else is the default. */
export function normalizeTableRenderer(value: unknown): TableRenderer {
  return value === RACETRACK_RENDERER ? RACETRACK_RENDERER : DEFAULT_TABLE_RENDERER;
}

/**
 * The next renderer in the cycle, for a single menu entry that toggles
 * through. With one renderer in the union there is nothing to cycle to --
 * kept as a function (rather than inlined at its one call site) so that call
 * site does not need to know how many renderers exist.
 */
export function nextTableRenderer(): TableRenderer {
  return RACETRACK_RENDERER;
}

/** What the table menu prints for the renderer. */
export function tableRendererLabel(renderer: TableRenderer): string {
  void renderer;
  return "Table: 2.5D";
}

/**
 * The renderer to actually mount. Kept as a function -- rather than every
 * caller reading `RACETRACK_RENDERER` directly -- so a stored preference and
 * a browser capability can still be threaded through here if a second
 * renderer is ever added again; today both parameters are accepted and
 * ignored.
 */
export function resolveTableRenderer(preference: TableRenderer): TableRenderer {
  void preference;
  return RACETRACK_RENDERER;
}
