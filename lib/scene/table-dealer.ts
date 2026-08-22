/**
 * The dealer at the 2.5D table, and the one place she stands.
 *
 * The table has ONE dealer place -- far centre, the cutout a real oval table
 * has instead of a chair (`dealerAnchor()`) -- and now exactly one person in
 * it. Claira, in house uniform, and she is the only dealer this room has --
 * `DEALER_ART_SRC` is the one file. (The Blackjack room still draws its own
 * dealers from `public/dealer/`; the two surfaces are deliberately separate.)
 *
 * THERE WAS A ROTATION HERE AND IT IS GONE. Three plates took the table eight
 * hands at a time, picked by hashing the table id -- `dealerForHand`,
 * `HANDS_PER_DOWN`, `DEALER_IDS`. All of it was deleted rather than reduced to
 * a roster of one: a rotation that never rotates is machinery a reader has to
 * disprove. Recover it from git history if the house ever hires again.
 *
 * THERE ARE NO PER-DEALER NUMBERS HERE, AND A REDRAW MUST NEVER NEED ANY. A
 * plate arrives at its own crop with its own idea of where the middle is;
 * `scripts/prepare-dealer.py` is what absorbs that, normalising it onto a box
 * with the crown at the top edge, the hands at the bottom edge and the head
 * centred. So the app holds a single placement, `DEALER_SLOT` below, and a new
 * drawing is a file dropped in `art/dealers/` plus a run of that script. If
 * you ever find yourself adding an offset here, the plate is framed wrong --
 * fix it in the source.
 *
 * THE SLOT IS SOLVED FROM THE CAMERA, NOT FIXED IN PIXELS. Its size is a
 * multiple of the projected gap between the two chairs flanking the dealer,
 * which the scene reports every frame, so the dealer grows and shrinks with
 * the table exactly like the seats and the board do -- across viewport sizes,
 * across headcounts, and through a rotation of the device.
 */

import { DEALER_ART_SRC, DEALER_BOX } from "./dealer-art.generated";

export { DEALER_ART_SRC };

/**
 * The dealer's place at the table, in terms the camera can answer.
 *
 * Both numbers are composition rather than measurement, and they exist to
 * serve one rule:
 *
 *   THE DEALER IS BEHIND THE TABLE, NOT LEANING OVER IT.
 *
 * At far centre the camera looks slightly down at someone a good half-metre
 * further away than the near rail, so a flat bitmap drawn at full size with
 * its hands on the cloth reads as being in FRONT of the table. Drawn a little
 * short of the full gap between the chairs is the distance cue the artwork
 * cannot give on its own -- everything else here gets its size from the
 * perspective divide, and this is a fixed bitmap.
 */
export const DEALER_SLOT = {
  /**
   * Drawn height, as a multiple of the projected gap between the two chairs
   * beside the dealer (`dealerShoulderRoom`, in screen pixels).
   *
   * Height rather than width because height is what the art is normalised on:
   * the plate runs crown-to-hands, so pinning height puts the dealer's hands
   * on a known line of cloth. Tuned live against a played hand at desktop and
   * at landscape phone.
   */
  height: 1.06,
  /**
   * How far the crown sits above the camera's projected head height, as a
   * fraction of the drawn height.
   *
   * Positive lifts the dealer. It is small and it is deliberately anchored to
   * HAIR rather than skull: `fitCamera` reserves its top margin against head
   * points and hair is what occupies that margin, so anchoring the skull
   * clips a ponytail off the top of the frame and drops the hands onto the
   * rail instead of the cloth.
   */
  crown: 0.02,
} as const;

/**
 * Where to draw the dealer, given the anchor the scene projected for her.
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
