/**
 * Where chips sit: how an amount becomes a set of chips, and where those
 * chips stand on the cloth.
 *
 * Two jobs, and they are separate on purpose.
 *
 * THE BREAKDOWN turns a number into denominations, greedily and largest-
 * first, in big blinds — the only unit a player reasons in, and the one that
 * makes a pile mean the same thing at 5/10 and at 500/1000. Every chip in the
 * room comes from here, so a bet's spray is denominated exactly like the pile
 * it lands in and a payout leaves as the money it is.
 *
 * THE LAYOUT decides which slot each of those chips occupies. This is where
 * the pot stops being a list and becomes an object you can size at a glance,
 * and it is the part that was worth rebuilding rather than tuning.
 *
 * WHY THE OLD LAYOUT COULD NOT COMMUNICATE A POT SIZE. It filled sixteen
 * chips upward before opening the next column, five columns across, in one
 * flat row. Two things follow. A pot of twenty and a pot of eighty are two
 * columns and five columns of the same silhouette — a wall — so the only
 * difference is width, and width is the axis the table has least of. And a
 * sixteen-high column at a 3px pitch is fifty pixels of vertical chip, which
 * on a phone plate is most of the felt's visible depth; the pot stopped being
 * a thing on the table and became a bar chart standing on it.
 *
 * What replaces it is a mound. Columns are capped at a height a dealer would
 * actually cut, and a pot that outgrows one column opens a second, then a
 * row behind, then an apex behind that — the footprint grows into the table's
 * depth as well as its width, and the silhouette goes from a chip, to a
 * stack, to a triangle. That progression is readable without counting
 * anything, which is the entire requirement: the exact number is in the HUD
 * and always has been.
 *
 * All offsets are in world units, expressed as multiples of the chip radius
 * the renderer solved for this fit (see `solveChipWorldRadius`) — so the mound
 * stays a mound on a plate where chips had to be drawn larger than the
 * projection would have made them.
 *
 * Pure and deterministic. Nothing here reads a clock, a canvas or
 * `Math.random()`.
 */

import { POT_CHIP_DENOMINATIONS_BB } from "@/lib/game/pot-chips";

/* ------------------------------------------------------------------ *
 * The breakdown.
 * ------------------------------------------------------------------ */

export interface ChipUnit {
  /** Chip value in big blinds. */
  denomination: number;
  /**
   * This chip's ordinal *within its own denomination*, stable as the amount
   * grows.
   *
   * The identity half of the keyed sync: raising a pot from three chips to
   * four has to add one chip, not rebuild the pile, or every chip on the felt
   * replays its landing every time anybody bets.
   */
  denominationIndex: number;
}

/**
 * An amount as chips, largest denomination first.
 *
 * `maxChips` truncates the tail, which drops singles long before it drops a
 * hundred — the cut a dealer would make, and the reason the cap costs
 * legibility rather than accuracy. A positive amount always yields at least
 * one chip: something is in the middle, and rounding it away would make the
 * felt disagree with the readout above it.
 */
export function chipBreakdown(amount: number, bigBlind: number, maxChips: number): ChipUnit[] {
  if (!Number.isFinite(amount) || !Number.isFinite(bigBlind)) return [];
  if (amount <= 0 || bigBlind <= 0) return [];
  const cap = Math.max(0, Math.floor(maxChips));
  if (cap === 0) return [];

  const units: ChipUnit[] = [];
  let remaining = amount / bigBlind;
  for (const denomination of POT_CHIP_DENOMINATIONS_BB) {
    const wanted = Math.floor(remaining / denomination);
    if (wanted <= 0) continue;
    const shown = Math.min(wanted, cap - units.length);
    for (let denominationIndex = 0; denominationIndex < shown; denominationIndex += 1) {
      units.push({ denomination, denominationIndex });
    }
    remaining -= wanted * denomination;
    if (units.length >= cap) break;
  }

  if (units.length === 0) {
    units.push({ denomination: POT_CHIP_DENOMINATIONS_BB[POT_CHIP_DENOMINATIONS_BB.length - 1], denominationIndex: 0 });
  }
  return units;
}

/**
 * The order chips *leave* in for a spray: smallest first.
 *
 * The big denominations land last and end up on top of the stack they build,
 * which is where they read — the same way a dealer's cut stack shows its
 * hundreds at the crown.
 */
export function spraySequence(amount: number, bigBlind: number, maxChips: number): number[] {
  return chipBreakdown(amount, bigBlind, maxChips)
    .map((unit) => unit.denomination)
    .reverse();
}

/* ------------------------------------------------------------------ *
 * The layout.
 * ------------------------------------------------------------------ */

/**
 * How tall a column gets before the pile opens another.
 *
 * Nine is roughly what a hand cuts in one motion, and it is also the height
 * at which a column stops being countable at a glance — past it the eye is
 * reading a bar, not chips.
 */
export const COLUMN_CAP = 9;

/**
 * The height the mound *aims* for before widening.
 *
 * Lower than the cap so growth shows up as a new column rather than as the
 * one column creeping upward: a wider footprint is far easier to read across
 * the table than three more chips on an existing stack.
 */
const COLUMN_TARGET = 6;

/** The widest the mound ever gets, in columns. */
export const MAX_POT_COLUMNS = 6;

/** The most chips the centre pile ever draws. Past this the HUD carries it. */
export const MAX_POT_CHIPS = MAX_POT_COLUMNS * COLUMN_CAP;

/** A standing bet is a cut stack, not a pile; it stays narrow. */
export const MAX_BET_COLUMNS = 3;
export const MAX_BET_CHIPS = MAX_BET_COLUMNS * COLUMN_CAP;

/** Column pitch and row depth, in chip radii. */
const COLUMN_SPACING = 2.3;
const ROW_SPACING = 2.4;

/**
 * The mound, per column count, as (column, row) coordinates.
 *
 * Hand-authored rather than generated, because the shape is the feature and
 * six cases is cheaper to read than the formula that would produce them.
 * Positive `row` is toward the viewer, so the wide row is the near one and
 * the apex sits at the back — the near row draws last and overlaps the far,
 * which is what turns a set of stacks into a single mound rather than a line
 * of separate towers.
 *
 * Columns are in units of COLUMN_SPACING and rows in units of ROW_SPACING;
 * both are multiplied by the fit's chip radius at the end.
 */
const MOUND_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  /* 1 */[[0, 0]],
  /* 2 */[[-0.5, 0], [0.5, 0]],
  /* 3 */[[-0.5, 0.5], [0.5, 0.5], [0, -0.5]],
  /* 4 */[[-1, 0.5], [0, 0.5], [1, 0.5], [0, -0.5]],
  /* 5 */[[-1, 0.5], [0, 0.5], [1, 0.5], [-0.5, -0.5], [0.5, -0.5]],
  /* 6 */[[-1, 0.7], [0, 0.7], [1, 0.7], [-0.5, 0], [0.5, 0], [0, -0.7]],
];

export interface StackSlot {
  /** Plan-space offset from the pile's own centre, in world units. */
  offsetX: number;
  offsetZ: number;
  /** How many chips are underneath this one in its own column. */
  index: number;
  /** Which column of the mound it stands in. */
  column: number;
}

/**
 * How many columns a pile of `chipCount` chips spreads across.
 *
 * Exported because it is the whole "read the pot without reading the number"
 * claim in one function, and a test pins that it never shrinks as the pot
 * grows — a pot that got bigger and looked smaller would be worse than no
 * signal at all.
 */
export function columnCount(chipCount: number, maxColumns: number): number {
  if (chipCount <= 0) return 0;
  return Math.min(Math.max(1, Math.ceil(chipCount / COLUMN_TARGET)), maxColumns);
}

/**
 * Distribute `chipCount` chips over `columns`, tallest in the middle.
 *
 * The remainder goes to the centre columns first, so an uneven pile peaks
 * rather than stepping — the difference between a mound and a staircase, and
 * the reason the large-pot silhouette reads as a pyramid.
 */
export function columnHeights(chipCount: number, columns: number): number[] {
  if (columns <= 0 || chipCount <= 0) return [];
  const base = Math.floor(chipCount / columns);
  let remainder = chipCount - base * columns;
  const heights = new Array<number>(columns).fill(base);
  // Centre outward: 2, 3, 1, 4, 0 ... for five columns.
  const centre = (columns - 1) / 2;
  const order = heights
    .map((_, index) => index)
    .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre) || a - b);
  for (const index of order) {
    if (remainder <= 0) break;
    heights[index] += 1;
    remainder -= 1;
  }
  return heights;
}

/**
 * Every chip's slot in a pile, in draw order.
 *
 * The returned array is indexed by the chip's ordinal in the breakdown, which
 * is what lets the caller key a chip by `denomination:index` and hand a
 * settled chip its identical slot on the next snapshot. When the pile
 * re-tiers — a fourth column opening — every chip gets a new slot and the
 * caller retargets rather than respawns, so the mound visibly reorganises
 * instead of blinking.
 */
export function pileSlots(chipCount: number, chipRadius: number, maxColumns: number): StackSlot[] {
  const count = Math.min(Math.max(0, Math.floor(chipCount)), maxColumns * COLUMN_CAP);
  if (count === 0) return [];
  const columns = columnCount(count, maxColumns);
  const heights = columnHeights(count, columns);
  const shape = MOUND_SHAPES[Math.min(columns, MOUND_SHAPES.length) - 1];

  const slots: StackSlot[] = [];
  for (let column = 0; column < columns; column += 1) {
    const [columnUnit, rowUnit] = shape[Math.min(column, shape.length - 1)];
    for (let index = 0; index < heights[column]; index += 1) {
      slots.push({
        offsetX: columnUnit * COLUMN_SPACING * chipRadius,
        offsetZ: rowUnit * ROW_SPACING * chipRadius,
        index,
        column,
      });
    }
  }
  return slots;
}

/**
 * A standing bet's slots: one cut stack, widening only when it has to.
 *
 * Deliberately not the mound. A bet is a gesture by one player at one spot on
 * the rail, and a six-column pyramid in front of a seat would read as a
 * second pot — at six seats they would run into each other. Columns here
 * spread sideways along the line handed in by the caller, never into depth.
 */
export function betSlots(chipCount: number, chipRadius: number): StackSlot[] {
  const count = Math.min(Math.max(0, Math.floor(chipCount)), MAX_BET_CHIPS);
  if (count === 0) return [];
  const columns = Math.min(Math.ceil(count / COLUMN_TARGET), MAX_BET_COLUMNS);
  const heights = columnHeights(count, columns);
  const spread = (columns - 1) / 2;

  const slots: StackSlot[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let index = 0; index < heights[column]; index += 1) {
      slots.push({
        offsetX: (column - spread) * COLUMN_SPACING * chipRadius,
        offsetZ: 0,
        index,
        column,
      });
    }
  }
  return slots;
}
