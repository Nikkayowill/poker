import { describe, expect, it } from "vitest";
import {
  ATTENTION_LEAD_MS,
  BARN_CAPACITY_BONUS,
  BARN_COMFORT_MULTIPLIER,
  CARE_BONUS_CAP,
  CARE_GIFT_LADDER,
  CARE_STREAK_CAP,
  animalMoodFor,
  animalNameFor,
  applyCare,
  barnComfort,
  barnStatusFor,
  careGiftFor,
  careStreakAfter,
  careYieldBonus,
  freshAnimalCare,
  hasCaredToday,
  isTendable,
  liveCareStreak,
  type AnimalCare,
} from "./barn";
import { STACKACRES_LIVESTOCK, STACKACRES_CROPS } from "./catalogue";
import { hungerWindowMs } from "./units";

const TODAY = "2026-09-30";
const YESTERDAY = "2026-09-29";
const LAST_WEEK = "2026-09-23";

function care(partial: Partial<AnimalCare> = {}): AnimalCare {
  return { ...freshAnimalCare(), ...partial };
}

describe("animal names", () => {
  it("gives every livestock kind a name and every crop none", () => {
    for (const stock of STACKACRES_LIVESTOCK) {
      expect(animalNameFor("11111111-2222-3333-4444-555555555555", stock)).not.toBe("");
    }
    for (const crop of STACKACRES_CROPS) {
      expect(animalNameFor("11111111-2222-3333-4444-555555555555", crop)).toBe("");
    }
  });

  it("is stable for one id, so a name never changes under a player", () => {
    const id = "abcdef01-2345-6789-abcd-ef0123456789";
    const first = animalNameFor(id, "cattle");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(animalNameFor(id, "cattle")).toBe(first);
    }
  });

  it("spreads ids across the pool rather than naming everyone the same", () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, index) =>
        animalNameFor(`00000000-0000-0000-0000-${String(index).padStart(12, "0")}`, "hen"),
      ),
    );
    expect(names.size).toBeGreaterThan(8);
  });

  it("names each kind from its own pool", () => {
    const id = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
    const names = new Set(STACKACRES_LIVESTOCK.map((stock) => animalNameFor(id, stock)));
    expect(names.size).toBe(STACKACRES_LIVESTOCK.length);
  });
});

describe("the daily tend", () => {
  it("starts a streak at 1", () => {
    expect(careStreakAfter(care(), TODAY)).toBe(1);
  });

  it("continues a streak tended yesterday", () => {
    expect(careStreakAfter(care({ caredOn: YESTERDAY, careStreak: 4 }), TODAY)).toBe(5);
  });

  it("starts over after a missed day -- the whole offline story", () => {
    expect(careStreakAfter(care({ caredOn: LAST_WEEK, careStreak: 12 }), TODAY)).toBe(1);
  });

  it("holds the streak at its cap rather than climbing forever", () => {
    const capped = care({ caredOn: YESTERDAY, careStreak: CARE_STREAK_CAP });
    expect(careStreakAfter(capped, TODAY)).toBe(CARE_STREAK_CAP);
  });

  it("knows whether today's tend has already happened", () => {
    expect(hasCaredToday(care({ caredOn: TODAY }), TODAY)).toBe(true);
    expect(hasCaredToday(care({ caredOn: YESTERDAY }), TODAY)).toBe(false);
    expect(hasCaredToday(care(), TODAY)).toBe(false);
  });

  it("crosses a month boundary, where naive string maths would not", () => {
    expect(careStreakAfter(care({ caredOn: "2026-08-31", careStreak: 2 }), "2026-09-01")).toBe(3);
  });

  it("crosses a year boundary", () => {
    expect(careStreakAfter(care({ caredOn: "2026-12-31", careStreak: 2 }), "2027-01-01")).toBe(3);
  });
});

describe("the care bonus cap", () => {
  it("pays nothing for the first two days, then climbs to the cap", () => {
    expect(careYieldBonus(1)).toBe(0);
    expect(careYieldBonus(2)).toBe(0);
    expect(careYieldBonus(3)).toBe(1);
    expect(careYieldBonus(6)).toBe(1);
    expect(careYieldBonus(7)).toBe(2);
  });

  it("never pays more than the cap, at any streak", () => {
    for (let streak = 0; streak <= CARE_STREAK_CAP * 2; streak += 1) {
      expect(careYieldBonus(streak)).toBeLessThanOrEqual(CARE_BONUS_CAP);
      expect(careYieldBonus(streak)).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps the accumulated bonus, however many tends land in one cycle", () => {
    // The economic guarantee: a cycle that somehow saw a hundred tends is
    // still worth exactly CARE_BONUS_CAP extra produce.
    let state = care({ caredOn: YESTERDAY, careStreak: CARE_STREAK_CAP });
    for (let day = 0; day < 100; day += 1) {
      state = applyCare({ ...state, caredOn: YESTERDAY }, TODAY);
      expect(state.careBonus).toBeLessThanOrEqual(CARE_BONUS_CAP);
    }
    expect(state.careBonus).toBe(CARE_BONUS_CAP);
  });

  it("writes the day, the streak and the clamped bonus together", () => {
    const next = applyCare(care({ caredOn: YESTERDAY, careStreak: 6, careBonus: 0 }), TODAY);
    expect(next).toEqual({ caredOn: TODAY, careStreak: 7, careBonus: 2 });
  });
});

describe("the streak as it reads", () => {
  it("shows a streak tended today or yesterday", () => {
    expect(liveCareStreak(care({ caredOn: TODAY, careStreak: 5 }), TODAY)).toBe(5);
    expect(liveCareStreak(care({ caredOn: YESTERDAY, careStreak: 5 }), TODAY)).toBe(5);
  });

  it("shows nothing once it has lapsed, without writing anything", () => {
    const lapsed = care({ caredOn: LAST_WEEK, careStreak: 9 });
    expect(liveCareStreak(lapsed, TODAY)).toBe(0);
    // Reading it did not change it: the stored streak is still there for the
    // next tend to overwrite.
    expect(lapsed.careStreak).toBe(9);
  });
});

describe("barn status", () => {
  const NOW = new Date("2026-09-30T12:00:00.000Z");
  const LATER = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
  const SOON = new Date(NOW.getTime() + ATTENTION_LEAD_MS - 1000).toISOString();

  it("puts a ready batch first, even when the tend is unclaimed", () => {
    const status = barnStatusFor(
      { state: "ready", hungryAt: LATER, care: care() },
      NOW,
      TODAY,
    );
    expect(status).toBe("producing");
  });

  it("calls a hungry animal hungry, whatever its care says", () => {
    const status = barnStatusFor(
      { state: "hungry", hungryAt: LATER, care: care({ caredOn: TODAY, careStreak: 9 }) },
      NOW,
      TODAY,
    );
    expect(status).toBe("hungry");
  });

  it("asks for attention when today's tend is unclaimed", () => {
    const status = barnStatusFor({ state: "working", hungryAt: LATER, care: care() }, NOW, TODAY);
    expect(status).toBe("needs-attention");
  });

  it("asks for attention when a meal is due soon, even once tended", () => {
    const status = barnStatusFor(
      { state: "working", hungryAt: SOON, care: care({ caredOn: TODAY, careStreak: 1 }) },
      NOW,
      TODAY,
    );
    expect(status).toBe("needs-attention");
  });

  it("is content when fed, tended and working", () => {
    const status = barnStatusFor(
      { state: "working", hungryAt: LATER, care: care({ caredOn: TODAY, careStreak: 1 }) },
      NOW,
      TODAY,
    );
    expect(status).toBe("content");
  });
});

describe("moods", () => {
  it("reads unhappy while hungry", () => {
    expect(animalMoodFor({ state: "hungry", hungryAt: null, care: care() }, TODAY)).toBe("unhappy");
  });

  it("climbs with an unbroken streak", () => {
    const at = (streak: number) =>
      animalMoodFor(
        { state: "working", hungryAt: null, care: care({ caredOn: TODAY, careStreak: streak }) },
        TODAY,
      );
    expect(at(1)).toBe("settled");
    expect(at(4)).toBe("happy");
    expect(at(9)).toBe("thriving");
  });

  it("goes restless when today's tend is still owed", () => {
    expect(
      animalMoodFor({ state: "working", hungryAt: null, care: care() }, TODAY),
    ).toBe("restless");
  });
});

describe("the Barn's comfort", () => {
  it("is 1 without one, and the multiplier with one", () => {
    expect(barnComfort(false)).toBe(1);
    expect(barnComfort(true)).toBe(BARN_COMFORT_MULTIPLIER);
  });

  it("only ever widens a hunger window, never narrows it", () => {
    const base = 8 * 60 * 1000;
    expect(hungerWindowMs(base, 1)).toBe(base);
    expect(hungerWindowMs(base, BARN_COMFORT_MULTIPLIER)).toBeGreaterThan(base);
    // A malformed multiplier must not make an animal hungrier than the
    // catalogue says it gets.
    expect(hungerWindowMs(base, 0)).toBe(base);
    expect(hungerWindowMs(base, -5)).toBe(base);
    expect(hungerWindowMs(base, Number.NaN)).toBe(base);
  });

  it("buys comfort and room, never production", () => {
    expect(BARN_COMFORT_MULTIPLIER).toBeGreaterThan(1);
    expect(BARN_CAPACITY_BONUS).toBeGreaterThan(0);
  });
});

describe("Ray's care gifts", () => {
  it("hands out one rung at a time, in order", () => {
    expect(careGiftFor(1, [])).toBeNull();
    expect(careGiftFor(3, [])?.index).toBe(0);
    expect(careGiftFor(7, [0])?.index).toBe(1);
    expect(careGiftFor(14, [0, 1])?.index).toBe(2);
  });

  it("never offers a rung twice", () => {
    const allClaimed = CARE_GIFT_LADDER.map((_rung, index) => index);
    expect(careGiftFor(CARE_STREAK_CAP, allClaimed)).toBeNull();
  });

  it("catches a player up when a streak jumps past an unclaimed rung", () => {
    // Nothing should be permanently missable just because the rung that
    // earned it was passed while the player was not looking.
    expect(careGiftFor(20, [])?.index).toBe(0);
  });

});

describe("what can be tended", () => {
  it("is working livestock and nothing else", () => {
    expect(isTendable({ stock: "cattle", status: "working" })).toBe(true);
    expect(isTendable({ stock: "cattle", status: "mucked" })).toBe(false);
    expect(isTendable({ stock: "carrot", status: "working" })).toBe(false);
  });
});
