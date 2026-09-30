import { describe, expect, it } from "vitest";
import {
  STACKACRES_DAY_MS,
  STACKACRES_HOUR_MS,
  WAKE_HOUR,
  canSleepAt,
  clockLabel,
  gameHourAt,
  offsetAfterSleep,
} from "./clock";

/** A real moment that lands on `hour` for a farm with no offset. */
const at = (hour: number, days = 1000) => days * STACKACRES_DAY_MS + hour * STACKACRES_HOUR_MS;

describe("gameHourAt", () => {
  it("runs one game day every 13 real minutes", () => {
    expect(STACKACRES_DAY_MS).toBe(13 * 60_000);
    expect(STACKACRES_HOUR_MS).toBe(32_500);
    expect(gameHourAt(at(0), 0)).toBe(0);
    expect(gameHourAt(at(12), 0)).toBe(12);
    expect(gameHourAt(at(12) + STACKACRES_DAY_MS, 0)).toBe(12);
  });

  it("adds the offset and wraps past midnight", () => {
    expect(gameHourAt(at(22), 4 * STACKACRES_HOUR_MS)).toBe(2);
    expect(gameHourAt(at(23.5), STACKACRES_HOUR_MS)).toBeCloseTo(0.5, 9);
  });

  it("handles negative moments and offsets", () => {
    expect(gameHourAt(-STACKACRES_HOUR_MS, 0)).toBe(23);
    expect(gameHourAt(at(1), -2 * STACKACRES_HOUR_MS)).toBe(23);
    expect(gameHourAt(0, -STACKACRES_DAY_MS * 5 - 6 * STACKACRES_HOUR_MS)).toBe(18);
  });

  it("always stays in 0..24", () => {
    for (let ms = -STACKACRES_DAY_MS; ms < STACKACRES_DAY_MS * 2; ms += 7_777) {
      const hour = gameHourAt(ms, 12_345);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThan(24);
    }
  });
});

describe("canSleepAt", () => {
  it("allows 6 PM through the night until 6 AM", () => {
    for (const hour of [18, 19.5, 22, 23.99, 0, 3, 5.99]) expect(canSleepAt(hour)).toBe(true);
  });

  it("refuses by day", () => {
    for (const hour of [6, 6.01, 9, 12, 17.99]) expect(canSleepAt(hour)).toBe(false);
  });
});

describe("offsetAfterSleep", () => {
  it("wakes at exactly 6 AM, the next morning", () => {
    for (const hour of [18, 20.25, 22, 23.9, 0, 3, 5.5]) {
      const now = at(hour);
      const offset = offsetAfterSleep(now, 0);
      expect(gameHourAt(now, offset)).toBe(WAKE_HOUR);
      expect(offset).toBeGreaterThan(0);
    }
  });

  it("moves forward by the hours left until morning", () => {
    expect(offsetAfterSleep(at(22), 0)).toBe(8 * STACKACRES_HOUR_MS);
    expect(offsetAfterSleep(at(3), 0)).toBe(3 * STACKACRES_HOUR_MS);
  });

  it("builds on an existing offset, and never lands on the same value", () => {
    const first = offsetAfterSleep(at(22), 0);
    // The next evening for this farm is 12 game hours after waking.
    const later = at(22) + 12 * STACKACRES_HOUR_MS;
    expect(gameHourAt(later, first)).toBe(18);
    const second = offsetAfterSleep(later, first);
    expect(second).toBe(first + 12 * STACKACRES_HOUR_MS);
    expect(gameHourAt(later, second)).toBe(WAKE_HOUR);
  });

  it("works with odd real milliseconds and negative offsets", () => {
    const now = 1_790_000_123_457;
    const offset = offsetAfterSleep(now, -987_654);
    expect(gameHourAt(now, offset)).toBe(WAKE_HOUR);
    expect(offset).toBeGreaterThan(-987_654);
  });
});

describe("clockLabel", () => {
  it("reads a 12-hour clock", () => {
    expect(clockLabel(6)).toBe("6:00 AM");
    expect(clockLabel(18 + 40 / 60)).toBe("6:40 PM");
    expect(clockLabel(9.5)).toBe("9:30 AM");
  });

  it("rounds down to 10 game minutes", () => {
    expect(clockLabel(7 + 19 / 60)).toBe("7:10 AM");
    expect(clockLabel(7 + 9.99 / 60)).toBe("7:00 AM");
    expect(clockLabel(6 + 10 / 60)).toBe("6:10 AM");
    expect(clockLabel(23 + 59.9 / 60)).toBe("11:50 PM");
  });

  it("names midnight and noon as 12", () => {
    expect(clockLabel(0)).toBe("12:00 AM");
    expect(clockLabel(0.5)).toBe("12:30 AM");
    expect(clockLabel(12)).toBe("12:00 PM");
    expect(clockLabel(12 + 50 / 60)).toBe("12:50 PM");
    expect(clockLabel(13)).toBe("1:00 PM");
    expect(clockLabel(24)).toBe("12:00 AM");
  });
});
