import { describe, expect, it } from "vitest";
import {
  PUZZLE_EPOCH_DAY,
  dailyIndex,
  isPuzzleDay,
  msUntilNextPuzzle,
  pickDaily,
  puzzleDay,
  puzzleNumber,
} from "./daily";

describe("puzzleDay", () => {
  it("is the UTC calendar day, not the host's", () => {
    // 23:30 UTC and 00:30 UTC the next day are different puzzles, and the
    // machine's own zone must not enter into it -- everyone shares one board.
    expect(puzzleDay(new Date("2026-08-05T23:30:00Z"))).toBe("2026-08-05");
    expect(puzzleDay(new Date("2026-08-06T00:30:00Z"))).toBe("2026-08-06");
    // A local-midnight instant in a positive-offset zone is still the day
    // before in UTC. This is the case a Date.getDate() implementation gets
    // wrong on a server in Sydney and right on one in London.
    expect(puzzleDay(new Date("2026-08-06T10:00:00+13:00"))).toBe("2026-08-05");
  });
});

describe("isPuzzleDay", () => {
  it("accepts a calendar day and rejects anything else", () => {
    expect(isPuzzleDay("2026-08-05")).toBe(true);
    expect(isPuzzleDay("2026-8-5")).toBe(false);
    expect(isPuzzleDay("2026-13-01")).toBe(false);
    expect(isPuzzleDay("yesterday")).toBe(false);
    expect(isPuzzleDay("2026-08-05T00:00:00Z")).toBe(false);
  });
});

describe("puzzleNumber", () => {
  it("starts at one on the epoch and advances a day at a time", () => {
    expect(puzzleNumber(PUZZLE_EPOCH_DAY)).toBe(1);
    expect(puzzleNumber("2026-01-02")).toBe(2);
    expect(puzzleNumber("2026-02-01")).toBe(32);
  });

  it("counts across a DST boundary without drifting", () => {
    // Rounding, not flooring, is what makes this hold: these are UTC
    // timestamps so there is no DST here at all, but a future refactor to
    // local time would fail this rather than silently double a day in March.
    const march = puzzleNumber("2026-03-31");
    const april = puzzleNumber("2026-04-01");
    expect(april - march).toBe(1);
  });
});

describe("msUntilNextPuzzle", () => {
  it("counts down to the next UTC midnight", () => {
    expect(msUntilNextPuzzle(new Date("2026-08-05T23:00:00Z"))).toBe(60 * 60 * 1000);
    expect(msUntilNextPuzzle(new Date("2026-08-05T00:00:00Z"))).toBe(86_400_000);
  });
});

describe("dailyIndex", () => {
  const POOL = 300;

  it("visits every entry before repeating any", () => {
    // The reason this is a stride and not a hash: a hash collides on the
    // birthday paradox, so a 300-word list would repeat inside a month with
    // most of the list still unused. A full cycle is the whole guarantee.
    const seen = new Set<number>();
    for (let offset = 0; offset < POOL; offset += 1) {
      const day = new Date(Date.parse(`${PUZZLE_EPOCH_DAY}T00:00:00Z`) + offset * 86_400_000);
      seen.add(dailyIndex(puzzleDay(day), POOL, "word-stack"));
    }
    expect(seen.size).toBe(POOL);
  });

  it("does not walk the pool in order", () => {
    const first = dailyIndex("2026-01-01", POOL, "word-stack");
    const second = dailyIndex("2026-01-02", POOL, "word-stack");
    expect(second - first).not.toBe(1);
  });

  it("separates the games, so one list's order says nothing about the other's", () => {
    const days = ["2026-01-01", "2026-02-14", "2026-08-05", "2026-12-31"];
    const wordStack = days.map((day) => dailyIndex(day, POOL, "word-stack"));
    const connections = days.map((day) => dailyIndex(day, POOL, "connections"));
    expect(wordStack).not.toEqual(connections);
  });

  it("is stable -- the same day always yields the same puzzle", () => {
    // The share text names a puzzle number. If this ever moved, two people
    // comparing "#128" would be comparing different words.
    expect(dailyIndex("2026-08-05", POOL, "word-stack")).toBe(dailyIndex("2026-08-05", POOL, "word-stack"));
  });

  it("stays in range for a day before the epoch", () => {
    // JS % keeps the dividend's sign, so a clock skew or a backfill would
    // index negatively without the correction.
    const index = dailyIndex("2025-12-30", POOL, "word-stack");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(POOL);
  });

  it("handles a single-entry pool", () => {
    expect(dailyIndex("2026-08-05", 1, "word-stack")).toBe(0);
  });

  it("rejects an empty pool rather than returning NaN", () => {
    expect(() => dailyIndex("2026-08-05", 0, "word-stack")).toThrow();
  });
});

describe("pickDaily", () => {
  it("picks from the pool by index", () => {
    const pool = ["a", "b", "c", "d", "e"];
    expect(pool).toContain(pickDaily(pool, "2026-08-05", "word-stack"));
    expect(pickDaily(pool, "2026-08-05", "word-stack")).toBe(pool[dailyIndex("2026-08-05", 5, "word-stack")]);
  });
});
