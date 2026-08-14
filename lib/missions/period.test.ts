import { describe, expect, it } from "vitest";
import { utcWeekKey } from "./period";

describe("utcWeekKey", () => {
  it("lands a mid-week date on that week's Monday", () => {
    // 2026-08-13 is a Thursday.
    expect(utcWeekKey(new Date("2026-08-13T15:00:00.000Z"))).toBe("2026-08-10");
  });

  it("keeps Monday itself, at any hour, on its own key", () => {
    expect(utcWeekKey(new Date("2026-08-10T00:00:00.000Z"))).toBe("2026-08-10");
    expect(utcWeekKey(new Date("2026-08-10T23:59:59.999Z"))).toBe("2026-08-10");
  });

  it("puts Sunday 23:59 UTC in the week that is ending, not the next one", () => {
    expect(utcWeekKey(new Date("2026-08-16T23:59:59.999Z"))).toBe("2026-08-10");
  });

  it("crosses into the next week exactly at Monday 00:00 UTC", () => {
    expect(utcWeekKey(new Date("2026-08-17T00:00:00.000Z"))).toBe("2026-08-17");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-08-31 is a Monday.
    expect(utcWeekKey(new Date("2026-08-31T12:00:00.000Z"))).toBe("2026-08-31");
    expect(utcWeekKey(new Date("2026-09-02T12:00:00.000Z"))).toBe("2026-08-31");
  });
});
