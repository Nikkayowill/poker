/**
 * The room's ruler: one place that says how big a world unit is, and every
 * physical prop stated in the millimetres it actually has.
 *
 * WHY THIS EXISTS. The props used to size themselves independently — chips
 * carried "oversized on purpose" against a camera distance, cards carried a
 * hand-picked 0.34 x 0.47 — so nothing in the scene was proportional to
 * anything else, and there was no number to check a new prop against.
 * Measured against the felt, the chips were 2.4x and the cards 2.6x their
 * real size, which reads exactly as it sounds: a table strewn with coasters.
 *
 * THE ANCHOR IS THE TABLE. A six-max oval's playing surface is 2.13 m long,
 * and the felt here is 2 * FELT_RADIUS_X units across, so that ratio fixes
 * the scale for everything lying on the cloth. The table is the right ruler
 * rather than, say, the avatars, because a chip is read against the felt it
 * sits on — the eye judges "a chip is about a fiftieth of the table", and
 * that is the ratio this file makes true.
 *
 * ONE RULER FOR EVERYTHING, INCLUDING THE PEOPLE. This used to anchor only
 * what lies flat on the cloth; seated avatars were imported through a
 * second, independent ruler (`UNITS_PER_METRE_Y`, keyed off a felt-height
 * literal that had never been derived from anything) that disagreed with
 * this one by as much as 1.76x. See `FELT_TOP_Y`'s own comment in
 * seat-layout.ts for what that actually cost — real, repeated bugs, not a
 * cosmetic mismatch. `HUMAN_STANDING_UNITS` below now goes through this same
 * `UNITS_PER_METRE`, so a table resize and an avatar-scale change are the
 * same edit and cannot drift apart between rounds.
 *
 * Pure arithmetic with no three.js import, so `npm test` reaches it.
 */

import { FELT_RADIUS_X, TABLE_LENGTH_M } from "./seat-layout";

/**
 * Playing surface of a six-max oval table, long axis, in metres.
 *
 * Re-exported rather than restated: the felt's DEPTH is derived from the
 * same table's short axis, and that derivation has to live in seat-layout
 * (this file imports FELT_RADIUS_X from there, so the metre constants
 * cannot come the other way without a cycle). One 2.13 in the codebase,
 * and the test below checks the felt really measures it on both axes.
 */
export { TABLE_LENGTH_M };

/** The scale factor everything else in this file is built from. */
export const UNITS_PER_METRE = (2 * FELT_RADIUS_X) / TABLE_LENGTH_M;

/** Millimetres to world units — the unit every real dimension is quoted in. */
export function mm(millimetres: number): number {
  return (millimetres / 1000) * UNITS_PER_METRE;
}

/**
 * A casino chip: 39 mm across and 3.3 mm thick. Both are the standard
 * values, not approximations — a 39 mm chip is what every house uses, and
 * the 0.17 thickness-to-radius ratio the old constant reached for was
 * derived from exactly these two numbers.
 */
export const CHIP = {
  radius: mm(39 / 2),
  thickness: mm(3.3),
  /**
   * The rounded lip where a chip's face meets its edge. Real and small —
   * a moulded chip is not a machined cylinder, and this ~0.7 mm break is
   * where the whole rim highlight comes from when the studio spot crosses
   * a pile. Kept well under the thickness so the silhouette is unchanged:
   * a chip that reads as bevelled has caught a light, not lost a size.
   */
  bevel: mm(0.7),
} as const;

/**
 * A poker-size playing card: 63.5 x 88.9 mm (2.5 x 3.5 inches). The
 * thickness is real too, and it matters more than it sounds — a stack of
 * two hole cards has to sit a card apart, not a plate apart.
 */
export const CARD = {
  width: mm(63.5),
  height: mm(88.9),
  thickness: mm(0.3),
} as const;

/** Gap between two community cards laid out on the board. */
export const CARD_GAP = mm(6);

/** A dealer button: 76 mm across, which is nearly twice a chip. */
export const DEALER_BUTTON = {
  radius: mm(76 / 2),
  thickness: mm(9),
} as const;

/**
 * Head height of a seated player, in metres. The character rigs are checked
 * against this rather than eyeballed — converted through `UNITS_PER_METRE`,
 * the room's one ruler, same as everything else in this file.
 */
export const HUMAN_SEATED_HEAD_M = 1.25;

/** Standing height of the adult the roster is normalized to, in metres. */
export const HUMAN_STANDING_M = 1.75;

/**
 * Height of a real poker table's playing surface off the floor, in metres.
 *
 * Re-exported rather than restated, exactly like `TABLE_LENGTH_M` above:
 * `FELT_TOP_Y` (seat-layout.ts) needs this to build the felt's height on
 * this same `UNITS_PER_METRE` ruler, and that file cannot import from this
 * one without a cycle (this file imports `FELT_RADIUS_X` from it). One 0.75
 * in the codebase; dimensions.test.ts pins the two computations equal.
 */
export { TABLE_HEIGHT_M } from "./seat-layout";

/**
 * Standing height of the roster's adult, in world units — through
 * `UNITS_PER_METRE`, the same ruler the table itself is built on.
 *
 * Used to go through a second, independent ruler (`UNITS_PER_METRE_Y`) keyed
 * off a felt-height literal nothing else derived from. That constant, and
 * the felt-height literal it was keyed off, are gone — see `FELT_TOP_Y`'s
 * own comment in seat-layout.ts for the bug that shape of drift caused and
 * why one ruler for the whole room is the actual fix, not a simplification
 * of it.
 */
export const HUMAN_STANDING_UNITS = HUMAN_STANDING_M * UNITS_PER_METRE;
