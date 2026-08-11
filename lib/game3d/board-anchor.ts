/**
 * Where the community board is drawn, and how big — solved for the shape of
 * the viewport.
 *
 * Pure, and in `lib/` rather than in the component, for the reason
 * seat-bankrolls.tsx and chip-props.ts already are: `vitest.config.ts`
 * collects only `lib/` and `app/`, and placement arithmetic is exactly the
 * kind of thing that reads correctly in a file and is wrong on a render. The
 * board is the five cards every decision depends on, so "did it land on the
 * cloth, on the far player's face, or under the pot readout" wants to be an
 * assertion rather than a screenshot someone remembers taking.
 *
 * TWO ANSWERS, BLENDED — see `boardAnchor`.
 */

import {
  FAR_CROWN,
  cameraBasis,
  frameCamera,
  landscapeness,
  projectToNdc,
} from "./camera-framing";
import { BOARD_POSITION } from "./seat-layout";

/**
 * Air between the board's anchor and the hole cards below it, along the
 * camera's own up axis — the same technique seat-nameplates.tsx uses for
 * PLATE_LIFT. A landscape phone has the least room on the felt of any
 * viewport, so the anchor needs a nudge toward the dealer rather than a fixed
 * screen offset that would misplace it at other aspects.
 */
export const BOARD_LIFT = 0.05;

/** `.cardFace` is `aspect-ratio: 5 / 7`. */
export const CARD_ASPECT = 7 / 5;

/**
 * Screen the board keeps clear of at the top: `.hudTop` (top 14px) carries
 * the pot readout and `.message` sits at 60px under it. Real pixels, not a
 * percentage, because that HUD is itself sized in real pixels — a percentage
 * would drift with viewport height and slide the board under the pot on a
 * tall phone.
 */
export const HUD_RESERVE_PX = 88;

/**
 * Air under the board so it never quite touches the far player's head.
 *
 * Was 12. The fourth table pull-in (seat-layout.ts, FELT_RADIUS_X 1.45 ->
 * 1.2) draws the camera closer, and the far crown rises up-screen faster
 * than the board itself shrinks with it — at 820x1180 (TABLET_UPRIGHT in
 * board-anchor.test.ts) the two closed to less than the card's own height,
 * so any fixed clearance at 12 was already spent before the card was
 * centred. 8 is the largest value bisected against that same viewport that
 * still leaves the card clear (a little over a pixel to spare); this is the
 * one knob available that doesn't touch HUD_RESERVE_PX, which is real pixel
 * geometry borrowed from the HUD's own layout, not a tunable margin.
 */
export const CROWN_CLEARANCE_PX = 8;

/**
 * Card width solved from the stage box, not the camera: wide enough to read
 * at a lazy glance on a phone, capped so five cards stay a board rather than
 * a wall on a desktop. The height term is what keeps a landscape phone
 * honest — 11.5% of an 844px width would be taller than its felt.
 */
export function boardCardWidth(width: number, height: number): number {
  return Math.round(
    Math.min(66, Math.max(44, Math.min(width * 0.115, height * 0.11)))
  );
}

/** Percentages of the stage box. `.boardLayer` is `translate(-50%, -50%)`, so
 * `top` is the row's CENTRE, not its top edge. */
export interface BoardAnchor {
  left: number;
  top: number;
}

/**
 * WHERE THE BOARD SITS IS TWO ANSWERS BLENDED, NOT ONE.
 *
 * Sideways, the felt is wide and the board belongs on it, where it has always
 * been: the projected anchor.
 *
 * Upright, it cannot. A 2.13 m table across a 390 px screen leaves a felt only
 * a couple of hundred pixels tall, and five cards big enough to read simply do
 * not fit on it — they blanket the cloth, cover the opponents' pairs and bury
 * the pot. But the same framing that shrinks the felt also opens a large empty
 * backdrop ABOVE the room (the camera aims low on purpose — see
 * camera-framing.ts's `aimDrop`), and that emptiness is the right size for a
 * board. So upright the board goes there, centred in the gap between the HUD's
 * message line and the far player's crown.
 *
 * The gap's floor is `FAR_CROWN`, not the felt's far rail: a row that merely
 * clears the cloth still lands across the far player's face.
 *
 * The two are mixed on `landscapeness`, the same 0-to-1 the camera itself
 * interpolates its profiles on, so the room holds ONE notion of "how upright
 * is this" rather than a second threshold that could drift from the first. At
 * any aspect >= 1.5 (every desktop, and a phone on its side) the result is
 * exactly the projected anchor this has always used.
 */
export function boardAnchor(width: number, height: number): BoardAnchor | null {
  const aspect = height > 0 ? width / height : 0;
  if (aspect <= 0 || height <= 0) return null;

  const framing = frameCamera(aspect);
  const { up } = cameraBasis(framing);
  const lifted = {
    x: BOARD_POSITION.x + up.x * BOARD_LIFT,
    y: BOARD_POSITION.y + up.y * BOARD_LIFT,
    z: BOARD_POSITION.z + up.z * BOARD_LIFT,
  };
  const ndc = projectToNdc(lifted, framing, aspect);
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;

  const onFelt = ((1 - ndc.y) / 2) * 100;
  const pct = (px: number) => (px / height) * 100;
  const halfBoard = pct((boardCardWidth(width, height) * CARD_ASPECT) / 2);

  // The band the backdrop answer is centred in. Its ceiling is the HUD, its
  // floor the far player's crown; both are pushed in by half a card so the
  // CENTRE this returns still leaves the row itself inside the band.
  const bandTop = pct(HUD_RESERVE_PX) + halfBoard;
  const crown = projectToNdc(FAR_CROWN, framing, aspect);
  const bandBottom = Number.isFinite(crown.y)
    ? ((1 - crown.y) / 2) * 100 - pct(CROWN_CLEARANCE_PX) - halfBoard
    : bandTop;
  // Never above the HUD: on a short viewport the band can invert, and the pot
  // readout is the one thing the board must not hide.
  const inBackdrop = Math.max(bandTop, (bandTop + bandBottom) / 2);

  const t = landscapeness(aspect);
  return {
    left: ((ndc.x + 1) / 2) * 100,
    top: inBackdrop + (onFelt - inBackdrop) * t,
  };
}

/** The projected on-the-felt anchor alone — what `boardAnchor` returns at any
 * landscape aspect, exposed so a test can assert that equality rather than
 * restate the projection. */
export function boardAnchorOnFelt(width: number, height: number): BoardAnchor | null {
  const aspect = height > 0 ? width / height : 0;
  if (aspect <= 0) return null;
  const framing = frameCamera(aspect);
  const { up } = cameraBasis(framing);
  const ndc = projectToNdc(
    {
      x: BOARD_POSITION.x + up.x * BOARD_LIFT,
      y: BOARD_POSITION.y + up.y * BOARD_LIFT,
      z: BOARD_POSITION.z + up.z * BOARD_LIFT,
    },
    framing,
    aspect,
  );
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null;
  return { left: ((ndc.x + 1) / 2) * 100, top: ((1 - ndc.y) / 2) * 100 };
}
