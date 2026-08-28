import { describe, expect, it } from "vitest";
import { isInLocalSendWindow, isSameLocalDay } from "./send-window";

describe("isInLocalSendWindow", () => {
  it("is true at noon in the player's own zone, regardless of the UTC hour", () => {
    // 17:00 UTC is noon in America/Chicago (UTC-5 in August, CDT).
    const when = new Date("2026-08-28T17:00:00.000Z");
    expect(isInLocalSendWindow("America/Chicago", when)).toBe(true);
  });

  it("is false outside the player's local noon hour", () => {
    const when = new Date("2026-08-28T17:00:00.000Z");
    expect(isInLocalSendWindow("America/Los_Angeles", when)).toBe(false);
  });

  it("falls back to the fixed UTC hour for a profile with no stored timezone", () => {
    expect(isInLocalSendWindow(null, new Date("2026-08-28T22:00:00.000Z"))).toBe(true);
    expect(isInLocalSendWindow(null, new Date("2026-08-28T21:00:00.000Z"))).toBe(false);
  });

  it("falls back rather than throwing for a bogus zone name", () => {
    expect(isInLocalSendWindow("Not/AZone", new Date("2026-08-28T22:00:00.000Z"))).toBe(true);
  });

  it("handles a zone on the other side of the international date line", () => {
    // Pacific/Kiritimati is UTC+14 -- local noon there is 22:00 UTC the previous day.
    const when = new Date("2026-08-27T22:00:00.000Z");
    expect(isInLocalSendWindow("Pacific/Kiritimati", when)).toBe(true);
  });
});

describe("isSameLocalDay", () => {
  it("agrees two timestamps a few hours apart are the same local day", () => {
    const a = new Date("2026-08-28T13:00:00.000Z");
    const b = new Date("2026-08-28T20:00:00.000Z");
    expect(isSameLocalDay("America/Chicago", a, b)).toBe(true);
  });

  it("disagrees across a local midnight even when both are the same UTC day", () => {
    // 04:30 UTC and 09:00 UTC are both 2026-08-28 in UTC, but in
    // Australia/Sydney (UTC+10) the first is 2026-08-28 14:30 and the
    // second is 2026-08-28 19:00 -- same local day there too, so pick a
    // pair that actually straddles Sydney's midnight instead.
    const beforeMidnight = new Date("2026-08-28T13:30:00.000Z"); // 2026-08-28 23:30 Sydney
    const afterMidnight = new Date("2026-08-28T14:30:00.000Z"); // 2026-08-29 00:30 Sydney
    expect(isSameLocalDay("Australia/Sydney", beforeMidnight, afterMidnight)).toBe(false);
  });

  it("falls back to UTC calendar day for a profile with no stored timezone", () => {
    const a = new Date("2026-08-28T23:59:00.000Z");
    const b = new Date("2026-08-29T00:01:00.000Z");
    expect(isSameLocalDay(null, a, b)).toBe(false);
  });
});
