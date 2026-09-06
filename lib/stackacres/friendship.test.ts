import { describe, expect, it } from "vitest";

import {
  FRIENDSHIP_LADDER,
  FRIENDSHIP_RUNG_THRESHOLDS,
  applyGift,
  freshFriendship,
  friendshipView,
  giftPoints,
  giftPreference,
  isNpcId,
  type StoredFriendship,
} from "./friendship";

describe("FRIENDSHIP_LADDER", () => {
  it("is ascending with no repeated threshold", () => {
    for (let i = 1; i < FRIENDSHIP_LADDER.length; i++) {
      expect(FRIENDSHIP_LADDER[i].points).toBeGreaterThan(FRIENDSHIP_LADDER[i - 1].points);
    }
    expect(FRIENDSHIP_RUNG_THRESHOLDS).toEqual(FRIENDSHIP_LADDER.map((r) => r.points));
  });
});

describe("isNpcId", () => {
  it("accepts ray and rejects everything else", () => {
    expect(isNpcId("ray")).toBe(true);
    expect(isNpcId("monk")).toBe(false);
    expect(isNpcId("")).toBe(false);
  });
});

describe("giftPreference / giftPoints", () => {
  it("Ray loves cheese and cloth, likes flour, and is neutral on the rest", () => {
    expect(giftPreference("ray", "cheese")).toBe("loved");
    expect(giftPreference("ray", "cloth")).toBe("loved");
    expect(giftPreference("ray", "flour")).toBe("liked");
    expect(giftPreference("ray", "wheat")).toBe("neutral");
    expect(giftPreference("ray", "milk")).toBe("neutral");
    expect(giftPreference("ray", "wool")).toBe("neutral");
  });

  it("scores loved above liked above neutral", () => {
    const loved = giftPoints("ray", "cheese");
    const liked = giftPoints("ray", "flour");
    const neutral = giftPoints("ray", "wheat");
    expect(loved).toBeGreaterThan(liked);
    expect(liked).toBeGreaterThan(neutral);
    expect(neutral).toBeGreaterThan(0);
  });
});

describe("applyGift", () => {
  it("a first-ever gift awards points and starts the day gate", () => {
    const result = applyGift(freshFriendship(), "ray", "cheese", "2026-09-06");
    expect(result.outcome).toBe("gifted");
    expect(result.pointsAwarded).toBe(giftPoints("ray", "cheese"));
    expect(result.next.points).toBe(result.pointsAwarded);
    expect(result.next.lastGiftedDay).toBe("2026-09-06");
    expect(result.grantedRung).toBeNull();
  });

  it("a second gift the same UTC day is a pure no-op that awards nothing", () => {
    const first = applyGift(freshFriendship(), "ray", "cheese", "2026-09-06");
    const second = applyGift(first.next, "ray", "cheese", "2026-09-06");
    expect(second.outcome).toBe("already-gifted-today");
    expect(second.pointsAwarded).toBe(0);
    expect(second.next).toBe(first.next);
    expect(second.grantedRung).toBeNull();
  });

  it("a gift the very next UTC day is counted again", () => {
    const day1 = applyGift(freshFriendship(), "ray", "cheese", "2026-09-06").next;
    const day2 = applyGift(day1, "ray", "cheese", "2026-09-07");
    expect(day2.outcome).toBe("gifted");
    expect(day2.next.points).toBe(day1.points + giftPoints("ray", "cheese"));
  });

  it("points never lapse across a skipped day, unlike a streak", () => {
    const day1 = applyGift(freshFriendship(), "ray", "cheese", "2026-09-01").next;
    const afterGap = applyGift(day1, "ray", "cheese", "2026-09-10");
    expect(afterGap.next.points).toBe(day1.points + giftPoints("ray", "cheese"));
  });

  it("grants a rung exactly once, on the gift that first reaches its threshold", () => {
    let stored: StoredFriendship = freshFriendship();
    let day = "2026-09-01";
    let grantedAtRung0: number | null = null;
    // Ray's loved gifts (cheese) are worth 3 points; rung 0 needs 9.
    for (let i = 0; i < 3; i++) {
      const result = applyGift(stored, "ray", "cheese", day);
      stored = result.next;
      if (result.grantedRung !== null) grantedAtRung0 = result.grantedRung;
      day = nextDay(day);
    }
    expect(stored.points).toBe(9);
    expect(grantedAtRung0).toBe(0);
    expect(stored.claimedRungs).toEqual([0]);

    // Gifting again past the same rung must never grant it a second time.
    const again = applyGift(stored, "ray", "cheese", day);
    expect(again.grantedRung).toBeNull();
  });

  it("an already-gifted-today refusal never touches the stored record", () => {
    const gifted = applyGift(freshFriendship(), "ray", "cheese", "2026-09-06").next;
    const refused = applyGift(gifted, "ray", "flour", "2026-09-06");
    expect(refused.outcome).toBe("already-gifted-today");
    expect(refused.next).toBe(gifted);
  });
});

describe("friendshipView", () => {
  it("reports a fresh player correctly", () => {
    const view = friendshipView(freshFriendship(), new Date("2026-09-06T12:00:00Z"));
    expect(view.points).toBe(0);
    expect(view.giftedToday).toBe(false);
    expect(view.title).toBeNull();
    expect(view.nextRungPoints).toBe(FRIENDSHIP_LADDER[0].points);
    expect(view.nextRungTitle).toBe(FRIENDSHIP_LADDER[0].title);
  });

  it("reflects giftedToday and the highest claimed title", () => {
    const stored: StoredFriendship = { points: 30, lastGiftedDay: "2026-09-06", claimedRungs: [0] };
    const view = friendshipView(stored, new Date("2026-09-06T12:00:00Z"));
    expect(view.giftedToday).toBe(true);
    expect(view.title).toBe(FRIENDSHIP_LADDER[0].title);
    expect(view.nextRungPoints).toBe(FRIENDSHIP_LADDER[1].points);
  });

  it("reports the maxed ladder with no further rung", () => {
    const stored: StoredFriendship = {
      points: 100,
      lastGiftedDay: "2026-09-06",
      claimedRungs: [0, 1, 2, 3],
    };
    const view = friendshipView(stored, new Date("2026-09-07T12:00:00Z"));
    expect(view.giftedToday).toBe(false);
    expect(view.title).toBe(FRIENDSHIP_LADDER[3].title);
    expect(view.nextRungPoints).toBeNull();
    expect(view.nextRungTitle).toBeNull();
  });
});

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
