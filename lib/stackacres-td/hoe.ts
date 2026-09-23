/**
 * When a hoe stroke lands, and how the square it breaks arrives.
 *
 * A stroke is three beats: the farmer swings, the blade hits and throws up a
 * puff of dirt, and the square of turned earth drops into place under it. The
 * puff and the square have to land on the HIT, not on the tap -- a bed that
 * appears while the hoe is still over his head reads as the ground changing on
 * its own, with the swing as decoration.
 *
 * The swing is the rig's `chop` animation (components/arcade/stackacres-td/
 * scene.ts's ACTIONS), and the blade meets the ground as its third frame
 * starts, after the wind-up and the lift. `HOE_STRIKE_MS` is those two frames;
 * ./hoe.test.ts reads them out of the farmer's sheet, so redrawing the swing
 * without moving this fails a test instead of putting the dirt out of time.
 *
 * Pure and renderer-free, same split as the rest of lib/stackacres-td.
 */

/** Frames of the swing before the blade reaches the ground: wind-up, then lift. */
export const HOE_FRAMES_BEFORE_STRIKE = 2;

/** Ms from the start of the swing to the blade hitting the ground. */
export const HOE_STRIKE_MS = 300;

/** How long the broken square takes to drop into place once the blade lands. */
export const BED_DROP_MS = 220;

/** How small the square starts as it drops in: a clod, before it spreads to a square. */
export const BED_DROP_FROM = 0.3;
