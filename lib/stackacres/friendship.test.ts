import { describe, expect, it } from "vitest";

import {
  FRIENDSHIP_LADDER,
  FRIENDSHIP_NPCS,
  FRIENDSHIP_RUNG_THRESHOLDS,
  GIFTABLE_ITEMS,
  GREET_POINTS,
  NPC_GIFT_CATALOGUE,
  applyGift,
  applyGreet,
  freshFriendship,
  friendshipView,
  giftPoints,
  giftPreference,
  isNpcId,
  type StoredFriendship,
} from "./friendship";

describe("FRIENDSHIP_LADDER", () => {
  it("every NPC's ladder is ascending with no repeated threshold", () => {
    for (const npc of FRIENDSHIP_NPCS) {
      const ladder = FRIENDSHIP_LADDER[npc];
      for (let i = 1; i < ladder.length; i++) {
        expect(ladder[i].points).toBeGreaterThan(ladder[i - 1].points);
      }
    }
  });

  it("every NPC shares the same thresholds, so one array serves every RPC call", () => {
    for (const npc of FRIENDSHIP_NPCS) {
      expect(FRIENDSHIP_LADDER[npc].map((r) => r.points)).toEqual(FRIENDSHIP_RUNG_THRESHOLDS);
    }
  });

  it("no keepsake id is reused across two NPCs' ladders", () => {
    const seen = new Set<string>();
    for (const npc of FRIENDSHIP_NPCS) {
      for (const rung of FRIENDSHIP_LADDER[npc]) {
        expect(seen.has(rung.keepsake)).toBe(false);
        seen.add(rung.keepsake);
      }
    }
  });
});

describe("isNpcId", () => {
  it("accepts ray, pierre and ivy, and rejects everything else", () => {
    expect(isNpcId("ray")).toBe(true);
    expect(isNpcId("pierre")).toBe(true);
    expect(isNpcId("ivy")).toBe(true);
    expect(isNpcId("pilgrim")).toBe(false);
    expect(isNpcId("monk")).toBe(false);
    expect(isNpcId("")).toBe(false);
  });
});

describe("a free greet never out-earns a real gift", () => {
  it("every NPC has at least one liked or loved item, so gifting always beats a greet", () => {
    for (const npc of FRIENDSHIP_NPCS) {
      const best = Math.max(...GIFTABLE_ITEMS.map((item) => giftPoints(npc, item)));
      expect(best).toBeGreaterThan(GREET_POINTS);
    }
  });

  it("a merely neutral gift only ever ties a greet, never beats it", () => {
    // GREET_POINTS is pinned to the neutral gift value on purpose (a greet
    // can tie the worst possible gift, never exceed it) -- if this ever
    // fails it means one of the two constants moved without the other.
    // Wool is neutral for every NPC in FRIENDSHIP_NPCS today; if a future
    // NPC ever comes to like or love it, swap in a different neutral item
    // here rather than deleting the check.
    for (const npc of FRIENDSHIP_NPCS) {
      expect(giftPreference(npc, "wool")).toBe("neutral");
      expect(GREET_POINTS).toBeLessThanOrEqual(giftPoints(npc, "wool"));
    }
  });

  it("Pierre and Ivy each have real preferences, not an empty catalogue", () => {
    expect(Object.keys(NPC_GIFT_CATALOGUE.pierre.preferences).length).toBeGreaterThan(0);
    expect(Object.keys(NPC_GIFT_CATALOGUE.ivy.preferences).length).toBeGreaterThan(0);
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

  it("Pierre loves his own finished dishes and is neutral on raw stock", () => {
    expect(giftPreference("pierre", "cake")).toBe("loved");
    expect(giftPreference("pierre", "stuffed_peppers")).toBe("liked");
    expect(giftPreference("pierre", "wheat")).toBe("neutral");
    expect(giftPreference("pierre", "wool")).toBe("neutral");
  });

  it("Ivy loves what a seed becomes once grown and processed through", () => {
    expect(giftPreference("ivy", "flour")).toBe("loved");
    expect(giftPreference("ivy", "cloth")).toBe("liked");
    expect(giftPreference("ivy", "milk")).toBe("neutral");
    expect(giftPreference("ivy", "wool")).toBe("neutral");
  });
});

describe("applyGift", () => {
  it("a first-ever gift awards points and starts the gift day gate only", () => {
    const result = applyGift(freshFriendship(), "ray", "cheese", "2026-09-06");
    expect(result.outcome).toBe("gifted");
    expect(result.pointsAwarded).toBe(giftPoints("ray", "cheese"));
    expect(result.next.points).toBe(result.pointsAwarded);
    expect(result.next.lastGiftedDay).toBe("2026-09-06");
    expect(result.next.lastGreetedDay).toBeNull();
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

describe("applyGreet", () => {
  it("a first-ever greet awards a point and starts the greet day gate only", () => {
    const result = applyGreet(freshFriendship(), "pierre", "2026-09-06");
    expect(result.outcome).toBe("greeted");
    expect(result.pointsAwarded).toBe(1);
    expect(result.next.points).toBe(1);
    expect(result.next.lastGreetedDay).toBe("2026-09-06");
    expect(result.next.lastGiftedDay).toBeNull();
  });

  it("a second greet the same UTC day is a pure no-op", () => {
    const first = applyGreet(freshFriendship(), "pierre", "2026-09-06");
    const second = applyGreet(first.next, "pierre", "2026-09-06");
    expect(second.outcome).toBe("already-greeted-today");
    expect(second.pointsAwarded).toBe(0);
    expect(second.next).toBe(first.next);
  });

  it("greeting and gifting the same day both count -- separate gates", () => {
    const gifted = applyGift(freshFriendship(), "ray", "cheese", "2026-09-06").next;
    const alsoGreeted = applyGreet(gifted, "ray", "2026-09-06");
    expect(alsoGreeted.outcome).toBe("greeted");
    expect(alsoGreeted.next.points).toBe(gifted.points + 1);

    const greetedFirst = applyGreet(freshFriendship(), "ray", "2026-09-06").next;
    const alsoGifted = applyGift(greetedFirst, "ray", "cheese", "2026-09-06");
    expect(alsoGifted.outcome).toBe("gifted");
  });

  it("greets alone eventually reach Pierre's own first rung", () => {
    let stored: StoredFriendship = freshFriendship();
    let day = "2026-09-01";
    let grantedAtRung0: number | null = null;
    for (let i = 0; i < 9; i++) {
      const result = applyGreet(stored, "pierre", day);
      stored = result.next;
      if (result.grantedRung !== null) grantedAtRung0 = result.grantedRung;
      day = nextDay(day);
    }
    expect(stored.points).toBe(9);
    expect(grantedAtRung0).toBe(0);
    expect(stored.claimedRungs).toEqual([0]);
  });
});

describe("friendshipView", () => {
  it("reports a fresh player correctly", () => {
    const view = friendshipView("ray", freshFriendship(), new Date("2026-09-06T12:00:00Z"));
    expect(view.points).toBe(0);
    expect(view.giftedToday).toBe(false);
    expect(view.greetedToday).toBe(false);
    expect(view.title).toBeNull();
    expect(view.nextRungPoints).toBe(FRIENDSHIP_LADDER.ray[0].points);
    expect(view.nextRungTitle).toBe(FRIENDSHIP_LADDER.ray[0].title);
  });

  it("reflects giftedToday, greetedToday and the highest claimed title", () => {
    const stored: StoredFriendship = { points: 30, lastGiftedDay: "2026-09-06", lastGreetedDay: "2026-09-06", claimedRungs: [0] };
    const view = friendshipView("ray", stored, new Date("2026-09-06T12:00:00Z"));
    expect(view.giftedToday).toBe(true);
    expect(view.greetedToday).toBe(true);
    expect(view.title).toBe(FRIENDSHIP_LADDER.ray[0].title);
    expect(view.nextRungPoints).toBe(FRIENDSHIP_LADDER.ray[1].points);
  });

  it("reports the maxed ladder with no further rung", () => {
    const stored: StoredFriendship = {
      points: 100,
      lastGiftedDay: "2026-09-06",
      lastGreetedDay: null,
      claimedRungs: [0, 1, 2, 3],
    };
    const view = friendshipView("ray", stored, new Date("2026-09-07T12:00:00Z"));
    expect(view.giftedToday).toBe(false);
    expect(view.title).toBe(FRIENDSHIP_LADDER.ray[3].title);
    expect(view.nextRungPoints).toBeNull();
    expect(view.nextRungTitle).toBeNull();
  });

  it("Pierre and Ivy each show their own title, not Ray's", () => {
    const stored: StoredFriendship = { points: 9, lastGiftedDay: null, lastGreetedDay: "2026-09-06", claimedRungs: [0] };
    expect(friendshipView("pierre", stored, new Date("2026-09-06T12:00:00Z")).title).toBe(FRIENDSHIP_LADDER.pierre[0].title);
    expect(friendshipView("ivy", stored, new Date("2026-09-06T12:00:00Z")).title).toBe(FRIENDSHIP_LADDER.ivy[0].title);
  });
});

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
