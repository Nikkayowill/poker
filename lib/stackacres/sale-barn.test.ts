import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE } from "./catalogue";
import { servingBonus, servingBonusWeight, shelfFeedOrder } from "./feeding";
import { siloFeedOrder } from "./feed-silo";
import { yieldItemOf, yieldValue } from "./items";
import {
  feederOffers,
  maxMarketWeight,
  saleBarnPens,
  shipmentGold,
  shippedAnimalLabel,
  shippedLine,
} from "./sale-barn";
import { tapActionFor } from "./tap-action";
import type { StackAcresUnitSnapshot } from "./units";

const row = (stock: "hog" | "steer" | "hen", feedBonus = 0, state = "ready") => ({
  id: `${stock}-${feedBonus}-${state}`,
  stock,
  yieldQuantity: stock === "hog" ? 6 : stock === "steer" ? 13 : 4,
  feedBonus,
  state,
});

describe("what the sale barn pays", () => {
  it("pays a hog 100 and a steer 200 a weight, from 6 and 13", () => {
    expect(shippedLine(row("hog"))).toMatchObject({ weight: 6, gold: 600 });
    expect(shippedLine(row("steer"))).toMatchObject({ weight: 13, gold: 2_600 });
    expect(yieldValue("hog")).toBe(600);
    expect(yieldValue("steer")).toBe(2_600);
  });

  it("adds what feed put on, and never more than four", () => {
    expect(shippedLine(row("hog", 3))).toMatchObject({ weight: 9, gold: 900 });
    expect(shippedLine(row("hog", 9))).toMatchObject({ weight: 10, gold: 1_000 });
    expect(maxMarketWeight("hog")).toBe(10);
    expect(maxMarketWeight("steer")).toBe(17);
  });

  it("buys only hogs and steers", () => {
    expect(shippedLine(row("hen"))).toBeNull();
    expect(yieldItemOf("hog")).toBeNull();
    expect(yieldItemOf("hen")).toBe("eggs");
  });

  it("totals a load and reads each line back plainly", () => {
    const lines = [shippedLine(row("hog", 2)), shippedLine(row("steer"))].filter((line) => line !== null);
    expect(shipmentGold(lines)).toBe(3_400);
    expect(shippedAnimalLabel(lines[0])).toBe("Hog, weight 8: 800 Gold");
  });

  it("makes a feeder worth buying: even an unfed one sells for more than it cost", () => {
    for (const offer of feederOffers()) {
      expect(yieldValue(offer.stock)).toBeGreaterThan(offer.price);
      expect(offer.price).toBe(STACKACRES_CATALOGUE[offer.stock].seedCost);
    }
    expect(feederOffers().map((offer) => [offer.label, offer.price])).toEqual([
      ["Feeder Pig", 250],
      ["Calf", 1_000],
    ]);
  });
});

describe("the sale barn's pens", () => {
  it("counts each kind against the same cap the server checks, and lists only what is ready and home", () => {
    const units = [row("hog", 0, "ready"), { ...row("hog", 1, "ready"), away: "wandered" }, row("hog", 0, "hungry")];
    const [hogs, steers] = saleBarnPens(units, {}, false);
    expect(hogs).toMatchObject({ stock: "hog", owned: 3, cap: 3 });
    expect(hogs.ready.map((line) => line.unitId)).toEqual([units[0].id]);
    expect(steers).toMatchObject({ stock: "steer", owned: 0, cap: 3, ready: [] });
    expect(saleBarnPens([], { hog: 1 }, true)[0].cap).toBe(6);
  });
});

describe("fattening", () => {
  it("feeds a hog corn first and a steer cattle feed", () => {
    expect(shelfFeedOrder("hog")).toEqual(["corn", "cattle_feed"]);
    expect(shelfFeedOrder("steer")).toEqual(["cattle_feed"]);
  });

  it("puts one weight on per fattening serving, none for the Feed Sack, and stops at the cap", () => {
    expect(servingBonusWeight("hog", "corn")).toBe(1);
    expect(servingBonusWeight("steer", "corn")).toBe(0);
    expect(servingBonusWeight("steer", "cattle_feed")).toBe(1);
    expect(servingBonus("hog", "feed", 0)).toBe(0);
    expect(servingBonus("hog", "corn", 3)).toBe(1);
    expect(servingBonus("hog", "corn", 4)).toBe(0);
    expect(servingBonus("hen", "spinach", 0)).toBe(1);
  });

  it("leaves the weight as a reward for feeding by hand: the Silo skips corn and feed", () => {
    expect(siloFeedOrder("hog")).toEqual([]);
    expect(siloFeedOrder("steer")).toEqual([]);
  });
});

describe("tapping a ready hog", () => {
  it("sends nothing and says where it sells", () => {
    const unit = {
      ...row("hog"),
      state: "ready",
      stake: 250,
      startedAt: "2026-10-02T00:00:00.000Z",
      readyAt: "2026-10-02T02:00:00.000Z",
      progress: 1,
      hungryAt: null,
      thirstyAt: null,
      isWatered: true,
      seed: false,
      soilSlot: null,
      muckFee: null,
      permanent: false,
      housedIn: null,
    } satisfies StackAcresUnitSnapshot;
    expect(tapActionFor(unit, { feed: 0, gold: 0, nowMs: 0 })).toEqual({
      kind: "refused",
      reason: "Ready to sell. Take it to Hank at the sale barn.",
      why: "waiting",
    });
  });
});
