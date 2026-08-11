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
 * Hard cap on chips rendered for one amount. Past the cap the remainder is
 * simply not drawn (the same FUNNEL_CHIP_COUNT reasoning the 2D room
 * documents — the HUD, and now the floating amount label, state the true
 * number).
 *
 * Raised from 14 with the move to side-by-side columns. 14 was a ceiling on
 * a single tower's HEIGHT, and height stopped being the constraint the
 * moment `pileSlot` started breaking a pile into stacks of
 * CHIPS_PER_COLUMN the way a dealer does. 60 is three full stacks.
 */
export const MAX_CHIPS_PER_PILE = 60;

/**
 * How many physical chips a pile of this size is drawn with.
 *
 * MONOTONIC IS THE WHOLE POINT, AND IT REPLACES A REAL DEFECT. The pile
 * used to be however many chips a greedy largest-first breakdown happened
 * to produce, which is NOT monotonic in the amount and is not close: a 90
 * pot broke into nine 25s and 5s, a 100 pot into a single black chip. So a
 * pot that grew across a denomination boundary made its own pile visibly
 * COLLAPSE — 9 chips to 1 at 100, 5 chips to 1 at 1000, and again at every
 * boundary above. That is the "the stack falls when it should get taller"
 * read, and no amount of stacking work fixes it, because the chips were
 * never there to stack.
 *
 * A square root rather than a straight ratio, because a real pot does not
 * grow linearly either — a dealer colours up, so a pot ten times larger is
 * a few times the physical clay, not ten times. Monotonic by construction
 * (sqrt is), bounded by construction, and pinned by a test that walks every
 * amount from 1 to 100,000 and asserts the count never once decreases.
 */
const PILE_SCALE = 12;

export function pileChipTarget(amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  if (value <= 0) return 0;
  return Math.min(MAX_CHIPS_PER_PILE, Math.max(1, Math.ceil(Math.sqrt(value / PILE_SCALE))));
}

/** Greedy breakdown over a denomination list, largest first. */
function greedy(amount: number, denominations: ChipDenomination[]): ChipDenomination[] {
  const chips: ChipDenomination[] = [];
  let remaining = amount;
  for (const denom of denominations) {
    while (remaining >= denom.value && chips.length < MAX_CHIPS_PER_PILE) {
      chips.push(denom);
      remaining -= denom.value;
    }
    if (chips.length >= MAX_CHIPS_PER_PILE) break;
  }
  return chips;
}

/**
 * The chips a pile is drawn as: as close to `pileChipTarget` of them as the
 * denominations allow, largest at the bottom.
 *
 * Reaching the target is a matter of using SMALLER clay, which is exactly
 * what a card room does — nobody at a 10-blind table pushes a single
 * thousand chip into the middle. So the greedy pass is retried with the
 * largest denomination progressively withheld until the pile is as tall as
 * it should be, and the first breakdown that reaches the target wins —
 * first, so the pile keeps the largest chips that can still make the count.
 * A 1000 pot comes out as ten blacks rather than one gold; a 100 pot as
 * four greens rather than one black.
 *
 * THE TRADE, STATED RATHER THAN BURIED. Because the count grows as a square
 * root and the denominations step by 5x, the chips on the cloth do not add
 * up to the amount at large pots — a 5,000 pot draws 21 blacks, which a
 * player who counted them would price at 2,100. That is deliberate and it
 * is the same contract the cap has always had: the pile is a SIZE cue, and
 * the authority on value is the number beside it (hud/bet-amounts.tsx) and
 * the HUD's own pot readout. Trading exact value for a pile that never
 * shrinks as the pot grows is the right way round, because one of those two
 * is something a player actually notices.
 */
export function chipBreakdown(amount: number): ChipDenomination[] {
  const value = Math.max(0, Math.floor(amount));
  const target = pileChipTarget(value);
  if (target === 0) return [];

  for (let skip = 0; skip < CHIP_DENOMINATIONS.length; skip += 1) {
    const chips = greedy(value, CHIP_DENOMINATIONS.slice(skip));
    if (chips.length >= target) return chips.slice(0, target);
  }
  // Nothing but the smallest chip can reach the target — take what it gives.
  // (Only for amounts small enough that the target is 1, where any single
  // chip is already the whole pile.)
  return greedy(value, CHIP_DENOMINATIONS.slice(-1)).slice(0, target);
}
