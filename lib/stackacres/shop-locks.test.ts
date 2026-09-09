import { describe, expect, it } from "vitest";
import { STACKACRES_FEED } from "./catalogue";
import { STACKACRES_TOOL_TIER_DEFS, STACKACRES_TOOL_TIERS } from "./equipment";
import { sectorLabel } from "./sectors";
import {
  STACKACRES_MAX_MILESTONE,
  STACKACRES_QUEST_FLAGS,
  STACKACRES_QUEST_LABELS,
  evaluateStackAcresShopLock,
  isStackAcresQuestFlag,
  nextStackAcresMilestone,
  stackacresMilestone,
  stackacresQuestFlags,
  stackacresShopLockRefusal,
  type StackAcresShopProgress,
} from "./shop-locks";

const NEW_FARM: StackAcresShopProgress = {
  sectors: ["farmstead"],
  influence: 0,
  greenhouseBuilt: false,
  cropFieldsUnlocked: false,
};

function farm(patch: Partial<StackAcresShopProgress>): StackAcresShopProgress {
  return { ...NEW_FARM, ...patch };
}

describe("quest flags", () => {
  it("gives a brand-new farm nothing", () => {
    expect([...stackacresQuestFlags(NEW_FARM)]).toEqual([]);
    expect(stackacresMilestone(NEW_FARM)).toBe(0);
  });

  it("reads land off the DERIVED sector list, not off a clear ledger", () => {
    // The distinction that carries live farms: `sectors` here is whatever
    // `unlockedSectors` returned, which counts a district you keep stock in
    // whether or not you ever paid to clear it.
    const flags = stackacresQuestFlags(farm({ sectors: ["farmstead", "wallow"] }));
    expect([...flags].sort()).toEqual(["cleared_wallow"]);
  });

  it("reads the Crop Fields off the standalone flag, not the sector list", () => {
    // The Crop Fields stopped being a sector in the 2026-09-08 merge into the
    // Farmstead -- see ./crop-fields.ts's own header.
    const flags = stackacresQuestFlags(farm({ cropFieldsUnlocked: true }));
    expect([...flags]).toEqual(["crop_fields_unlocked"]);
  });

  it("treats any Town Influence at all as the town's first order", () => {
    expect(stackacresQuestFlags(farm({ influence: 0 })).has("town_trusted")).toBe(false);
    expect(stackacresQuestFlags(farm({ influence: 1 })).has("town_trusted")).toBe(true);
  });

  it("counts the Greenhouse once it stands", () => {
    expect(stackacresQuestFlags(farm({ greenhouseBuilt: true })).has("greenhouse_raised")).toBe(
      true,
    );
  });

  it("names every flag it can hand out", () => {
    for (const flag of STACKACRES_QUEST_FLAGS) {
      expect(STACKACRES_QUEST_LABELS[flag]).toBeTruthy();
      // Straight into "Requires: <label>", so it has to be an instruction and
      // must not bring its own full stop.
      expect(STACKACRES_QUEST_LABELS[flag].endsWith(".")).toBe(false);
      expect(isStackAcresQuestFlag(flag)).toBe(true);
    }
    expect(isStackAcresQuestFlag("cleared_the_back_forty")).toBe(false);
  });

  it("keeps its district wording in step with the districts themselves", () => {
    // The labels are written out rather than pulled from `sectorLabel`, so
    // that this file stays a leaf. This is what stops the two drifting: a
    // renamed district fails here rather than shipping a hint that names a
    // place the map no longer has.
    const pairs = [
      ["cleared_wallow", "wallow"],
      ["cleared_oxfields", "oxfields"],
    ] as const;
    for (const [flag, sector] of pairs) {
      expect(STACKACRES_QUEST_LABELS[flag].toLowerCase()).toContain(
        sectorLabel(sector).toLowerCase(),
      );
    }
  });
});

describe("the milestone count", () => {
  it("counts in ANY order, not as a leading run", () => {
    // The farm that makes the difference: all three districts open, but the
    // town never asked for anything. A leading-run count would call this
    // milestone 1 and lock it out of its own equipment.
    const landOnly = farm({
      sectors: ["farmstead", "wallow", "oxfields"],
      cropFieldsUnlocked: true,
    });
    expect(stackacresMilestone(landOnly)).toBe(3);
  });

  it("only goes up as facts are added", () => {
    let last = 0;
    const steps: StackAcresShopProgress[] = [
      NEW_FARM,
      farm({ cropFieldsUnlocked: true }),
      farm({ cropFieldsUnlocked: true, influence: 4 }),
      farm({ sectors: ["farmstead", "wallow"], cropFieldsUnlocked: true, influence: 4 }),
      farm({
        sectors: ["farmstead", "wallow"],
        cropFieldsUnlocked: true,
        influence: 4,
        greenhouseBuilt: true,
      }),
      farm({
        sectors: ["farmstead", "wallow", "oxfields"],
        cropFieldsUnlocked: true,
        influence: 4,
        greenhouseBuilt: true,
      }),
    ];
    for (const step of steps) {
      const milestone = stackacresMilestone(step);
      expect(milestone).toBeGreaterThanOrEqual(last);
      last = milestone;
    }
    expect(last).toBe(STACKACRES_MAX_MILESTONE);
  });

  it("points at the first thing still undone, and at nothing on a finished farm", () => {
    expect(nextStackAcresMilestone(NEW_FARM)).toBe("crop_fields_unlocked");
    expect(nextStackAcresMilestone(farm({ cropFieldsUnlocked: true }))).toBe("town_trusted");
    expect(
      nextStackAcresMilestone(
        farm({
          sectors: ["farmstead", "wallow", "oxfields"],
          cropFieldsUnlocked: true,
          influence: 1,
          greenhouseBuilt: true,
        }),
      ),
    ).toBeNull();
  });
});

describe("evaluating a shelf row", () => {
  it("leaves an ungated row alone", () => {
    const state = evaluateStackAcresShopLock({}, NEW_FARM);
    expect(state).toEqual({
      isUnlocked: true,
      lockHint: null,
      milestone: 0,
      milestoneRequired: 0,
    });
  });

  it("starts a gated row SHUT and only a met condition opens it", () => {
    const row = { requiredQuestFlag: "cleared_wallow" } as const;
    expect(evaluateStackAcresShopLock(row, NEW_FARM).isUnlocked).toBe(false);
    expect(
      evaluateStackAcresShopLock(row, farm({ sectors: ["farmstead", "wallow"] }))
        .isUnlocked,
    ).toBe(true);
  });

  it("names the quest in the hint", () => {
    expect(evaluateStackAcresShopLock({ requiredQuestFlag: "cleared_wallow" }, NEW_FARM).lockHint)
      .toBe("Requires: Clear the Fold");
  });

  it("says how far along a milestone row is, and what to do next", () => {
    const state = evaluateStackAcresShopLock(
      { minimumMilestone: 3 },
      farm({ cropFieldsUnlocked: true }),
    );
    expect(state.isUnlocked).toBe(false);
    expect(state.milestone).toBe(1);
    expect(state.milestoneRequired).toBe(3);
    expect(state.lockHint).toBe(
      "Requires 3 farm milestones (1 done) — next: Fill an order for the town",
    );
  });

  it("ANDs the two conditions, and answers with the specific one first", () => {
    const row = { requiredQuestFlag: "greenhouse_raised", minimumMilestone: 2 } as const;
    // Milestone met, quest not: the quest is the more actionable answer.
    const missingQuest = farm({ sectors: ["farmstead", "wallow"], cropFieldsUnlocked: true });
    expect(evaluateStackAcresShopLock(row, missingQuest).lockHint).toBe(
      "Requires: Raise the Greenhouse",
    );
    // Quest met, milestone not.
    const missingMilestone = farm({ greenhouseBuilt: true });
    const state = evaluateStackAcresShopLock(row, missingMilestone);
    expect(state.isUnlocked).toBe(false);
    expect(state.lockHint).toContain("Requires 2 farm milestones");
    // Both met.
    expect(
      evaluateStackAcresShopLock(row, farm({ cropFieldsUnlocked: true, greenhouseBuilt: true }))
        .isUnlocked,
    ).toBe(true);
  });

  it("asks for nothing when the milestone floor is zero or negative", () => {
    expect(evaluateStackAcresShopLock({ minimumMilestone: 0 }, NEW_FARM).isUnlocked).toBe(true);
    expect(evaluateStackAcresShopLock({ minimumMilestone: -3 }, NEW_FARM).isUnlocked).toBe(true);
  });

  it("words the server's refusal off the same hint the shelf shows", () => {
    const state = evaluateStackAcresShopLock({ requiredQuestFlag: "cleared_wallow" }, NEW_FARM);
    expect(stackacresShopLockRefusal("Bulk Shipment", state)).toBe(
      "Ray won't sell you a Bulk Shipment yet. Requires: Clear the Fold.",
    );
  });
});

describe("what Ray's shelf actually asks for", () => {
  it("never asks for more milestones than exist", () => {
    // A row asking for six of five would be permanently unbuyable, and would
    // render a hint with no "next" to name. Cheapest possible guard.
    const rows = [...Object.values(STACKACRES_FEED), ...Object.values(STACKACRES_TOOL_TIER_DEFS)];
    for (const row of rows) {
      expect(row.minimumMilestone ?? 0).toBeLessThanOrEqual(STACKACRES_MAX_MILESTONE);
    }
  });

  it("keeps the cheapest feed and the free tool ungated", () => {
    // The floor of the shelf has to stay reachable: a hungry animal must be
    // feedable by whoever is standing there, and the Trowel is the game as
    // it already plays.
    expect(evaluateStackAcresShopLock(STACKACRES_FEED.feed_sack, NEW_FARM).isUnlocked).toBe(true);
    expect(
      evaluateStackAcresShopLock(STACKACRES_TOOL_TIER_DEFS[STACKACRES_TOOL_TIERS[0]], NEW_FARM)
        .isUnlocked,
    ).toBe(true);
  });

  it("holds the volume feed and both paid rungs back from a brand-new farm", () => {
    expect(evaluateStackAcresShopLock(STACKACRES_FEED.bulk_shipment, NEW_FARM).isUnlocked).toBe(
      false,
    );
    expect(
      evaluateStackAcresShopLock(STACKACRES_TOOL_TIER_DEFS["iron-shovel"], NEW_FARM).isUnlocked,
    ).toBe(false);
    expect(
      evaluateStackAcresShopLock(STACKACRES_TOOL_TIER_DEFS["golden-spade"], NEW_FARM).isUnlocked,
    ).toBe(false);
  });

  it("opens the whole shelf to a farm that has cleared its three districts", () => {
    // The calibration claim, stated as a test: nothing here asks for a route
    // through the game other than farming it. The Crop Fields plus both
    // districts is milestone 3.
    const worked = farm({
      sectors: ["farmstead", "wallow", "oxfields"],
      cropFieldsUnlocked: true,
    });
    for (const row of [
      ...Object.values(STACKACRES_FEED),
      ...Object.values(STACKACRES_TOOL_TIER_DEFS),
    ]) {
      expect(evaluateStackAcresShopLock(row, worked).isUnlocked).toBe(true);
    }
  });
});
