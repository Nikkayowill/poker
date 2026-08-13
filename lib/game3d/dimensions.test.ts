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
  mm,
} from "./dimensions";
import {
  FELT_RADIUS_X,
  FELT_RADIUS_Z,
  FELT_TOP_Y,
  TABLE_HEIGHT_M as LAYOUT_TABLE_HEIGHT_M,
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

  it("resolves the felt's HEIGHT to a real table's height too — the same ruler, not a second one", () => {
    // This is the fix: FELT_TOP_Y used to be an independent literal (0.86)
    // that this ratio had no reason to land on. Now it's derived from the
    // exact same (2 * FELT_RADIUS_X) / TABLE_LENGTH_M ratio the length and
    // width checks above use, so a table resize can no longer move the
    // horizontal ruler without moving this one along with it.
    expect(FELT_TOP_Y / UNITS_PER_METRE).toBeCloseTo(TABLE_HEIGHT_M, 6);
  });

  it("has exactly one statement of the table's length and height", () => {
    // dimensions.ts re-exports seat-layout's constants rather than declaring
    // a second 2.13/0.75, because the ruler built here has to reach into
    // seat-layout for FELT_RADIUS_X and that file cannot import back without
    // a cycle.
    expect(TABLE_LENGTH_M).toBe(LAYOUT_TABLE_LENGTH_M);
    expect(TABLE_HEIGHT_M).toBe(LAYOUT_TABLE_HEIGHT_M);
  });

  it("converts millimetres through that one scale", () => {
    expect(mm(1000)).toBeCloseTo(UNITS_PER_METRE, 6);
    expect(mm(0)).toBe(0);
  });
});

describe("the ruler a person is scaled by — the SAME one the table uses", () => {
  it("stands an adult the right height for a real 1.75m person under this ruler", () => {
    // Used to be a second, independent ruler (UNITS_PER_METRE_Y, keyed off
    // the old disagreeing FELT_TOP_Y literal) — this is now just
    // UNITS_PER_METRE, restated for readability at the call site.
    expect(HUMAN_STANDING_UNITS).toBeCloseTo(HUMAN_STANDING_M * UNITS_PER_METRE, 6);
  });

  it("puts a seated head clear of the felt but well under a standing one", () => {
    // The whole point of the room: shoulders and face read ABOVE the cloth.
    const seatedHead = HUMAN_SEATED_HEAD_M * UNITS_PER_METRE;
    expect(seatedHead).toBeGreaterThan(FELT_TOP_Y);
    expect(seatedHead).toBeLessThan(HUMAN_STANDING_UNITS);
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
