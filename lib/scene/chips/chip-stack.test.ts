import { describe, expect, it } from "vitest";
import {
  betSlots,
  chipBreakdown,
  COLUMN_CAP,
  columnCount,
  columnHeights,
  MAX_BET_CHIPS,
  MAX_POT_CHIPS,
  MAX_POT_COLUMNS,
  pileSlots,
  spraySequence,
} from "./chip-stack";
import { POT_CHIP_DENOMINATIONS_BB } from "@/lib/game/pot-chips";

const RADIUS = 0.157;

describe("the breakdown", () => {
  it("is greedy and largest-first, the way a dealer stacks one", () => {
    const units = chipBreakdown(131, 1, 50).map((unit) => unit.denomination);
    expect(units).toEqual([100, 25, 5, 1]);
  });

  it("measures in big blinds, so a pile means the same at every tier", () => {
    // 500 is a huge pot at 5/10 and a limp at 500/1000.
    const small = chipBreakdown(500, 10, 50).map((unit) => unit.denomination);
    const large = chipBreakdown(500, 1000, 50).map((unit) => unit.denomination);
    expect(small).toEqual([25, 25]);
    expect(large).toEqual([1]);
  });

  it("drops singles before it ever drops a hundred", () => {
    // Truncating the tail is the cut a dealer would make; the cap costs
    // legibility, never the size the pile communicates.
    const units = chipBreakdown(1000, 1, 4).map((unit) => unit.denomination);
    expect(units).toEqual([100, 100, 100, 100]);
  });

  it("still shows a chip for a pot under one big blind", () => {
    // Something is in the middle; rounding it away makes the felt disagree
    // with the readout above it.
    expect(chipBreakdown(3, 10, 50)).toHaveLength(1);
  });

  it("shows nothing for nothing, and nothing for nonsense", () => {
    expect(chipBreakdown(0, 10, 50)).toEqual([]);
    expect(chipBreakdown(-5, 10, 50)).toEqual([]);
    expect(chipBreakdown(100, 0, 50)).toEqual([]);
    expect(chipBreakdown(Number.NaN, 10, 50)).toEqual([]);
    expect(chipBreakdown(100, 10, 0)).toEqual([]);
  });

  it("indexes each denomination from zero, so a growing pot adds one chip", () => {
    // The identity half of the keyed sync. If these ordinals shifted, every
    // chip on the felt would replay its landing on every bet.
    const three = chipBreakdown(3, 1, 50);
    const four = chipBreakdown(4, 1, 50);
    expect(three.map((u) => `${u.denomination}:${u.denominationIndex}`))
      .toEqual(["1:0", "1:1", "1:2"]);
    expect(four.map((u) => `${u.denomination}:${u.denominationIndex}`))
      .toEqual(["1:0", "1:1", "1:2", "1:3"]);
  });

  it("only ever uses the game's own denominations", () => {
    for (let amount = 1; amount < 400; amount += 7) {
      for (const unit of chipBreakdown(amount, 1, 50)) {
        expect(POT_CHIP_DENOMINATIONS_BB).toContain(unit.denomination);
      }
    }
  });

  it("leaves smallest-first, so the big chips land on top where they read", () => {
    expect(spraySequence(131, 1, 50)).toEqual([1, 5, 25, 100]);
  });
});

describe("the mound", () => {
  it("never gets narrower as the pot grows", () => {
    // The one claim the whole layout makes: you can size a pot without
    // reading a number. A pot that got bigger and looked smaller would be
    // worse than showing no chips at all.
    let previous = 0;
    for (let chips = 1; chips <= MAX_POT_CHIPS; chips += 1) {
      const columns = columnCount(chips, MAX_POT_COLUMNS);
      expect(columns).toBeGreaterThanOrEqual(previous);
      previous = columns;
    }
  });

  it("grows its footprint, not just its height", () => {
    const footprint = (chips: number) => {
      const slots = pileSlots(chips, RADIUS, MAX_POT_COLUMNS);
      const xs = slots.map((slot) => slot.offsetX);
      const zs = slots.map((slot) => slot.offsetZ);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs) + RADIUS);
    };
    // A stack, then a pair, then a triangle: three silhouettes, not one wall
    // getting wider.
    expect(footprint(30)).toBeGreaterThan(footprint(10));
    expect(footprint(50)).toBeGreaterThan(footprint(30));
  });

  it("keeps a small pot as one tidy stack", () => {
    const slots = pileSlots(4, RADIUS, MAX_POT_COLUMNS);
    expect(new Set(slots.map((slot) => slot.column)).size).toBe(1);
    expect(slots.map((slot) => slot.index)).toEqual([0, 1, 2, 3]);
    for (const slot of slots) {
      expect(slot.offsetX).toBe(0);
      expect(slot.offsetZ).toBe(0);
    }
  });

  it("peaks in the middle rather than stepping", () => {
    // The difference between a mound and a staircase, and the reason a large
    // pot's silhouette reads as a pyramid.
    const heights = columnHeights(14, 5);
    expect(heights.reduce((sum, height) => sum + height, 0)).toBe(14);
    expect(heights[2]).toBeGreaterThanOrEqual(heights[0]);
    expect(heights[2]).toBeGreaterThanOrEqual(heights[4]);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  });

  it("gives every chip its own slot — no two chips inside each other", () => {
    for (const chips of [1, 5, 13, 27, 40, MAX_POT_CHIPS]) {
      const slots = pileSlots(chips, RADIUS, MAX_POT_COLUMNS);
      expect(slots).toHaveLength(chips);
      const seen = new Set(slots.map((slot) => `${slot.column}:${slot.index}`));
      expect(seen.size).toBe(chips);
    }
  });

  it("fills each column from the felt up, with no gaps", () => {
    const slots = pileSlots(37, RADIUS, MAX_POT_COLUMNS);
    const byColumn = new Map<number, number[]>();
    for (const slot of slots) {
      byColumn.set(slot.column, [...(byColumn.get(slot.column) ?? []), slot.index]);
    }
    for (const indices of byColumn.values()) {
      expect(indices).toEqual(indices.map((_, position) => position));
      expect(indices.length).toBeLessThanOrEqual(COLUMN_CAP);
    }
  });

  it("stops growing at the cap — the exact number lives in the HUD", () => {
    expect(pileSlots(10_000, RADIUS, MAX_POT_COLUMNS)).toHaveLength(MAX_POT_CHIPS);
  });

  it("scales with the fit's chip, so a phone's larger chips do not overlap", () => {
    const small = pileSlots(30, 0.1, MAX_POT_COLUMNS);
    const large = pileSlots(30, 0.2, MAX_POT_COLUMNS);
    const width = (slots: typeof small) =>
      Math.max(...slots.map((slot) => slot.offsetX)) - Math.min(...slots.map((slot) => slot.offsetX));
    expect(width(large)).toBeCloseTo(width(small) * 2, 6);
  });

  it("is empty for an empty pot", () => {
    expect(pileSlots(0, RADIUS, MAX_POT_COLUMNS)).toEqual([]);
  });
});

describe("a standing bet", () => {
  it("never spreads into depth — a mound in front of a seat reads as a pot", () => {
    // Six pyramids around one table run into each other. A bet is one
    // player's gesture at one spot on the rail.
    for (const chips of [1, 7, 15, MAX_BET_CHIPS]) {
      for (const slot of betSlots(chips, RADIUS)) {
        expect(slot.offsetZ).toBe(0);
      }
    }
  });

  it("stays a cut stack until it has to widen", () => {
    expect(new Set(betSlots(6, RADIUS).map((slot) => slot.column)).size).toBe(1);
    expect(new Set(betSlots(15, RADIUS).map((slot) => slot.column)).size).toBeGreaterThan(1);
  });

  it("centres its columns on the bet spot", () => {
    const offsets = [...new Set(betSlots(15, RADIUS).map((slot) => slot.offsetX))];
    const sum = offsets.reduce((total, offset) => total + offset, 0);
    expect(sum).toBeCloseTo(0, 9);
  });

  it("caps, like the mound does", () => {
    expect(betSlots(10_000, RADIUS)).toHaveLength(MAX_BET_CHIPS);
  });
});
