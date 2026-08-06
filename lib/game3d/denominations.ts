/**
 * Chip denomination breakdown for the 3D room — which physical chips a Gold
 * amount is rendered as. Visual only: the HUD's numbers are the authority on
 * value, these are the props on the felt.
 */

export interface ChipDenomination {
  value: number;
  /** Body colour of the chip side/edge. */
  color: string;
  /** Lighter face colour for the top surface. */
  face: string;
}

/** Largest first; the greedy breakdown below depends on that ordering. */
export const CHIP_DENOMINATIONS: ChipDenomination[] = [
  { value: 1000, color: "#c9971d", face: "#e8bb4a" },
  { value: 500, color: "#6d34ad", face: "#8d4fd6" },
  { value: 100, color: "#23252b", face: "#3c4049" },
  { value: 25, color: "#1f6e46", face: "#2f9a63" },
  { value: 5, color: "#a52a22", face: "#cc4a3f" },
  { value: 1, color: "#3d5f94", face: "#5b82c0" },
];

/**
 * Hard cap on chips rendered for one amount. Big pots would otherwise build
 * towers that outgrow the camera and the frame budget; past the cap the
 * remainder is simply not drawn (the same FUNNEL_CHIP_COUNT reasoning the
 * 2D room documents — the HUD states the true number).
 */
export const MAX_CHIPS_PER_PILE = 14;

/** Greedy denomination breakdown, largest chips first, capped for display. */
export function chipBreakdown(amount: number): ChipDenomination[] {
  const chips: ChipDenomination[] = [];
  let remaining = Math.max(0, Math.floor(amount));
  for (const denom of CHIP_DENOMINATIONS) {
    while (remaining >= denom.value && chips.length < MAX_CHIPS_PER_PILE) {
      chips.push(denom);
      remaining -= denom.value;
    }
    if (chips.length >= MAX_CHIPS_PER_PILE) break;
  }
  return chips;
}
