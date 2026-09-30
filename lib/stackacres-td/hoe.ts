/**
 * When a hoe stroke lands, and how the square it breaks arrives.
 *
 * A stroke is three beats: the farmer swings, the blade hits and throws up a
 * puff of dirt, and the square of turned earth drops into place under it. The
 * puff and the square have to land on the HIT, not on the tap -- a bed that
 * appears while the hoe is still over his head reads as the ground changing on
 * its own, with the swing as decoration.
 *
 * The swing is the farmer's overhead hoe swing (./swing.ts), and the blade
 * meets the ground on its strike frame. ./swing.test.ts holds that timing to
 * the sheet.
 *
 * Pure and renderer-free, same split as the rest of lib/stackacres-td.
 */

import { SWING_STRIKE_MS } from "./swing";

/** Ms from the start of the swing to the blade hitting the ground. */
export const HOE_STRIKE_MS = SWING_STRIKE_MS;

/** How long the broken square takes to drop into place once the blade lands. */
export const BED_DROP_MS = 220;

/** How small the square starts as it drops in: a clod, before it spreads to a square. */
export const BED_DROP_FROM = 0.3;
