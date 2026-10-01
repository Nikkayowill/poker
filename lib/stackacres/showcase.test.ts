import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE } from "./catalogue";
import type { StackAcresUnitSnapshot } from "./units";
import {
  FARM_VISIBILITIES,
  SHOWCASE_REACTIONS,
  SHOWCASE_REACTION_IDS,
  emptyReactionCounts,
  farmLevelFromMilestone,
  favoriteProduction,
  isFarmVisibility,
  isShowcaseReaction,
  mayVisit,
} from "./showcase";

/** The fields `favoriteProduction` reads, with the rest filled in plausibly. */
function unit(stock: StackAcresUnitSnapshot["stock"], state: StackAcresUnitSnapshot["state"] = "working"): StackAcresUnitSnapshot {
  return {
    id: `${stock}-${Math.random()}`,
    state,
    stock,
    stake: 0,
    yieldQuantity: 1,
    startedAt: "2026-09-30T00:00:00.000Z",
    readyAt: "2026-09-30T00:10:00.000Z",
    progress: 0.5,
    hungryAt: null,
    thirstyAt: null,
    isWatered: true,
    seed: false,
    soilSlot: null,
    muckFee: null,
    permanent: false,
    housedIn: null,
  };
}

describe("who may look", () => {
  it("lets the owner in whatever the setting says", () => {
    for (const visibility of FARM_VISIBILITIES) {
      expect(mayVisit(visibility, { own: true, friend: false })).toBe(true);
    }
  });

  it("refuses everyone on a private farm, friend or not", () => {
    expect(mayVisit("private", { own: false, friend: true })).toBe(false);
    expect(mayVisit("private", { own: false, friend: false })).toBe(false);
  });

  it("lets a friend into a friends-only farm and nobody else", () => {
    expect(mayVisit("friends", { own: false, friend: true })).toBe(true);
    expect(mayVisit("friends", { own: false, friend: false })).toBe(false);
  });

  it("does not recognise a visibility it has never heard of", () => {
    // The guard is what stands between a hand-rolled PUT body and the setting.
    expect(isFarmVisibility("public")).toBe(false);
    expect(isFarmVisibility("PRIVATE")).toBe(false);
    expect(isFarmVisibility(null)).toBe(false);
    expect(isFarmVisibility("friends")).toBe(true);
  });
});

describe("reactions", () => {
  it("has three, all compliments, and no way to spell a fourth", () => {
    expect(SHOWCASE_REACTION_IDS).toHaveLength(3);
    expect(isShowcaseReaction("nice_layout")).toBe(true);
    expect(isShowcaseReaction("boo")).toBe(false);
    expect(isShowcaseReaction(undefined)).toBe(false);
  });

  it("starts every farm's tally at zero for every kind", () => {
    const counts = emptyReactionCounts();
    for (const reaction of SHOWCASE_REACTIONS) {
      expect(counts[reaction.id]).toBe(0);
    }
  });
});

describe("farm level", () => {
  it("reads a farm past no milestone as level 1", () => {
    expect(farmLevelFromMilestone(0)).toBe(1);
  });

  it("is the milestone plus one", () => {
    expect(farmLevelFromMilestone(3)).toBe(4);
  });

  it("never goes below 1, whatever it is handed", () => {
    expect(farmLevelFromMilestone(-5)).toBe(1);
  });
});

describe("what a farm mostly raises", () => {
  it("is nothing on a bare farm", () => {
    expect(favoriteProduction([])).toBeNull();
  });

  it("is whichever stock has the most standing on the farm", () => {
    const best = favoriteProduction([
      unit("hen"),
      unit("carrot"),
      unit("carrot"),
      unit("carrot"),
    ]);
    expect(best).toEqual({ stock: "carrot", label: STACKACRES_CATALOGUE.carrot.label, count: 3 });
  });

  it("ignores mucked units, which are a mess rather than production", () => {
    const best = favoriteProduction([
      unit("hen"),
      unit("carrot", "mucked"),
      unit("carrot", "mucked"),
    ]);
    expect(best?.stock).toBe("hen");
  });

  it("breaks a tie the same way twice, whatever order the units arrive in", () => {
    const a = favoriteProduction([unit("carrot"), unit("radish")]);
    const b = favoriteProduction([unit("radish"), unit("carrot")]);
    expect(a?.stock).toBe(b?.stock);
  });
});
