import { describe, expect, it } from "vitest";
import { PERKS } from "./content";
import { drawCards, eligiblePerks, playerStats, xpNeeded } from "./perks";

const rolls = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("player stats", () => {
  it("is all plain with no cards", () => {
    const stats = playerStats({ perks: {}, frenzyLeft: 0 });
    expect(stats).toEqual({ damage: 1, fireRate: 1, reload: 1, speed: 1, xp: 1, drops: 1, regen: 0, leech: 0, magnet: 1, mags: 1, pierce: 0 });
  });

  it("stacks a card each time it is taken", () => {
    const one = playerStats({ perks: { "hot-barrel": 1 }, frenzyLeft: 0 }).fireRate;
    const three = playerStats({ perks: { "hot-barrel": 3 }, frenzyLeft: 0 }).fireRate;
    expect(one).toBeGreaterThan(1);
    expect(three).toBeGreaterThan(one);
  });

  it("makes reloads quicker with Quick Hands, never instant", () => {
    const stats = playerStats({ perks: { "quick-hands": 3 }, frenzyLeft: 0 });
    expect(stats.reload).toBeLessThan(1);
    expect(stats.reload).toBeGreaterThan(0.3);
  });

  it("doubles the fire rate in a frenzy, on top of Hot Barrel", () => {
    const calm = playerStats({ perks: { "hot-barrel": 2 }, frenzyLeft: 0 }).fireRate;
    const mad = playerStats({ perks: { "hot-barrel": 2 }, frenzyLeft: 5 }).fireRate;
    expect(mad).toBeCloseTo(calm * 2);
  });
});

describe("leveling", () => {
  it("asks for more XP every level", () => {
    for (let level = 1; level < 30; level += 1) expect(xpNeeded(level + 1)).toBeGreaterThan(xpNeeded(level));
  });
});

describe("the cards", () => {
  it("offers three different ones", () => {
    const cards = drawCards({ perks: {} }, rolls([0.1, 0.5, 0.9, 0.3]));
    expect(cards).toHaveLength(3);
    expect(new Set(cards).size).toBe(3);
    for (const id of cards) expect(PERKS[id]).toBeDefined();
  });

  it("never offers a card that has hit its limit", () => {
    const maxed = Object.fromEntries(Object.values(PERKS).filter((p) => p.kind !== "chaos").map((p) => [p.id, p.max]));
    const open = eligiblePerks({ perks: maxed }).map((p) => p.id);
    expect(open.sort()).toEqual(["frenzy", "nuke"]);
    expect(drawCards({ perks: maxed }, rolls([0.2, 0.7]))).toHaveLength(2);
  });

  it("offers nothing when there is nothing left", () => {
    const all = Object.fromEntries(Object.values(PERKS).map((p) => [p.id, p.max]));
    expect(drawCards({ perks: all }, () => 0.5)).toEqual([]);
  });

  it("leaves out the cards to avoid on a redraw when it can", () => {
    const first = drawCards({ perks: {} }, rolls([0.05, 0.05, 0.05]));
    const again = drawCards({ perks: {} }, rolls([0.05, 0.05, 0.05]), first);
    for (const id of again) expect(first).not.toContain(id);
  });

  it("makes the chaos cards rarer than the rest", () => {
    let chaos = 0;
    let total = 0;
    let seed = 1;
    const roll = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i += 1) {
      for (const id of drawCards({ perks: {} }, roll)) {
        total += 1;
        if (PERKS[id].kind === "chaos") chaos += 1;
      }
    }
    const chaosShare = chaos / total;
    const fairShare = Object.values(PERKS).filter((p) => p.kind === "chaos").length / Object.keys(PERKS).length;
    expect(chaosShare).toBeLessThan(fairShare);
  });
});
