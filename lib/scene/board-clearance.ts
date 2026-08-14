import { BOARD_CARD_FLOP_OVERLAP_FRACTION, BOARD_CARD_REVEAL_GAP_FRACTION } from "./table-anchors";

/**
 * How wide the community-card row is allowed to render before it risks
 * reaching the pot -- a screen-space check, not a felt-space one.
 *
 * `BOARD_DEPTH_FRACTION` and `POT_DEPTH_FRACTION` (table-anchors.ts) are
 * fixed felt-space constants, but the pixel gap between their two projected
 * points changes with every camera fit: a phone in landscape and a 21:9
 * desktop monitor put a different number of pixels between the same two felt
 * points. A CSS breakpoint can't know that number; only this frame's own
 * `onLayout` report can. So the row's card width is clamped twice -- once to
 * `[min, max]` for the real 63mm-card projection (poker-table.tsx), and then
 * shrunk further, here, until its own rendered footprint actually fits the
 * live gap this frame reported. It only ever shrinks toward the floor; it
 * never grows past what the projection already gave it.
 */
const MIN_ZONE_GAP_PX = 18;

/**
 * The row's rendered width at a given card size -- five cards, the flop's
 * three overlapping each other, the turn and river keeping the ordinary
 * reveal gap. Mirrors `app/styles/42-racetrack-table.css`'s own gap/margin
 * rules for `.community-cards`/`.community-card-shell`, which read the same
 * `BOARD_CARD_REVEAL_GAP_FRACTION`/`BOARD_CARD_FLOP_OVERLAP_FRACTION`
 * through the `--board-card-reveal-gap-fraction`/`--board-card-flop-overlap-fraction`
 * custom properties poker-table.tsx sets alongside `--board-card-width` --
 * one source of truth (table-anchors.ts) instead of three copies.
 */
function rowWidthAt(cardPx: number, revealGapFraction: number, flopOverlapFraction: number): number {
  const flopOverlap = cardPx * flopOverlapFraction * 2; // two shells (2nd, 3rd) pulled in
  const revealGaps = cardPx * revealGapFraction * 2; // board->turn, turn->river
  return cardPx * 5 - flopOverlap + revealGaps;
}

export interface ClampBoardCardWidthOptions {
  min: number;
  max: number;
  /** Defaults to `BOARD_CARD_REVEAL_GAP_FRACTION`/`BOARD_CARD_FLOP_OVERLAP_FRACTION`. */
  revealGapFraction?: number;
  flopOverlapFraction?: number;
}

/**
 * The board's card width for this frame: the real 63mm-card projection,
 * clamped to `[min, max]`, then shrunk -- one pixel at a time, down to the
 * floor -- until the row's own footprint plus a fixed breathing margin fits
 * inside the live screen-space gap to the pot. Geometry decides the ceiling
 * every frame; the board/pot z-index tier (42-racetrack-table.css) is the
 * backstop for the one pixel this loop might still miss on the smallest
 * frames the app ships to, where even the floor can't guarantee clearance.
 */
export function clampBoardCardWidth(
  rawWidthPx: number,
  board: { x: number; y: number },
  pot: { x: number; y: number },
  options: ClampBoardCardWidthOptions,
): number {
  const {
    min, max,
    revealGapFraction = BOARD_CARD_REVEAL_GAP_FRACTION,
    flopOverlapFraction = BOARD_CARD_FLOP_OVERLAP_FRACTION,
  } = options;
  const gapPx = Math.hypot(pot.x - board.x, pot.y - board.y);
  let width = Math.min(max, Math.max(min, rawWidthPx));
  while (
    width > min
    && rowWidthAt(width, revealGapFraction, flopOverlapFraction) + MIN_ZONE_GAP_PX > gapPx
  ) {
    width -= 1;
  }
  return width;
}
