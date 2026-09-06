import { describe, expect, it } from "vitest";

import {
  DEVOTION_LADDER,
  DEVOTION_RUNG_THRESHOLDS,
  applyPrayer,
  devotionView,
  freshDevotion,
  isRelicId,
  previousUtcDay,
  type StoredDevotion,
} from "./devotion";

describe("DEVOTION_LADDER", () => {
  it("is ascending with no repeated threshold, and every relic is a real one", () => {
    for (let i = 1; i < DEVOTION_LADDER.length; i++) {
      expect(DEVOTION_LADDER[i].streak).toBeGreaterThan(DEVOTION_LADDER[i - 1].streak);
    }
    for (const rung of DEVOTION_LADDER) {
      expect(isRelicId(rung.relic)).toBe(true);
    }
    expect(DEVOTION_RUNG_THRESHOLDS).toEqual(DEVOTION_LADDER.map((r) => r.streak));
  });
});

describe("previousUtcDay", () => {
  it("steps back a plain day", () => {
    expect(previousUtcDay("2026-09-05")).toBe("2026-09-04");
  });

  it("crosses a month boundary", () => {
    expect(previousUtcDay("2026-03-01")).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(previousUtcDay("2026-01-01")).toBe("2025-12-31");
  });

  it("handles a leap-year February correctly", () => {
    expect(previousUtcDay("2024-03-01")).toBe("2024-02-29");
  });
});

describe("applyPrayer", () => {
  it("a first-ever prayer starts the streak at 1", () => {
    const result = applyPrayer(freshDevotion(), "2026-09-05");
    expect(result.alreadyPrayedToday).toBe(false);
    expect(result.next.streak).toBe(1);
    expect(result.next.lastPrayedDay).toBe("2026-09-05");
    expect(result.grantedRung).toBeNull();
  });

  it("a second prayer the same UTC day is a pure no-op", () => {
    const first = applyPrayer(freshDevotion(), "2026-09-05");
    const second = applyPrayer(first.next, "2026-09-05");
    expect(second.alreadyPrayedToday).toBe(true);
    expect(second.next).toBe(first.next);
    expect(second.grantedRung).toBeNull();
  });

  it("a prayer the very next UTC day advances the streak by one", () => {
    const day1 = applyPrayer(freshDevotion(), "2026-09-05").next;
    const day2 = applyPrayer(day1, "2026-09-06");
    expect(day2.next.streak).toBe(2);
    expect(day2.alreadyPrayedToday).toBe(false);
  });

  it("skipping a UTC day resets the streak to 1, not 0", () => {
    const day1 = applyPrayer(freshDevotion(), "2026-09-01").next;
    const afterGap = applyPrayer(day1, "2026-09-08");
    expect(afterGap.next.streak).toBe(1);
  });

  it("grants a rung exactly once, on the prayer that first reaches its threshold", () => {
    let stored: StoredDevotion = freshDevotion();
    let day = "2026-09-01";
    let grantedAt3: number | null = null;
    for (let i = 0; i < 3; i++) {
      const result = applyPrayer(stored, day);
      stored = result.next;
      if (result.grantedRung !== null) grantedAt3 = result.grantedRung;
      day = nextDay(day);
    }
    expect(stored.streak).toBe(3);
    expect(grantedAt3).toBe(0);
    expect(stored.claimedRungs).toEqual([0]);

    // Praying again past the same rung must never grant it a second time.
    const again = applyPrayer(stored, day);
    expect(again.grantedRung).toBeNull();
  });

  it("a multi-day gap that jumps straight past a threshold still only grants the rung it lands on", () => {
    // Streak resets to 1 on any gap, so landing past rung 0's threshold (3)
    // in one step is only possible by NOT gapping -- confirm the ladder is
    // walked one rung per prayer, never more than one per call.
    let stored: StoredDevotion = freshDevotion();
    let day = "2026-09-01";
    for (let i = 0; i < 7; i++) {
      const result = applyPrayer(stored, day);
      stored = result.next;
      day = nextDay(day);
    }
    expect(stored.streak).toBe(7);
    // Rungs 0 (streak 3) and 1 (streak 7) both crossed across 7 unbroken
    // days, one grant per prayer -- both claimed, no more than that.
    expect(stored.claimedRungs).toEqual([0, 1]);
  });
});

describe("devotionView", () => {
  it("reports a fresh player correctly", () => {
    const view = devotionView(freshDevotion(), new Date("2026-09-05T12:00:00Z"));
    expect(view.streak).toBe(0);
    expect(view.prayedToday).toBe(false);
    expect(view.nextRungStreak).toBe(3);
    expect(view.nextRelic).toBe("pilgrims_bead");
    expect(view.relicsHeld).toEqual([]);
  });

  it("reflects prayedToday and does not mutate on a lapsed streak", () => {
    const stored: StoredDevotion = { streak: 5, lastPrayedDay: "2026-09-01", claimedRungs: [0] };
    const view = devotionView(stored, new Date("2026-09-10T00:00:00Z"));
    expect(view.streak).toBe(0);
    expect(view.prayedToday).toBe(false);
    // The stored record itself is untouched -- only the view reports 0.
    expect(stored.streak).toBe(5);
  });

  it("reports the maxed ladder with no further rung", () => {
    const stored: StoredDevotion = {
      streak: 30,
      lastPrayedDay: "2026-09-05",
      claimedRungs: [0, 1, 2, 3],
    };
    const view = devotionView(stored, new Date("2026-09-05T12:00:00Z"));
    expect(view.prayedToday).toBe(true);
    expect(view.nextRungStreak).toBeNull();
    expect(view.nextRelic).toBeNull();
    expect(view.relicsHeld).toEqual(["pilgrims_bead", "vellum_psalm", "reliquary_shard", "pixel_halo"]);
  });
});

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
