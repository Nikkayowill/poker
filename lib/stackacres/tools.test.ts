import { describe, expect, it } from "vitest";
import { STACKACRES_CATALOGUE, STACKACRES_FIELD_CAP, STACKACRES_PEN_CAP } from "./catalogue";
import type { StackAcresPlotSnapshot, StackAcresPlotState } from "./plots";
import {
  actionableCount,
  affordanceFor,
  occupiedCount,
  suggestedTool,
  type AffordanceContext,
} from "./tools";

function plot(
  state: StackAcresPlotState,
  over: Partial<StackAcresPlotSnapshot> = {},
): StackAcresPlotSnapshot {
  return {
    plotIndex: 1,
    state,
    stock: null,
    stake: null,
    yieldQuantity: null,
    startedAt: null,
    readyAt: null,
    progress: null,
    hungryAt: null,
    muckFee: state === "mucked" ? 1_200 : null,
    permanent: false,
    unlockPrice: null,
    purchasable: false,
    ...over,
  };
}

function context(over: Partial<AffordanceContext> = {}): AffordanceContext {
  return {
    bushels: 10_000,
    feed: 10,
    // Matches plot()'s own default plotIndex 1, which is Hen-Coop-zoned now
    // that pens are grouped by district (see lib/stackacres/world.ts) --
    // "sprout" would be blocked for the zone rather than whatever a test
    // that relies on this default actually means to check.
    selectedStock: "hen",
    plots: [],
    ...over,
  };
}

describe("what a tool can do to a plot", () => {
  it("leaves the whole grid quiet while looking", () => {
    for (const state of ["locked", "empty", "working", "hungry", "ready", "mucked"] as const) {
      expect(affordanceFor("inspect", plot(state), context()).kind).toBe("none");
    }
  });

  it("only offers each tool the state it belongs to", () => {
    expect(affordanceFor("plant", plot("empty"), context()).kind).toBe("act");
    expect(affordanceFor("plant", plot("ready"), context()).kind).toBe("none");

    expect(affordanceFor("harvest", plot("ready"), context()).kind).toBe("act");
    expect(affordanceFor("harvest", plot("working"), context()).kind).toBe("none");

    expect(affordanceFor("feed", plot("hungry"), context()).kind).toBe("act");
    expect(affordanceFor("feed", plot("working"), context()).kind).toBe("none");

    expect(affordanceFor("clear", plot("mucked"), context()).kind).toBe("act");
    expect(affordanceFor("clear", plot("empty"), context()).kind).toBe("none");
  });

  it("never lights a locked plot for a working tool", () => {
    for (const tool of ["plant", "harvest", "feed", "clear"] as const) {
      expect(affordanceFor(tool, plot("locked"), context()).kind).toBe("none");
    }
  });
});

describe("blocked is not the same as inapplicable", () => {
  it("blocks planting on an empty plot when the Bushels are short, rather than going quiet", () => {
    const affordance = affordanceFor(
      // Cattle plot: the default plot(1) is field-zoned now that pens are
      // grouped by row (see lib/stackacres/world.ts), so cattle would be
      // blocked for the zone rather than the Bushels this test means to check.
      "plant",
      plot("empty", { plotIndex: 13 }),
      context({ bushels: 0, selectedStock: "cattle" }),
    );
    expect(affordance.kind).toBe("blocked");
    expect(affordance).toMatchObject({ reason: expect.stringContaining("600") });
  });

  it("blocks feeding a hungry pen with an empty barn", () => {
    const affordance = affordanceFor("feed", plot("hungry"), context({ feed: 0 }));
    expect(affordance).toEqual({ kind: "blocked", reason: "No feed left in the barn." });
  });

  it("blocks clearing when the muck fee is out of reach", () => {
    const affordance = affordanceFor("clear", plot("mucked"), context({ bushels: 5 }));
    expect(affordance.kind).toBe("blocked");
  });

  it("blocks planting with nothing picked", () => {
    const affordance = affordanceFor("plant", plot("empty"), context({ selectedStock: null }));
    expect(affordance.kind).toBe("blocked");
  });

  it("stays quiet rather than blocked when the tool does not apply at all", () => {
    // A broke player holding Plant over a ripe plot is not being told about
    // money -- the plot simply is not a planting target.
    expect(affordanceFor("plant", plot("ready"), context({ bushels: 0 })).kind).toBe("none");
  });

  it("blocks the wrong stock on the wrong plot before it ever checks Bushels", () => {
    // Plot 1 is Hen-Coop-zoned; a Cattle Pen lives in a different district
    // entirely. Bushels are deliberately plentiful, so a Bushels-short block
    // can never be the real reason here -- only the zone check can fire.
    const affordance = affordanceFor(
      "plant",
      plot("empty"),
      context({ bushels: 1_000_000, selectedStock: "cattle" }),
    );
    expect(affordance).toEqual({ kind: "blocked", reason: "This ground is fenced for the Hen Coops." });
  });
});

describe("the caps", () => {
  const working = (stock: "sprout" | "hen") =>
    plot("working", { stock, stake: STACKACRES_CATALOGUE[stock].seedCost });

  it("counts pens and fields separately", () => {
    const plots = [working("hen"), working("hen"), working("sprout")];
    expect(occupiedCount(plots, true)).toBe(2);
    expect(occupiedCount(plots, false)).toBe(1);
  });

  it("blocks a full pen track without touching the field track", () => {
    const plots = Array.from({ length: STACKACRES_PEN_CAP }, () => working("hen"));
    // Plot 1 (Hen-Coop-zoned): the pen cap is full.
    expect(
      affordanceFor("plant", plot("empty", { plotIndex: 1 }), context({ plots, selectedStock: "hen" }))
        .kind,
    ).toBe("blocked");
    // Plot 5 (Crop-Field-zoned): the field track does not share the pens' cap.
    expect(
      affordanceFor("plant", plot("empty", { plotIndex: 5 }), context({ plots, selectedStock: "sprout" }))
        .kind,
    ).toBe("act");
  });

  it("blocks a full field track without touching the pen track", () => {
    const plots = Array.from({ length: STACKACRES_FIELD_CAP }, () => working("sprout"));
    // Plot 5 (Crop-Field-zoned): the field cap is full.
    expect(
      affordanceFor("plant", plot("empty", { plotIndex: 5 }), context({ plots, selectedStock: "sprout" }))
        .kind,
    ).toBe("blocked");
    // Plot 1 (Hen-Coop-zoned): the pen track does not share the fields' cap.
    expect(
      affordanceFor("plant", plot("empty", { plotIndex: 1 }), context({ plots, selectedStock: "hen" }))
        .kind,
    ).toBe("act");
  });
});

describe("what the farm wants next", () => {
  it("puts a stopped animal ahead of a ripe plot, and both ahead of planting", () => {
    expect(suggestedTool([plot("hungry"), plot("ready"), plot("empty")])).toBe("feed");
    expect(suggestedTool([plot("ready"), plot("empty")])).toBe("harvest");
    expect(suggestedTool([plot("mucked"), plot("empty")])).toBe("clear");
    expect(suggestedTool([plot("empty")])).toBe("plant");
  });

  it("wants nothing when every plot is busy or locked", () => {
    expect(suggestedTool([plot("working"), plot("locked")])).toBeNull();
  });
});

describe("the count on a dock button", () => {
  it("counts targets the tool applies to, blocked ones included", () => {
    // Three ripe plots are three ripe plots whether or not anything stops the
    // sale; a badge that drops to 0 when the barn empties stops meaning
    // "how many are ready".
    const plots = [plot("hungry"), plot("hungry"), plot("ready")];
    expect(actionableCount("feed", context({ plots, feed: 0 }))).toBe(2);
    expect(actionableCount("harvest", context({ plots }))).toBe(1);
  });

  it("never counts anything for Look", () => {
    expect(actionableCount("inspect", context({ plots: [plot("ready")] }))).toBe(0);
  });
});
