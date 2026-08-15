/**
 * A bet, as a stack of physical chips: which colours, how many of each.
 *
 * This is the one place that answers "what does this number look like on the
 * cloth". Before it there were three greedy breakdowns in the tree --
 * `potChipStacks` (big blinds, four colours, for the 2D room),
 * `chipBreakdown` (absolute Gold, six colours, for the R3F room) and
 * `sprayDenominations` (a flattening of the first) -- and two colour tables
 * that had already drifted apart by a few hex points on every shared
 * denomination. Two drawings of the same chip disagreeing about its colour is
 * exactly the drift a shared constant exists to prevent, and it is invisible
 * until the two rooms are put side by side.
 *
 * WHAT IS SHARED AND WHAT IS NOT. The *ladder* and the *greedy* are shared:
 * `potChipStacks` is still the algorithm, called through rather than copied,
 * because it is the one with the tests and the display cap already reasoned
 * out. What this module adds is the colour, the flattening into individual
 * chips in the order they should physically leave a rail, and a unit-agnostic
 * front door so a caller working in Gold does not have to pretend to be
 * working in big blinds.
 *
 * WHY BIG BLINDS ARE STILL THE DEFAULT. A chip count means nothing on its own
 * -- 500 is a huge pot at 5/10 and a limp at 500/1000 -- so the felt has
 * always broken a pot down in big blinds and it must keep doing so, or a pile
 * stops meaning the same thing at every tier. `calculateChipDenominations`
 * takes the unit as a parameter rather than choosing for the caller.
 *
 * Pure, no rendering, no `three`, no DOM. In `lib/game/` beside `pot-chips.ts`
 * both because that is the algorithm it delegates to and because
 * `vitest.config.ts` collects only `lib/` and `app/`.
 */

import {
  MAX_CHIPS_PER_COLUMN,
  POT_CHIP_DENOMINATIONS_BB,
  potChipStacks,
  type PotChipStack,
} from "./pot-chips";

/**
 * A chip's colours, as one entry per denomination.
 *
 * Four roles, because that is what it takes to paint a clay chip that reads
 * as clay: the `body` is the moulded disc, `edge` the inserts spaced around
 * its rim, `inlay` the printed centre label, and `ink` the denomination
 * printed on that label. The 2D painter uses the first three; the numeral it
 * prints at desktop scale uses the fourth.
 *
 * Numbers, not CSS strings. The 2D room hands these to `shadeHex`, which does
 * channel arithmetic on them to derive its lit and shaded bevel steps, and a
 * palette stored as `"#1d1e1f"` would have to be parsed on every chip of
 * every frame to get back to the value it started as.
 */
export interface ChipColour {
  body: number;
  edge: number;
  inlay: number;
  ink: number;
}

/**
 * The house's chips.
 *
 * The four values a pot breaks into in big blinds are the four the 2D room
 * has always painted, at exactly the hexes it has always painted them --
 * these are lifted from its `CHIP_PALETTE` unchanged, deliberately, because
 * that palette is what every player is looking at today and this refactor is
 * not the place to restyle it. 500 and 1000 come from the R3F room's own
 * catalogue, which needs rungs above 100 because it counts in Gold.
 *
 * Casino convention, and worth not "tidying": white is the smallest, then
 * red, green, black, purple, gold. A player who has sat at a real table reads
 * the pile's value off the colours before they read any number, and swapping
 * two of these makes a pot lie at a glance.
 */
export const CHIP_COLOURS: Readonly<Record<number, ChipColour>> = {
  1: { body: 0xe9e4d4, edge: 0x2f67a8, inlay: 0xf7f2e4, ink: 0x3a4048 },
  5: { body: 0xbe3538, edge: 0xf1e9d8, inlay: 0xf7f2e4, ink: 0x7a1a15 },
  25: { body: 0x24704a, edge: 0xeef2e6, inlay: 0xf7f2e4, ink: 0x14472d },
  100: { body: 0x1d1e1f, edge: 0xd6c77f, inlay: 0xefe4bd, ink: 0x25262a },
  500: { body: 0x5d2d94, edge: 0xefe9f6, inlay: 0xe8dcf5, ink: 0x3d1a66 },
  1000: { body: 0xc8a02a, edge: 0x2b2418, inlay: 0xf6e7bb, ink: 0x5c4408 },
};

/**
 * The rung a chip falls back to when it is asked for a denomination the house
 * does not stock.
 *
 * An unknown denomination must produce a chip, not a hole: the alternative is
 * an untextured disc, and the amount is always legible as a number in the HUD
 * regardless of what the felt is showing.
 */
export const FALLBACK_CHIP_DENOMINATION = 1;

/** The colours for one denomination, falling back rather than returning null. */
export function chipColour(denomination: number): ChipColour {
  return CHIP_COLOURS[denomination] ?? CHIP_COLOURS[FALLBACK_CHIP_DENOMINATION];
}

/**
 * Chip values in absolute Gold, descending.
 *
 * Descending is load-bearing: the greedy below walks this in order and would
 * silently return a pile of ones if it were sorted the other way.
 */
export const CHIP_DENOMINATIONS_GOLD = [1000, 500, 100, 25, 5, 1] as const;

/** One denomination's column in a broken-down amount. */
export interface ChipBucket {
  /** The value of a single chip in this column, in whatever unit was asked for. */
  denomination: number;
  /** How many to draw. Never more than the column cap. */
  count: number;
  /** True when the display cap swallowed chips this column would have had. */
  capped: boolean;
  /** What this column is painted in. */
  colour: ChipColour;
}

export interface ChipDenominationOptions {
  /**
   * The big blind, when the breakdown should be expressed in big blinds --
   * which is what the felt wants, so a pile means the same thing at 5/10 and
   * at 500/1000. Omit it (or pass 0) to break the amount down in absolute
   * Gold instead, which is what a wallet-facing surface wants.
   */
  bigBlind?: number;
  /**
   * The tallest column to draw. Past this the next chip is simply not drawn:
   * nobody counts the eighth chip in a stack, and the exact value is always
   * readable as a number elsewhere. A visual cap, never an arithmetic one --
   * `capped` records that it bit.
   */
  maxPerColumn?: number;
}

/**
 * Break an amount into chip columns, tallest denomination first.
 *
 * The modular front door the whole chip engine goes through. Given a big
 * blind it delegates to `potChipStacks`, so the felt keeps the exact
 * breakdown, cap and sub-blind behaviour it already had and there is still
 * only one greedy in the tree. Without one it runs the same greedy over the
 * Gold ladder.
 *
 * Returns `[]` for anything that is not a positive, finite amount. A caller
 * that wants a chip on the cloth regardless of the arithmetic should say so
 * explicitly rather than have this invent one -- except in the one case
 * `potChipStacks` already owns, where a pot under one big blind still shows a
 * single chip because something really is in the middle.
 */
export function calculateChipDenominations(
  amount: number,
  options: ChipDenominationOptions = {},
): ChipBucket[] {
  const { bigBlind, maxPerColumn = MAX_CHIPS_PER_COLUMN } = options;
  if (!Number.isFinite(amount) || amount <= 0) return [];
  if (!Number.isFinite(maxPerColumn) || maxPerColumn <= 0) return [];

  const stacks: PotChipStack[] = bigBlind && bigBlind > 0
    ? potChipStacks(amount, bigBlind)
    : goldChipStacks(amount, maxPerColumn);

  return stacks
    // `potChipStacks` caps at its own MAX_CHIPS_PER_COLUMN; re-clamp so a
    // caller asking for a shorter column gets one rather than being quietly
    // handed six.
    .map((stack) => ({
      denomination: stack.denomination,
      count: Math.min(stack.count, maxPerColumn),
      capped: stack.capped || stack.count > maxPerColumn,
      colour: chipColour(stack.denomination),
    }))
    .filter((bucket) => bucket.count > 0);
}

/** The same greedy as `potChipStacks`, over the absolute-Gold ladder. */
function goldChipStacks(amount: number, maxPerColumn: number): PotChipStack[] {
  const stacks: PotChipStack[] = [];
  let remaining = Math.floor(amount);

  for (const denomination of CHIP_DENOMINATIONS_GOLD) {
    const wanted = Math.floor(remaining / denomination);
    if (wanted <= 0) continue;
    stacks.push({
      denomination,
      count: Math.min(wanted, maxPerColumn),
      capped: wanted > maxPerColumn,
    });
    // The uncapped `wanted`, so a swallowed chip does not leak its value down
    // into a tower of ones -- the same subtraction `potChipStacks` makes.
    remaining -= wanted * denomination;
  }
  return stacks;
}

/** Total chips a breakdown draws, which is what bounds the work per frame. */
export function chipBucketCount(buckets: ChipBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}

/** One physical chip, in the order it should leave the rail. */
export interface ChipSpec {
  denomination: number;
  colour: ChipColour;
  /** Its place in the departure order, which is what the stagger multiplies. */
  index: number;
}

/**
 * A breakdown flattened into individual chips, smallest denomination first.
 *
 * Smallest first is how a dealer's hand actually leaves a rail -- the change
 * goes out ahead of the big ones -- and it is what makes a truncated spray
 * read correctly: the flight is capped at `limit`, so dropping the tail has
 * to drop the *cheap* chips and keep the black hundreds, which is the signal
 * a player reads the bet's size from.
 *
 * Note the order is the reverse of the columns a pile is *stacked* in, and
 * deliberately so: a resting stack reads largest at the bottom.
 */
export function flattenChipBuckets(buckets: ChipBucket[], limit = Infinity): ChipSpec[] {
  const chips: ChipSpec[] = [];
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.count; i += 1) {
      chips.push({ denomination: bucket.denomination, colour: bucket.colour, index: 0 });
    }
  }
  const kept = Number.isFinite(limit) && limit >= 0
    // Slice before reversing, never after. `buckets` arrives largest-first,
    // so the head of this list is the black hundreds and the tail is the
    // small change -- truncating the head would throw away exactly the chips
    // that carry the bet's size and leave a shove looking like a limp.
    ? chips.slice(0, Math.floor(limit))
    : chips;
  return kept.reverse().map((chip, index) => ({ ...chip, index }));
}

/**
 * The denominations of a bet, smallest first, ready to be flown one per
 * stagger step. The shape the chip layer consumes.
 */
export function chipFlightPlan(
  amount: number,
  options: ChipDenominationOptions & { maxChips?: number } = {},
): ChipSpec[] {
  const { maxChips = Infinity, ...rest } = options;
  return flattenChipBuckets(calculateChipDenominations(amount, rest), maxChips);
}

/**
 * A `ChipColour` channel as a CSS hex string, for the one DOM consumer
 * (the landscape nameplate's chip glyph, components/table/player-seat.tsx) --
 * everything else here stays numbers on purpose, see `ChipColour`'s own note.
 */
export function cssHex(channel: number): string {
  return `#${channel.toString(16).padStart(6, "0")}`;
}

/** Every denomination the house stocks, descending. For tests and catalogues. */
export const ALL_CHIP_DENOMINATIONS: readonly number[] = Object.keys(CHIP_COLOURS)
  .map(Number)
  .sort((a, b) => b - a);

/** Re-exported so a caller needs one import to talk about the felt's unit. */
export { POT_CHIP_DENOMINATIONS_BB, MAX_CHIPS_PER_COLUMN };
