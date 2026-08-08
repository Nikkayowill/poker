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
 * KNOWN INCONSISTENCY, DELIBERATELY LEFT. Under this ruler the placeholder
 * avatars are about half human size (AVATAR_HEAD_Y 1.5 units resolves to
 * 0.74 m, where a seated player's head is ~1.25 m). They are procedural
 * stand-ins for real character rigs, and the moment to fix their scale is
 * when those land: .glb characters are authored in metres, so the correct
 * import scale is UNITS_PER_METRE and nothing else. HUMAN_SEATED_HEAD_M
 * below is here for that day.
 *
 * Pure arithmetic with no three.js import, so `npm test` reaches it.
 */

import { FELT_RADIUS_X, FELT_TOP_Y } from "./seat-layout";

/** Playing surface of a six-max oval table, long axis, in metres. */
export const TABLE_LENGTH_M = 2.13;

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
 * against this rather than eyeballed — see UNITS_PER_METRE_Y below for the
 * ruler that converts it.
 */
export const HUMAN_SEATED_HEAD_M = 1.25;

/** Standing height of the adult the roster is normalized to, in metres. */
export const HUMAN_STANDING_M = 1.75;

/** Height of a real poker table's playing surface off the floor, in metres. */
export const TABLE_HEIGHT_M = 0.75;

/**
 * THE ROOM IS NOT ISOTROPIC, AND THIS IS THE HONEST NAME FOR IT.
 *
 * UNITS_PER_METRE above is derived from the felt's *length* (2.13 m across
 * 2 * FELT_RADIUS_X) and is right for everything lying on the cloth. The
 * felt's *height* was never derived from anything: FELT_TOP_Y is a legacy
 * 0.86, which under that same ruler is a 0.43 m table — a bit over knee
 * height. So the room's horizontal and vertical scales genuinely disagree,
 * by a factor of about 1.76.
 *
 * A character imported at UNITS_PER_METRE — which dimensions.ts used to
 * instruct, and which is correct in a room whose table is the right height —
 * would therefore stand nearly twice as tall as this table wants, head and
 * shoulders over a surface that only comes up to their shin. Until the felt
 * is raised (a room-wide change: FELT_TOP_Y feeds the camera framing, the
 * studio spot and their tests), a human is scaled by the ruler the TABLE
 * actually has, so that a seated player reads correctly against the one
 * object they are judged next to.
 *
 * Reconciling the two means moving FELT_TOP_Y to TABLE_HEIGHT_M *
 * UNITS_PER_METRE (~1.51) and re-solving the camera; on that day this
 * constant collapses into UNITS_PER_METRE and can be deleted.
 */
export const UNITS_PER_METRE_Y = FELT_TOP_Y / TABLE_HEIGHT_M;

/** Standing height of the roster's adult, in world units. */
export const HUMAN_STANDING_UNITS = HUMAN_STANDING_M * UNITS_PER_METRE_Y;
