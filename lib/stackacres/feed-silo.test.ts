import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE } from "./catalogue";
import {
  FEED_SILO_DAILY_FEEDS,
  planSiloFeeding,
  siloFeedOrder,
  siloFeedsLeft,
  type SiloUnit,
} from "./feed-silo";

const T0 = new Date("2026-09-18T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();
const HEN = STACKACRES_CATALOGUE.hen;
const CATTLE = STACKACRES_CATALOGUE.cattle;
const henHunger = HEN.hungerMs ?? 0;
const cattleHunger = CATTLE.hungerMs ?? 0;

function unit(id: string, stock: "hen" | "cattle", overrides: Partial<SiloUnit> = {}): SiloUnit {
  const def = STACKACRES_CATALOGUE[stock];
  return { id, stock, status: "working", lastFedAt: iso(0), readyAt: iso(def.durationMs), ...overrides };
}

describe("the Feed Silo's plan", () => {
  it("feeds a hungry animal at the moment it went hungry", () => {
    const plan = planSiloFeeding([unit("c", "cattle")], { cattle_feed: 5 }, 0, 48, at(cattleHunger + 1000));
    expect(plan.feedings).toEqual([{ unitId: "c", sources: ["cattle_feed"], fedAts: [iso(cattleHunger)] }]);
    expect(plan.shelfUsed).toEqual({ cattle_feed: 1 });
  });

  it("repeats while the animal would have gone hungry again before now", () => {
    // Hungry at 8h and 16h mid-batch, then done at 24h: one more serving at
    // its latest hunger moment leaves it collectable, and no more after that.
    const plan = planSiloFeeding([unit("c", "cattle")], {}, 10, 48, at(CATTLE.durationMs + 30 * cattleHunger));
    const [feeding] = plan.feedings;
    expect(feeding.fedAts.slice(0, 2)).toEqual([iso(cattleHunger), iso(2 * cattleHunger)]);
    expect(feeding.fedAts).toHaveLength(3);
    expect(Date.parse(feeding.fedAts[2])).toBe(at(CATTLE.durationMs + 30 * cattleHunger).getTime());
    expect(plan.feedUsed).toBe(3);
  });

  it("leaves an animal that is not hungry yet alone", () => {
    const plan = planSiloFeeding([unit("c", "cattle")], {}, 10, 48, at(cattleHunger - 1));
    expect(plan.servings).toBe(0);
  });

  it("stops when the barn is empty", () => {
    const plan = planSiloFeeding([unit("a", "cattle"), unit("b", "cattle")], { cattle_feed: 1 }, 0, 48, at(cattleHunger));
    expect(plan.servings).toBe(1);
    expect(plan.feedings.map((feeding) => feeding.unitId)).toEqual(["a"]);
  });

  it("never hands out more than the budget, earliest hunger first", () => {
    const early = unit("early", "hen", { lastFedAt: iso(-60_000) });
    const plan = planSiloFeeding([unit("late", "hen"), early], {}, 100, 1, at(henHunger));
    expect(plan.feedings).toEqual([{ unitId: "early", sources: ["feed"], fedAts: [iso(henHunger - 60_000)] }]);
  });

  it("skips Spinach for hens and uses the rest of the order", () => {
    expect([...siloFeedOrder("hen")]).toEqual(["wheat", "lettuce", "cabbage"]);
    expect([...siloFeedOrder("cattle")]).toEqual(["cattle_feed"]);
    const plan = planSiloFeeding([unit("h", "hen")], { spinach: 4, lettuce: 1 }, 0, 48, at(henHunger));
    expect(plan.feedings[0].sources).toEqual(["lettuce"]);
    const spinachOnly = planSiloFeeding([unit("h", "hen")], { spinach: 4 }, 0, 48, at(henHunger));
    expect(spinachOnly.servings).toBe(0);
  });

  it("ignores idle rows and crops", () => {
    const plan = planSiloFeeding([unit("c", "cattle", { status: "ready" })], {}, 10, 48, at(cattleHunger * 2));
    expect(plan.servings).toBe(0);
  });
});

describe("the Feed Silo's daily allowance", () => {
  it("counts only today's feeds, 48 a day", () => {
    expect(FEED_SILO_DAILY_FEEDS).toBe(48);
    expect(siloFeedsLeft({ autoFeedDay: null, autoFeeds: 0 }, "2026-09-18")).toBe(48);
    expect(siloFeedsLeft({ autoFeedDay: "2026-09-18", autoFeeds: 40 }, "2026-09-18")).toBe(8);
    expect(siloFeedsLeft({ autoFeedDay: "2026-09-17", autoFeeds: 48 }, "2026-09-18")).toBe(48);
    expect(siloFeedsLeft({ autoFeedDay: "2026-09-18", autoFeeds: 48 }, "2026-09-18")).toBe(0);
  });
});
