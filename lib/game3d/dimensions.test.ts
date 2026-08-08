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
import { FELT_RADIUS_X, FELT_RADIUS_Z, FELT_TOP_Y } from "./seat-layout";

describe("the room's ruler", () => {
  it("resolves the felt to a real table's length", () => {
    expect((2 * FELT_RADIUS_X) / UNITS_PER_METRE).toBeCloseTo(TABLE_LENGTH_M, 6);
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
    // instead — which dimensions.ts used to instruct — makes the same adult
    // this much taller, which is the mistake this constant exists to stop.
    expect(HUMAN_STANDING_UNITS).toBeCloseTo(HUMAN_STANDING_M * UNITS_PER_METRE_Y, 6);
    expect(HUMAN_STANDING_M * UNITS_PER_METRE).toBeGreaterThan(HUMAN_STANDING_UNITS * 1.5);
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
    expect(UNITS_PER_METRE / UNITS_PER_METRE_Y).toBeCloseTo(1.76, 2);
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
