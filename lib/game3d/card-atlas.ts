/**
 * The card atlas grid: one canvas holding every rank/suit face plus the
 * shared back, so hole cards can render as instances of a single
 * InstancedMesh (components/game3d/scene/cards-instanced.tsx) instead of
 * paying a material switch per unique card. Pure grid/rect math only — no
 * three.js, no canvas — so `npm test` reaches it and the UV convention
 * below (the one fragile, must-match-the-shader part of this design) is
 * pinned by tests rather than eyeballed on a render.
 *
 * CELL ORDER AND THE UV FLIP, TOGETHER. RANKS x SUITS gives 52 cards; +1
 * for the back is 53, laid out row-major into an
 * ATLAS_COLUMNS x ATLAS_ROWS grid (3 cells spare). A cell's (col, row) is
 * addressed in the same top-left-origin numbering the atlas CANVAS is
 * painted in (card-atlas-texture.ts draws row 0 at the top, same as any
 * 2D canvas). The existing single-card texture pipeline
 * (components/game3d/scene/card-textures.ts) already renders correctly
 * with three's default `texture.flipY = true`, which is what makes canvas
 * row 0 land at UV v=1 — the "up" edge of a card lying face-up on the
 * felt. `cardAtlasRect` keeps that same default (the atlas texture is
 * built and consumed with flipY untouched too), so it has to invert ROW
 * when computing v0, not just divide by it: `v0 = 1 - (row+1)/rows`. The
 * degenerate 1x1-grid case collapsing to exactly {u0:0, v0:0, du:1, dv:1}
 * — this file's `cardAtlasRect` test — is the check that this composition
 * reproduces today's proven-correct whole-texture behaviour rather than a
 * new, unverified convention.
 */

import { RANKS, SUITS } from "@/lib/game/deck";
import type { Card } from "@/lib/game/types";

export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 7;

export type AtlasCardKey = `${Card["rank"]}-${Card["suit"]}` | "back";

/**
 * Every cell the atlas defines, in the exact order it is painted: card
 * faces first (rank-major, so one suit isn't scattered across rows), the
 * shared back last. `card-atlas-texture.ts` iterates this same array to
 * paint the canvas, so a cell's *position* can never drift from its
 * *index* here — there is exactly one list, not two that have to agree.
 */
export const ATLAS_CELL_ORDER: readonly AtlasCardKey[] = [
  ...RANKS.flatMap((rank) => SUITS.map((suit) => `${rank}-${suit}` as AtlasCardKey)),
  "back",
];

/** The atlas key for a card, or the shared back for a face-down slot. */
export function atlasKeyFor(card: Card | null): AtlasCardKey {
  return card ? (`${card.rank}-${card.suit}` as AtlasCardKey) : "back";
}

export interface AtlasRect {
  u0: number;
  v0: number;
  du: number;
  dv: number;
}

/**
 * Cell index for a key. Throws on an unknown key rather than silently
 * falling back to cell 0 — a fallback there would render every
 * unrecognised card as the ace of clubs, which is a far worse failure mode
 * than a loud crash during development.
 */
function cellIndex(key: AtlasCardKey): number {
  const index = ATLAS_CELL_ORDER.indexOf(key);
  if (index === -1) throw new Error(`card-atlas: unknown atlas key "${key}"`);
  return index;
}

/**
 * The UV rect for one cell, in the v-orientation described in this file's
 * header. `columns`/`rows` are parameters (defaulted to the production
 * grid) purely so the identity/tiling tests below can probe a 1x1
 * degenerate grid without depending on the production constants.
 */
export function cardAtlasRect(
  key: AtlasCardKey,
  columns: number = ATLAS_COLUMNS,
  rows: number = ATLAS_ROWS,
): AtlasRect {
  const index = cellIndex(key);
  const col = index % columns;
  const row = Math.floor(index / columns);
  const du = 1 / columns;
  const dv = 1 / rows;
  return {
    u0: col * du,
    v0: 1 - (row + 1) * dv,
    du,
    dv,
  };
}

/**
 * Pixel-space cell top-left for the canvas painter, which works in
 * top-left-origin canvas coordinates and never touches UV space at all —
 * kept as a separate function rather than deriving it from `cardAtlasRect`
 * so the painter never has to know the UV flip exists.
 */
export function atlasCellOrigin(
  key: AtlasCardKey,
  cellWidth: number,
  cellHeight: number,
  columns: number = ATLAS_COLUMNS,
): { x: number; y: number } {
  const index = cellIndex(key);
  return {
    x: (index % columns) * cellWidth,
    y: Math.floor(index / columns) * cellHeight,
  };
}
