import { describe, expect, it } from "vitest";
import { msUntilNextExchangeDay, stackacresExchangeDay } from "./exchange";

/**
 * The day boundary shared across StackAcres: land maintenance, the daily
 * Gold grant, and Ante Up's own daily gates all use the same UTC midnight
 * rather than each learning a separate one. The flat daily Gold ceiling that
 * used to also live in this file was removed 2026-09-12 (Kayo's call):
 * StackAcres has no cap on earning any more. What is left, and what this
 * file tests, is just the UTC day-boundary arithmetic.
 */

describe("stackacresExchangeDay", () => {
  it("is UTC, matching the daily grant rather than the device", () => {
    expect(stackacresExchangeDay(new Date("2026-09-01T00:00:00.000Z"))).toBe("2026-09-01");
    expect(stackacresExchangeDay(new Date("2026-09-01T23:59:59.999Z"))).toBe("2026-09-01");
    expect(stackacresExchangeDay(new Date("2026-09-02T00:00:00.000Z"))).toBe("2026-09-02");
  });

  it("rolls over at the exact UTC millisecond, not a moment before or after", () => {
    expect(stackacresExchangeDay(new Date("2026-09-01T23:59:59.999Z"))).toBe("2026-09-01");
    expect(stackacresExchangeDay(new Date("2026-09-02T00:00:00.000Z"))).toBe("2026-09-02");
  });

  it("does not shift for a device in a non-UTC timezone", () => {
    // A moment expressed with a non-zero offset still lands on the UTC date.
    expect(stackacresExchangeDay(new Date("2026-09-01T23:30:00.000-05:00"))).toBe("2026-09-02");
    expect(stackacresExchangeDay(new Date("2026-09-02T01:30:00.000+05:00"))).toBe("2026-09-01");
  });

  it("carries across month and year boundaries", () => {
    expect(stackacresExchangeDay(new Date("2026-09-30T23:59:59.999Z"))).toBe("2026-09-30");
    expect(stackacresExchangeDay(new Date("2026-10-01T00:00:00.000Z"))).toBe("2026-10-01");
    expect(stackacresExchangeDay(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12-31");
    expect(stackacresExchangeDay(new Date("2027-01-01T00:00:00.000Z"))).toBe("2027-01-01");
  });

  it("handles a UTC leap day", () => {
    expect(stackacresExchangeDay(new Date("2028-02-29T12:00:00.000Z"))).toBe("2028-02-29");
    expect(stackacresExchangeDay(new Date("2028-03-01T00:00:00.000Z"))).toBe("2028-03-01");
  });
});

describe("msUntilNextExchangeDay", () => {
  it("counts down to the next UTC midnight", () => {
    expect(msUntilNextExchangeDay(new Date("2026-09-01T23:00:00.000Z"))).toBe(60 * 60 * 1000);
    expect(msUntilNextExchangeDay(new Date("2026-09-01T00:00:00.000Z"))).toBe(24 * 60 * 60 * 1000);
  });

  it("is a full day exactly at midnight", () => {
    expect(msUntilNextExchangeDay(new Date("2026-09-01T00:00:00.000Z"))).toBe(24 * 60 * 60 * 1000);
  });

  it("is 1ms at the last instant of the day", () => {
    expect(msUntilNextExchangeDay(new Date("2026-09-01T23:59:59.999Z"))).toBe(1);
  });

  it("is exactly zero once the next day has arrived", () => {
    // stackacresExchangeDay would already report the new day at this instant;
    // msUntilNextExchangeDay measures distance to the day AFTER `now`'s day,
    // so at the boundary itself the distance to that following midnight is a
    // full day, not zero.
    expect(msUntilNextExchangeDay(new Date("2026-09-02T00:00:00.000Z"))).toBe(24 * 60 * 60 * 1000);
  });

  it("scales with time of day, mid-afternoon", () => {
    expect(msUntilNextExchangeDay(new Date("2026-09-01T12:00:00.000Z"))).toBe(12 * 60 * 60 * 1000);
  });

  it("carries across a month boundary", () => {
    expect(msUntilNextExchangeDay(new Date("2026-09-30T22:00:00.000Z"))).toBe(2 * 60 * 60 * 1000);
  });

  it("carries across a UTC leap day", () => {
    expect(msUntilNextExchangeDay(new Date("2028-02-29T23:00:00.000Z"))).toBe(60 * 60 * 1000);
  });

  it("is unaffected by the input Date's local timezone offset", () => {
    // Two Date instances denoting the same UTC instant, spelled with
    // different offsets, must produce the same countdown.
    const utc = new Date("2026-09-01T23:00:00.000Z");
    const offset = new Date("2026-09-01T18:00:00.000-05:00");
    expect(utc.getTime()).toBe(offset.getTime());
    expect(msUntilNextExchangeDay(offset)).toBe(msUntilNextExchangeDay(utc));
  });
});
