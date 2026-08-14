/**
 * Who is dealing the 2.5D table, and the one place they all stand.
 *
 * The table has ONE dealer place -- far centre, the cutout a real oval table
 * has instead of a chair (`dealerAnchor()`) -- and one person in it at a time.
 * This module is the roster that place draws from and the clock that decides
 * whose turn it is.
 *
 * THERE ARE NO PER-DEALER NUMBERS HERE, AND ADDING A DEALER MUST NEVER NEED
 * ANY. Every plate arrives at its own crop with its own idea of where the
 * middle is; `scripts/prepare-dealers.py` is what absorbs that, normalising
 * each one onto a shared box with the crown at the top edge, the hands at the
 * bottom edge and the head centred. So the app holds a single placement for
 * the slot, `DEALER_SLOT` below, and a fourth dealer is a file dropped in
 * `art/dealers/` plus a run of that script. If you ever find yourself adding
 * a per-dealer offset here, the plate is framed wrong -- fix it in the bucket.
 *
 * THE SLOT IS SOLVED FROM THE CAMERA, NOT FIXED IN PIXELS. Its size is a
 * multiple of the projected gap between the two chairs flanking the dealer,
 * which the scene reports every frame, so the dealer grows and shrinks with
 * the table exactly like the seats and the board do -- across viewport sizes,
 * across headcounts, and through a rotation.
 *
 * ROTATION IS DERIVED, NEVER STORED. `dealerForHand` is a pure function of the
 * table's id and hand number -- both server-authoritative, both already in
 * every snapshot -- so every client at a table shows the same dealer without a
 * byte crossing the wire for it, a player who reloads mid-down sees no swap,
 * and a spectator agrees with the players. A local random or a mounted-at
 * timestamp gives each browser its own dealer, which is one table disagreeing
 * with itself.
 */

import { DEALER_BOX, DEALER_IDS } from "./dealer-art.generated";

export type DealerId = (typeof DEALER_IDS)[number];

/** Where a dealer's normalised art lives. */
export function dealerArtSrc(id: DealerId): string {
  return `/table2d5/dealers/${id}.webp`;
}

/**
 * The dealer's place at the table, in terms the camera can answer.
 *
 * Both numbers are composition rather than measurement, they are the same for
 * everyone on the roster, and they exist to serve one rule:
 *
 *   THE DEALER IS BEHIND THE TABLE, NOT LEANING OVER IT.
 *
 * At far centre the camera looks slightly down at someone a good half-metre
 * further away than the near rail, so a flat bitmap drawn at full size with
 * its hands on the cloth reads as being in FRONT of the table. Drawn a little
 * short of the full gap between the chairs is the distance cue the artwork
 * cannot give on its own -- everything else here gets its size from the
 * perspective divide, and these are fixed bitmaps.
 */
export const DEALER_SLOT = {
  /**
   * Drawn height, as a multiple of the projected gap between the two chairs
   * beside the dealer (`dealerShoulderRoom`, in screen pixels).
   *
   * Height rather than width because height is what the art is normalised on:
   * every plate runs crown-to-hands, so pinning height puts every dealer's
   * hands on the same line of cloth whatever their build. Tuned live against
   * a played hand at desktop and at landscape phone, then held while the
   * roster grew.
   */
  height: 1.06,
  /**
   * How far the crown sits above the camera's projected head height, as a
   * fraction of the drawn height.
   *
   * Positive lifts the dealer. It is small and it is deliberately anchored to
   * HAIR rather than skull: `fitCamera` reserves its top margin against head
   * points and hair is what occupies that margin, so anchoring the skull
   * clips a ponytail or a pair of ears off the top of the frame and drops the
   * hands onto the rail instead of the cloth.
   */
  crown: 0.02,
} as const;

/**
 * Where to draw the dealer, given the anchor the scene projected for them.
 *
 * `shoulderPx` is the gap between the chairs either side, in screen pixels --
 * so everything below is re-solved whenever the camera is, and nothing here is
 * a fixed size.
 */
export function dealerSlotBox(dealer: { x: number; y: number; shoulderPx: number }): {
  left: number;
  top: number;
  width: number;
} {
  const height = dealer.shoulderPx * DEALER_SLOT.height;
  const width = height * (DEALER_BOX.width / DEALER_BOX.height);
  return {
    left: dealer.x - width / 2,
    top: dealer.y - height * DEALER_SLOT.crown,
    width,
  };
}

/**
 * How many hands a dealer works before the next one takes over.
 *
 * A real room rotates its dealers roughly every half hour; at the pace hands
 * actually go here that is somewhere near this many. It is a whole number of
 * HANDS rather than a duration so the swap can only ever happen between hands
 * -- a dealer who changes face mid-hand reads as a glitch, and a clock-based
 * rotation cannot promise it will not.
 */
export const HANDS_PER_DOWN = 8;

/**
 * A stable 32-bit hash of a table id, so different tables do not all open with
 * the same dealer.
 *
 * FNV-1a: tiny, dependency-free, and deterministic across engines, which is
 * the only property that matters here -- every client has to hash the same id
 * to the same number or they disagree about who is dealing.
 */
function hashTableId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Whose down this is.
 *
 * Total: any table id and any hand number resolve to a dealer, including the
 * junk ones (hand 0 before the first deal, a non-integer, a negative from a
 * caller doing its own arithmetic). A table's dealer is not worth throwing
 * over, and the alternative -- a null the caller has to draw something for --
 * is an empty dealer cutout, which reads as the art failing to load.
 */
export function dealerForHand(tableId: string, handNumber: number): DealerId {
  const hand = Number.isFinite(handNumber) ? Math.max(0, Math.floor(handNumber)) : 0;
  const down = Math.floor(hand / HANDS_PER_DOWN);
  return DEALER_IDS[(hashTableId(tableId) + down) % DEALER_IDS.length];
}
