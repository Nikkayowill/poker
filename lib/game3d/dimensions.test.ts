import { describe, expect, it } from "vitest";
import {
  CARD,
  CARD_GAP,
  CHIP,
  DEALER_BUTTON,
  HUMAN_SEATED_HEAD_M,
  HUMAN_STANDING_M,
  HUMAN_STANDING_UNITS,
  TABLE_HEIGHT_M,
  TABLE_LENGTH_M,
  UNITS_PER_METRE,
  UNITS_PER_METRE_Y,
  mm,
} from "./dimensions";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  TABLE_WIDTH_M,
  TABLE_LENGTH_M as LAYOUT_TABLE_LENGTH_M,
} from "./seat-layout";

describe("the room's ruler", () => {
  it("resolves the felt to a real table's length", () => {
    expect((2 * FELT_RADIUS_X) / UNITS_PER_METRE).toBeCloseTo(TABLE_LENGTH_M, 6);
  });

  it("resolves the felt to a real table's WIDTH on the other axis too", () => {
    // The ruler was anchored to the felt's length alone, and the depth was a
    // literal 1.32 that nothing checked — a 1.63:1 oval claiming to be a
    // six-max table, which is very close to 2:1. Both axes are measured
    // here, so the room can no longer be the right size in one direction and
    // the wrong shape overall.
    expect((2 * FELT_RADIUS_Z) / UNITS_PER_METRE).toBeCloseTo(TABLE_WIDTH_M, 6);
  });

  it("has exactly one statement of the table's length", () => {
    // dimensions.ts re-exports seat-layout's constant rather than declaring a
    // second 2.13, because the depth derivation needs it and this file cannot
    // export to seat-layout without a cycle.
    expect(TABLE_LENGTH_M).toBe(LAYOUT_TABLE_LENGTH_M);
  });

  it("converts millimetres through that one scale", () => {
    expect(mm(1000)).toBeCloseTo(UNITS_PER_METRE, 6);
    expect(mm(0)).toBe(0);
  });
});

describe("the vertical ruler a person is scaled by", () => {
  it("resolves the felt's height to a real table's height", () => {
    expect(FELT_TOP_Y / UNITS_PER_METRE_Y).toBeCloseTo(TABLE_HEIGHT_M, 6);
  });

  it("stands an adult the right height for THIS table, not a metric one", () => {
    // 1.75 m under a 0.75 m table's own ruler. Importing at UNITS_PER_METRE
    // instead — which dimensions.ts used to instruct — used to make the same
    // adult taller, which is the mistake this constant exists to stop. The
    // margin was 1.5x, then 1.4x, then 1.15x, each sized against a
    // progressively smaller FELT_RADIUS_X (seat-layout.ts): pulling the
    // table's horizontal ruler in to fix its size relative to a
    // fixed-height avatar roster also narrows the two rulers' gap (see
    // "records that the room is anisotropic" below).
    //
    // The fourth pull-in (1.45 -> 1.2) crossed the gap rather than just
    // narrowing it: UNITS_PER_METRE is now the SMALLER of the two rulers,
    // not the larger, so importing at the wrong one would make an adult
    // shorter, not taller — the opposite mistake from every prior round.
    // The size of the mistake is what actually kept shrinking, exactly as
    // predicted, and now reads as under 2%: importing wrong here would no
    // longer be visible at a glance the way a 76% or even 15% error was.
    // That is coincidental, not a fix — FELT_TOP_Y (the room's actual
    // defect) has not moved, see its own comment — so this is pinned
    // narrowly enough that the next pull-in has to notice which way it
    // moves rather than silently drifting further either direction.
    expect(HUMAN_STANDING_UNITS).toBeCloseTo(HUMAN_STANDING_M * UNITS_PER_METRE_Y, 6);
    const humanAtWrongRuler = HUMAN_STANDING_M * UNITS_PER_METRE;
    expect(humanAtWrongRuler).toBeLessThan(HUMAN_STANDING_UNITS);
    expect(humanAtWrongRuler).toBeGreaterThan(HUMAN_STANDING_UNITS * 0.97);
  });

  it("puts a seated head clear of the felt but well under a standing one", () => {
    // The whole point of the room: shoulders and face read ABOVE the cloth.
    const seatedHead = HUMAN_SEATED_HEAD_M * UNITS_PER_METRE_Y;
    expect(seatedHead).toBeGreaterThan(FELT_TOP_Y);
    expect(seatedHead).toBeLessThan(HUMAN_STANDING_UNITS);
  });

  it("records that the room is anisotropic rather than hiding it", () => {
    // If this ever reads 1, the felt has been raised to metric truth and
    // UNITS_PER_METRE_Y can collapse into UNITS_PER_METRE. Until then the
    // disagreement is real and every human-scaled prop must use the Y ruler.
    //
    // Was 1.76, then 1.47, then 1.19, against progressively smaller
    // FELT_RADIUS_X values (seat-layout.ts). Pulling the table in — the
    // horizontal-only "table reads too big next to a fixed-height roster"
    // fix — lowers UNITS_PER_METRE and so lowers this ratio too;
    // UNITS_PER_METRE_Y (keyed to FELT_TOP_Y/TABLE_HEIGHT_M, untouched by
    // that change) didn't move.
    //
    // The fourth pull-in (1.45 -> 1.2) took it past 1: UNITS_PER_METRE is now
    // the smaller ruler, at 0.98 of UNITS_PER_METRE_Y rather than some
    // multiple above it. The two rulers disagreeing by less is still
    // incidental to the fix that causes it, not a step toward reconciling
    // them — FELT_TOP_Y has not moved, and there is no reason the next
    // pull-in keeps this number on the same side of 1.
    expect(UNITS_PER_METRE / UNITS_PER_METRE_Y).toBeCloseTo(0.98, 2);
  });
});

describe("props at real scale", () => {
  it("makes a chip 39mm across the felt's 2.13m", () => {
    const chipsAcrossTheTable = (2 * FELT_RADIUS_X) / (CHIP.radius * 2);
    // 2130mm / 39mm — a chip is about a fifty-fifth of the table's length.
    expect(chipsAcrossTheTable).toBeCloseTo(2130 / 39, 3);
  });

  it("keeps a chip's thickness at the real 39x3.3 ratio", () => {
    expect(CHIP.thickness / CHIP.radius).toBeCloseTo(3.3 / 19.5, 6);
  });

  it("gives a card poker proportions", () => {
    expect(CARD.width / CARD.height).toBeCloseTo(63.5 / 88.9, 6);
  });

  it("fits five community cards and their gaps inside the felt", () => {
    const boardWidth = 5 * CARD.width + 4 * CARD_GAP;
    expect(boardWidth).toBeLessThan(2 * FELT_RADIUS_X * 0.62);
  });

  it("keeps a hole-card pair inside the felt's shallow axis", () => {
    // The cloth is far shallower than it is long; a pair laid across it has
    // to clear the rail on a 1.07m axis, which is what actually binds.
    expect(CARD.height).toBeLessThan(FELT_RADIUS_Z * 0.5);
  });

  it("makes the dealer button read as bigger than a chip, as it is", () => {
    expect(DEALER_BUTTON.radius).toBeGreaterThan(CHIP.radius * 1.5);
  });

  it("stacks a full pile shorter than a card is long", () => {
    // 14 chips is the display cap. Real chips are thin: a capped pile is
    // 46mm tall, which must not tower over the props beside it.
    expect(14 * CHIP.thickness).toBeLessThan(CARD.height);
  });
});
