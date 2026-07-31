/**
 * How a pot looks as physical chips.
 *
 * Measured in big blinds rather than chips, because the chip number means
 * nothing on its own: 500 is a huge pot at 5/10 and a limp at 500/1000. The
 * big blind is the only unit a player actually reasons in, and it is the one
 * that makes a pile mean the same thing at every tier.
 *
 * Broken down greedily, largest denomination first, the way a dealer stacks
 * one -- so a pot reads as "a couple of tall stacks of the good ones" rather
 * than a hundred singles, and so the pile changes shape as it grows instead of
 * only getting taller.
 */

/** Chip values, in big blinds. Descending; the breakdown depends on it. */
export const POT_CHIP_DENOMINATIONS_BB = [100, 25, 5, 1] as const;

/**
 * Past this a column stops growing and the next chip of that denomination is
 * simply not drawn.
 *
 * A visual cap, not an arithmetic one. Nobody counts the eighth chip in a
 * stack, and an uncapped pile would put hundreds of nodes on the felt in a
 * deep-stacked pot for a difference no one can see. The pot's exact value is
 * always readable as a number in the HUD, which is where precision belongs.
 */
export const MAX_CHIPS_PER_COLUMN = 6;

export interface PotChipStack {
  /** Chip value in big blinds. */
  denomination: number;
  /** How many to draw, never more than MAX_CHIPS_PER_COLUMN. */
  count: number;
  /** True when the cap swallowed chips this column would otherwise have. */
  capped: boolean;
}

/**
 * The pile for a pot, tallest denomination first, or an empty list when there
 * is nothing to show.
 *
 * A pot smaller than one big blind but larger than nothing still gets a single
 * chip: something is in the middle, and rounding it away would make the felt
 * disagree with the readout above it.
 */
export function potChipStacks(pot: number, bigBlind: number): PotChipStack[] {
  if (!Number.isFinite(pot) || !Number.isFinite(bigBlind)) return [];
  if (pot <= 0 || bigBlind <= 0) return [];

  const inBigBlinds = pot / bigBlind;
  const stacks: PotChipStack[] = [];
  let remaining = inBigBlinds;

  for (const denomination of POT_CHIP_DENOMINATIONS_BB) {
    const wanted = Math.floor(remaining / denomination);
    if (wanted <= 0) continue;
    const count = Math.min(wanted, MAX_CHIPS_PER_COLUMN);
    stacks.push({ denomination, count, capped: wanted > count });
    remaining -= wanted * denomination;
  }

  // Under one big blind: still chips on the table, so still a chip on the felt.
  if (stacks.length === 0) {
    return [{ denomination: POT_CHIP_DENOMINATIONS_BB.at(-1)!, count: 1, capped: false }];
  }
  return stacks;
}

/** Total chips drawn, which is what bounds the DOM the felt has to carry. */
export function potChipCount(stacks: PotChipStack[]): number {
  return stacks.reduce((total, stack) => total + stack.count, 0);
}
