import { describe, expect, it } from "vitest";
import {
  dailyGrantFor,
  liveStreak,
  previousUtcDay,
  streakAfterClaim,
  streakMultiplier,
  STREAK_CAP_DAYS,
  utcDayKey,
} from "./streak";

describe("day keys", () => {
  it("uses the UTC calendar day, not the local one", () => {
    // 23:30 UTC-and-late-evening in the Americas is already tomorrow for a
    // player in Asia. The grant has always been decided in UTC (isSameUtcDay in
    // lib/profile/daily-gold.ts), so the streak has to agree with it.
    expect(utcDayKey(new Date("2026-08-06T23:30:00.000Z"))).toBe("2026-08-06");
    expect(utcDayKey(new Date("2026-08-07T00:00:00.000Z"))).toBe("2026-08-07");
  });

  it("steps back across month and year boundaries", () => {
    expect(previousUtcDay("2026-08-06")).toBe("2026-08-05");
    expect(previousUtcDay("2026-08-01")).toBe("2026-07-31");
    expect(previousUtcDay("2026-01-01")).toBe("2025-12-31");
    // 2028 is a leap year; this is the classic off-by-one in hand-rolled date maths.
    expect(previousUtcDay("2028-03-01")).toBe("2028-02-29");
  });
});

describe("extending a streak", () => {
  it("starts at one for a player who has never claimed", () => {
    expect(streakAfterClaim(null, 0, "2026-08-06")).toBe(1);
  });

  it("extends when yesterday was claimed", () => {
    expect(streakAfterClaim("2026-08-05", 3, "2026-08-06")).toBe(4);
  });

  it("is unchanged by a second claim on the same day", () => {
    // The property that makes it safe to record the streak before attempting
    // the credit: replaying today's claim must not inflate it.
    expect(streakAfterClaim("2026-08-06", 4, "2026-08-06")).toBe(4);
    expect(streakAfterClaim("2026-08-06", 1, "2026-08-06")).toBe(1);
  });

  it("resets after any gap, however short", () => {
    expect(streakAfterClaim("2026-08-04", 9, "2026-08-06")).toBe(1);
    expect(streakAfterClaim("2026-06-01", 40, "2026-08-06")).toBe(1);
  });
});

describe("the multiplier", () => {
  it("pays the plain grant on day one and grows from there", () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBeGreaterThan(streakMultiplier(1));
  });

  it("stops growing at the cap", () => {
    const capped = streakMultiplier(STREAK_CAP_DAYS);
    expect(streakMultiplier(STREAK_CAP_DAYS + 1)).toBe(capped);
    expect(streakMultiplier(9_999)).toBe(capped);
    // The cap is the economic guard -- an uncapped multiplier eventually pays
    // out more per day than the Gold store sells.
    expect(capped).toBeLessThanOrEqual(3);
  });

  it("treats a nonsense streak as day one rather than paying nothing", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(-4)).toBe(1);
  });

  it("scales the grant to whole Gold", () => {
    expect(dailyGrantFor(1_000, 1)).toBe(1_000);
    expect(dailyGrantFor(1_000, STREAK_CAP_DAYS)).toBe(2_500);
    expect(Number.isInteger(dailyGrantFor(1_000, 3))).toBe(true);
  });
});

describe("reading a streak back", () => {
  it("still counts today's and yesterday's claims", () => {
    expect(liveStreak("2026-08-06", 5, "2026-08-06")).toBe(5);
    // Yesterday still counts: the streak is alive until today is missed too,
    // which is what lets the readout say "claim to reach 6".
    expect(liveStreak("2026-08-05", 5, "2026-08-06")).toBe(5);
  });

  it("reports a lapsed streak as over, whatever the stored number says", () => {
    expect(liveStreak("2026-08-03", 20, "2026-08-06")).toBe(0);
    expect(liveStreak(null, 20, "2026-08-06")).toBe(0);
  });
});
