import { describe, expect, it } from "vitest";
import { HEN_FEED_ORDER, feedingToast, henFeedOnShelf, planServings } from "./feeding";

describe("the hen feeding order", () => {
  it("is Spinach, Wheat, Lettuce, Cabbage, then the Feed Sack", () => {
    expect([...HEN_FEED_ORDER]).toEqual(["spinach", "wheat", "lettuce", "cabbage"]);
    const plan = planServings(
      ["hen", "hen", "hen", "hen", "hen", "hen"],
      { spinach: 1, wheat: 1, lettuce: 1, cabbage: 1 },
      1,
    );
    expect(plan.sources).toEqual(["spinach", "wheat", "lettuce", "cabbage", "feed"]);
    expect(plan.fed).toBe(5);
    expect(plan.feedUsed).toBe(1);
  });

  it("gives a hen fed Spinach one extra egg, and nothing for the rest", () => {
    const plan = planServings(["hen", "hen", "hen"], { spinach: 2, cabbage: 5 }, 0);
    expect(plan.shelfUsed).toEqual({ spinach: 2, cabbage: 1 });
    expect(plan.bonusEggs).toBe(2);
    expect(feedingToast(plan.sources)).toBe("Fed spinach: +2 eggs!");
    expect(feedingToast(["spinach"])).toBe("Fed spinach: +1 egg!");
    expect(feedingToast(["wheat", "feed"])).toBeNull();
  });

  it("feeds other animals only from the Feed Sack", () => {
    const plan = planServings(["cattle", "hen"], { spinach: 3 }, 1);
    expect(plan.sources).toEqual(["feed", "spinach"]);
  });

  it("stops at the first animal nothing is left for", () => {
    const plan = planServings(["hen", "cattle", "hen"], { lettuce: 1 }, 0);
    expect(plan.fed).toBe(1);
  });

  it("counts every hen feed item on the shelf", () => {
    expect(henFeedOnShelf({ spinach: 1, wheat: 2, lettuce: 3, cabbage: 4, potato: 9 })).toBe(10);
  });
});
