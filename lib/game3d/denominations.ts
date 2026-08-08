/**
 * Chip denomination breakdown for the 3D room — which physical chips a Gold
 * amount is rendered as. Visual only: the HUD's numbers are the authority on
 * value, these are the props on the felt.
 */

/**
 * A chip's four colours, which is what a real one has: a clay body, the
 * contrasting inserts moulded into its edge and repeated around its face,
 * the printed inlay at the centre, and the ink on that inlay.
 *
 * Two flat colours — a body and a lighter top — was the entire palette
 * before, and it is most of why the chips read as plastic counters. A real
 * chip is legible by its *edge*, which is exactly what an untextured
 * cylinder throws away. The colours follow house convention (white 1, red 5,
 * green 25, black 100, purple 500, gold 1000), so anyone who has seen a card
 * room can price a pile without reading a number off it.
 */
export interface ChipDenomination {
  value: number;
  /** Clay body: the edge, and the outer ring of both faces. */
  body: string;
  /** Moulded inserts: spots around the edge, wedges around the face. */
  spot: string;
  /** The printed inlay disc at the centre of each face. */
  inlay: string;
  /** Ink on the inlay — the denomination itself. */
  ink: string;
}

/** Largest first; the greedy breakdown below depends on that ordering. */
export const CHIP_DENOMINATIONS: ChipDenomination[] = [
  { value: 1000, body: "#c8a02a", spot: "#2b2418", inlay: "#f6e7bb", ink: "#5c4408" },
  { value: 500, body: "#5d2d94", spot: "#efe9f6", inlay: "#e8dcf5", ink: "#3d1a66" },
  { value: 100, body: "#1d1f24", spot: "#d8c98a", inlay: "#e9e2cd", ink: "#25262a" },
  { value: 25, body: "#1f6e46", spot: "#f0f4ec", inlay: "#e4efe6", ink: "#14472d" },
  { value: 5, body: "#a92c25", spot: "#f2e9da", inlay: "#f3e4dd", ink: "#7a1a15" },
  { value: 1, body: "#e4dfd2", spot: "#2f67a8", inlay: "#f7f3e6", ink: "#3a4048" },
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
