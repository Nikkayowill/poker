/**
 * The Crop Fields' own unlock -- what used to be clearing the `meadow`
 * sector, before the 2026-09-08 map restructure merged that district into
 * the Farmstead outright (see ./zones.ts's own header).
 *
 * WHY THIS IS ITS OWN MODULE, NOT A ROW IN ./sectors.ts. `SectorId` there is
 * deliberately `ZoneId` itself -- a sector IS a district, on purpose, so the
 * two can never drift apart. The Farmstead is a HOME sector: permanently
 * unlocked, no price, no requirement, from the first second a farm exists.
 * Once the Crop Fields became part of that same district, they could not
 * stay a sector clear -- a district cannot be both free to walk into and
 * gated behind Gold at the same time. So the gate moved here instead: the
 * same 15,000 Gold, the same 2 units owned, the same promise, just checked
 * against a standalone flag (`homestead_crop_fields`, one row per farm)
 * rather than against `homestead_sectors`.
 *
 * SAME SHAPE AS `sectorClearCheck`, ON PURPOSE. `CropFieldsUnlockCheck`
 * mirrors `SectorClearCheck` field for field, and `cropFieldsUnlockCheck`
 * is pure for the identical reason that one is: the client renders it to
 * build a requirements checklist, the server (see
 * lib/server/stackacres-service.ts's `unlockStackAcresCropFields`) evaluates
 * the same function before a single piece of Gold moves, and a modal that
 * promises something the route then refuses is the failure mode this shape
 * exists to make impossible.
 */

/** Gold to unlock the Crop Fields, once, forever -- the same price clearing
 *  the old `meadow` sector cost. Land should still cost about what land
 *  cost; see ./sectors.ts's own note on the ladder's pricing for the anchor
 *  this and every other clear cost is sized against. */
export const CROP_FIELDS_UNLOCK_COST_GOLD = 15_000;

/**
 * Units the player must have standing anywhere before the Crop Fields are
 * offered. Two hens: enough that somebody has run a cycle and collected it,
 * low enough that it is met on the first afternoon rather than farmed for --
 * the same reasoning ./sectors.ts's own `requiresUnits` field states, and
 * the same number `meadow` always required.
 */
export const CROP_FIELDS_UNLOCK_REQUIRES_UNITS = 2;

/** What the unlock modal says is under the growth. Same promise `meadow`
 *  always made. */
export const CROP_FIELDS_PROMISE =
  "Cleared, this becomes your Crop Fields — Carrots, Corn, and everything between.";

/** One line of the modal's checklist: what is being asked, and whether this
 *  farm has it yet. Same shape as ./sectors.ts's own `SectorRequirement`. */
export interface CropFieldsRequirement {
  /** Written for the player, not for a log. */
  label: string;
  met: boolean;
}

export interface CropFieldsUnlockCheck {
  /** Gold. Shown whether or not the requirements are met -- a player deciding
   *  whether to save up needs the number before they qualify for it. */
  cost: number;
  /** True once every requirement below is met. Says nothing about Gold: the
   *  balance is the server's to judge, the same posture every other Gold
   *  spend in this app takes (see ./sectors.ts's own `SectorClearCheck`). */
  ok: boolean;
  requirements: CropFieldsRequirement[];
  /** Set when there is nothing left to unlock -- already unlocked. */
  alreadyOpen: boolean;
}

/**
 * Whether the Crop Fields can be unlocked right now, and what is missing if
 * not. Same "one function, two surfaces" contract as `sectorClearCheck`:
 * the unlock modal renders this straight, and the server calls it before a
 * single piece of Gold moves.
 */
export function cropFieldsUnlockCheck(context: {
  unlocked: boolean;
  unitCount: number;
}): CropFieldsUnlockCheck {
  if (context.unlocked) {
    return { cost: CROP_FIELDS_UNLOCK_COST_GOLD, ok: false, requirements: [], alreadyOpen: true };
  }
  const requirements: CropFieldsRequirement[] = [
    {
      label: `Keep ${CROP_FIELDS_UNLOCK_REQUIRES_UNITS} crops or animals going (you have ${context.unitCount})`,
      met: context.unitCount >= CROP_FIELDS_UNLOCK_REQUIRES_UNITS,
    },
  ];
  return {
    cost: CROP_FIELDS_UNLOCK_COST_GOLD,
    ok: requirements.every((requirement) => requirement.met),
    requirements,
    alreadyOpen: false,
  };
}
