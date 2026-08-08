import { describe, expect, it } from "vitest";
import {
  ATLAS_CELL_ORDER,
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  atlasCellOrigin,
  atlasKeyFor,
  cardAtlasRect,
} from "./card-atlas";
import { RANKS, SUITS } from "@/lib/game/deck";
import type { Card } from "@/lib/game/types";

describe("ATLAS_CELL_ORDER", () => {
  it("has exactly one cell per card plus one for the back", () => {
    expect(ATLAS_CELL_ORDER).toHaveLength(RANKS.length * SUITS.length + 1);
  });

  it("has no duplicate keys", () => {
    expect(new Set(ATLAS_CELL_ORDER).size).toBe(ATLAS_CELL_ORDER.length);
  });

  it("ends with the back", () => {
    expect(ATLAS_CELL_ORDER[ATLAS_CELL_ORDER.length - 1]).toBe("back");
  });

  it("fits inside the production grid with room to spare, not past it", () => {
    expect(ATLAS_CELL_ORDER.length).toBeLessThanOrEqual(ATLAS_COLUMNS * ATLAS_ROWS);
  });
});

describe("atlasKeyFor", () => {
  it("keys a face-up card by rank and suit", () => {
    const card: Card = { rank: "K", suit: "hearts" };
    expect(atlasKeyFor(card)).toBe("K-hearts");
  });

  it("keys a face-down slot as the shared back", () => {
    expect(atlasKeyFor(null)).toBe("back");
  });
});

describe("cardAtlasRect", () => {
  it("collapses to the identity rect on a 1x1 grid — today's whole-texture behaviour", () => {
    // Only cell index 0 is a meaningful "1x1 grid" — cellIndex() looks up a
    // key's position in the real 53-entry ATLAS_CELL_ORDER regardless of
    // the columns/rows passed in, so testing any other key against a 1x1
    // grid would be asserting an out-of-bounds row, not a degenerate case
    // of the same data. The first card in deck order is the meaningful
    // "if this were the only cell" probe.
    expect(cardAtlasRect(ATLAS_CELL_ORDER[0], 1, 1)).toEqual({ u0: 0, v0: 0, du: 1, dv: 1 });
  });

  it("throws on a key the atlas doesn't define", () => {
    // @ts-expect-error -- deliberately an invalid key, to prove this throws
    // rather than silently drawing cell 0 (the ace of clubs) for it.
    expect(() => cardAtlasRect("not-a-real-card")).toThrow();
  });

  it("every cell's rect stays within the unit square", () => {
    for (const key of ATLAS_CELL_ORDER) {
      const rect = cardAtlasRect(key);
      expect(rect.u0).toBeGreaterThanOrEqual(0);
      expect(rect.v0).toBeGreaterThanOrEqual(0);
      expect(rect.u0 + rect.du).toBeLessThanOrEqual(1 + 1e-9);
      expect(rect.v0 + rect.dv).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("no two cells' rects overlap", () => {
    const rects = ATLAS_CELL_ORDER.map((key) => cardAtlasRect(key));
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const separated =
          a.u0 + a.du <= b.u0 + 1e-9 ||
          b.u0 + b.du <= a.u0 + 1e-9 ||
          a.v0 + a.dv <= b.v0 + 1e-9 ||
          b.v0 + b.dv <= a.v0 + 1e-9;
        expect(separated).toBe(true);
      }
    }
  });

  it("the first row (index 0) lands at the TOP of UV space (v0 = 1 - dv)", () => {
    const rect = cardAtlasRect(ATLAS_CELL_ORDER[0]);
    expect(rect.v0).toBeCloseTo(1 - 1 / ATLAS_ROWS, 10);
  });

  it("the last row lands at the BOTTOM of UV space (v0 = 0)", () => {
    const lastRowFirstKey = ATLAS_CELL_ORDER[(ATLAS_ROWS - 1) * ATLAS_COLUMNS];
    expect(cardAtlasRect(lastRowFirstKey).v0).toBeCloseTo(0, 10);
  });
});

describe("atlasCellOrigin", () => {
  it("places cell 0 at the canvas origin", () => {
    expect(atlasCellOrigin(ATLAS_CELL_ORDER[0], 100, 140)).toEqual({ x: 0, y: 0 });
  });

  it("wraps to the next row after `columns` cells", () => {
    const key = ATLAS_CELL_ORDER[ATLAS_COLUMNS];
    expect(atlasCellOrigin(key, 100, 140)).toEqual({ x: 0, y: 140 });
  });
});
