/**
 * Bountiful Harvest: the bonus for gathering things that go together.
 *
 * A harvest here is one sweep -- every unit settled in a single collect --
 * rather than a unit at a time, and that is what makes a synergy expressible
 * at all: the bonus is a property of the SET, not of any row in it.
 *
 * TWO BONUSES, AND THEY CANNOT STACK. That is a structural property, not a
 * rule enforced by a check:
 *
 *   * **Mono-cropping** wants every unit in the sweep to be the same kind.
 *   * **Crop Rotation** wants both tracks present -- something grown and
 *     something an animal made.
 *
 * A set cannot be both, so `bountifulHarvest` returns at most one. Anything
 * that later adds a third bonus has to decide explicitly whether it stacks;
 * there is a test pinning "never more than one applies" so that decision
 * cannot be made by accident.
 *
 * THE CEILING IS NOT AFFECTED BY ANY OF THIS. A multiplier raises what a
 * sweep is worth, and the sweep is still paid through the same flat daily
 * allowance every farm shares -- see ./exchange.ts. A bonus makes a good day
 * arrive sooner; it does not make the day bigger. That is the same thing the
 * Gold market's own header says about permanent stock, and it is the property
 * to check if these numbers are ever retuned upward.
 */

import { isLivestock, type StackAcresStock } from "./catalogue";

/** Fewest units in a sweep before any bonus is considered. */
export const BOUNTIFUL_MIN_UNITS = 3;

/**
 * Mono-cropping pays per unit past the second, so the third unit is the first
 * one that earns anything. Capped, because the capacity ladder tops out at 6
 * of a kind and an uncapped per-unit step would make the last slot worth
 * buying for the multiplier rather than for the yield.
 */
export const MONO_CROP_STEP = 0.05;
export const MONO_CROP_MAX_MULTIPLIER = 1.3;

/**
 * Crop Rotation pays for BALANCE rather than for variety: the multiplier is
 * driven by the smaller of the two tracks as a share of the sweep, so four
 * cattle and one carrot is not a rotation. At a perfect half-and-half split
 * the share is 0.5 and the bonus is at its cap.
 */
export const CROP_ROTATION_RATE = 0.5;
export const CROP_ROTATION_MAX_MULTIPLIER = 1.25;
export const CROP_ROTATION_MIN_SHARE = 1 / 3;

export type BountifulKind = "mono_crop" | "crop_rotation";

export interface BountifulHarvest {
  /** Which bonus applied, or null for an ordinary sweep. */
  kind: BountifulKind | null;
  /** What the gross is multiplied by. Always >= 1, so a bonus never costs. */
  multiplier: number;
  /** Banner copy, or null when nothing applied. */
  label: string | null;
  /** One line saying why it applied, for the harvest toast. */
  detail: string | null;
}

const NONE: BountifulHarvest = { kind: null, multiplier: 1, label: null, detail: null };

/**
 * Multipliers are built from repeated addition of 0.05, which in binary
 * floating point lands on things like 1.1500000000000001. Rounded to four
 * places so the value that reaches a test, a payout and a piece of UI copy is
 * the one a person would write down.
 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** What a sweep of these kinds earns as a synergy, if anything. */
export function bountifulHarvest(stocks: readonly StackAcresStock[]): BountifulHarvest {
  const count = stocks.length;
  if (count < BOUNTIFUL_MIN_UNITS) return NONE;

  const livestock = stocks.filter(isLivestock).length;
  const crops = count - livestock;

  // Mono-cropping first: one kind throughout is the stricter condition, and a
  // set that satisfies it can never satisfy rotation (one kind sits in one
  // track), so the order here is documentation rather than precedence.
  const kinds = new Set(stocks);
  if (kinds.size === 1) {
    const multiplier = round4(
      Math.min(MONO_CROP_MAX_MULTIPLIER, 1 + MONO_CROP_STEP * (count - (BOUNTIFUL_MIN_UNITS - 1))),
    );
    return {
      kind: "mono_crop",
      multiplier,
      label: "Mono-cropping",
      detail: `${count} of one kind brought in together.`,
    };
  }

  if (crops === 0 || livestock === 0) return NONE;

  const share = Math.min(crops, livestock) / count;
  if (share < CROP_ROTATION_MIN_SHARE) return NONE;

  const multiplier = round4(
    Math.min(CROP_ROTATION_MAX_MULTIPLIER, 1 + CROP_ROTATION_RATE * share),
  );
  return {
    kind: "crop_rotation",
    multiplier,
    label: "Crop Rotation",
    detail: `${crops} from the fields and ${livestock} from the pens, in balance.`,
  };
}

/**
 * What a gross is worth once the sweep's synergy is applied.
 *
 * FLOORED, never rounded. A bonus may not invent a Gold piece out of a
 * rounding rule -- the same posture `bushelsWithinAllowance` took when it
 * rounded an allowance down.
 */
export function applyBountifulHarvest(gross: number, bounty: BountifulHarvest): number {
  return Math.floor(gross * bounty.multiplier);
}
