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
